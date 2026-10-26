import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqliteDatabase } from "../../src/adapters/persistence/sqlite/sqlite.database.js";
import { SqlitePersistenceRepository } from "../../src/adapters/persistence/sqlite/sqlite.repository.js";
import { ConfigService } from "../../src/adapters/configuration/config.service.js";
import { MockChannelAdapter } from "../../src/adapters/channels/mock/mock-channel.adapter.js";
import { MockExecutionProvider } from "../../src/adapters/agents/mock/mock-execution.provider.js";
import { CommandAuthorizer } from "../../src/application/authorization/command-authorizer.js";
import { JobManager } from "../../src/application/jobs/job-manager.js";
import { ExecutionCoordinator } from "../../src/application/execution/execution-coordinator.js";
import { ResultDeliveryService } from "../../src/application/delivery/result-delivery.service.js";
import { CommandRouter } from "../../src/application/routing/command-router.js";
import { MessageNormalizer } from "../../src/application/normalization/message-normalizer.js";
import { OutgoingDeliveryRequest, DeliveryResult } from "../../src/ports/output-channel.port.js";

describe("Phase 5: End-to-End Workflow & Delivery Separation", () => {
  let db: SqliteDatabase;
  let persistence: SqlitePersistenceRepository;
  let mockChannel: MockChannelAdapter;
  let mockProvider: MockExecutionProvider;
  let router: CommandRouter;
  let deliveryService: ResultDeliveryService;

  beforeEach(async () => {
    db = new SqliteDatabase(":memory:");
    db.migrate();
    persistence = new SqlitePersistenceRepository(db);

    await persistence.saveWorkspace({
      id: "ws-primary",
      schemaVersion: 1,
      name: "Test Workspace",
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await persistence.saveRepositoryProfile({
      id: "wedocit",
      schemaVersion: 1,
      workspaceId: "ws-primary",
      name: "wedocit",
      description: "Test Document Editor",
      path: "F:/Project/Desktop/wedocit",
      allowedOperations: ["read", "review", "modify"],
      allowedBranches: ["main"],
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    mockChannel = new MockChannelAdapter();
    await mockChannel.start();

    mockProvider = new MockExecutionProvider();
    mockProvider.simulatedDurationMs = 10;
    const providerRegistry = new Map();
    providerRegistry.set("mock", mockProvider);

    const configService = new ConfigService();
    const jobManager = new JobManager(persistence);
    const authorizer = new CommandAuthorizer(configService);
    const coordinator = new ExecutionCoordinator(jobManager, persistence, providerRegistry);
    deliveryService = new ResultDeliveryService(mockChannel, persistence);

    router = new CommandRouter(
      persistence,
      authorizer,
      jobManager,
      coordinator,
      deliveryService,
      configService
    );

    mockChannel.onMessage(async (msg) => {
      await router.processIncomingMessage(msg);
    });
  });

  afterEach(() => {
    db.close();
  });

  it("can trace complete end-to-end execution using a single correlation ID", async () => {
    const rawMsg = {
      workspaceId: "ws-primary",
      channelConnectionId: "conn-mock",
      sourceType: "mock" as const,
      providerMessageId: "prov-e2e-trace-1",
      conversationId: "chat_123",
      senderId: "user_123",
      text: "/review wedocit inspect token parsing",
    };

    const normalized = MessageNormalizer.normalize(rawMsg);
    const targetCorrelationId = normalized.correlationId;

    await mockChannel.simulateIncomingMessage(normalized);

    // Verify correlation ID in outgoing delivery requests
    expect(mockChannel.sentReplies.length).toBe(2);
    for (const reply of mockChannel.sentReplies) {
      expect(reply.correlationId).toBe(targetCorrelationId);
    }

    // Verify correlation ID in SQLite Job
    const jobs = await persistence.listJobs();
    expect(jobs.length).toBe(1);
    expect(jobs[0].correlationId).toBe(targetCorrelationId);
    expect(jobs[0].status).toBe("completed");

    // Verify correlation ID in ExecutionResult
    const result = await persistence.getExecutionResult(jobs[0].id);
    expect(result).toBeDefined();
    expect(result?.correlationId).toBe(targetCorrelationId);

    // Verify correlation ID in DeliveryAttempts
    const deliveryAttempts = await persistence.listDeliveryAttempts(jobs[0].id);
    expect(deliveryAttempts.length).toBe(1);
    expect(deliveryAttempts[0].correlationId).toBe(targetCorrelationId);
    expect(deliveryAttempts[0].status).toBe("delivered");

    // Verify correlation ID in AuditEvents
    const audits = await persistence.listAuditEvents(targetCorrelationId);
    expect(audits.length).toBeGreaterThanOrEqual(2);
    for (const a of audits) {
      expect(a.correlationId).toBe(targetCorrelationId);
    }
  });

  it("separates delivery failure from execution outcome and supports independent retry", async () => {
    // Override mock channel to simulate delivery failure for the final result
    let sendCount = 0;
    mockChannel.sendReply = async (req: OutgoingDeliveryRequest): Promise<DeliveryResult> => {
      sendCount++;
      if (sendCount === 1) {
        // Ack succeeds
        return { success: true, deliveredAt: new Date().toISOString() };
      }
      // Result delivery fails transiently (e.g. WhatsApp Web tab reloaded)
      return {
        success: false,
        deliveredAt: new Date().toISOString(),
        error: "WhatsApp Web connection temporarily unavailable",
        retryable: true,
      };
    };

    const rawMsg = {
      workspaceId: "ws-primary",
      channelConnectionId: "conn-mock",
      sourceType: "mock" as const,
      providerMessageId: "prov-deliv-fail-1",
      conversationId: "chat_123",
      senderId: "user_123",
      text: "/review wedocit check crash recovery",
    };

    const normalized = MessageNormalizer.normalize(rawMsg);
    await mockChannel.simulateIncomingMessage(normalized);

    // CRITICAL: Job must remain COMPLETED even though delivery failed!
    const jobs = await persistence.listJobs();
    expect(jobs.length).toBe(1);
    expect(jobs[0].status).toBe("completed");

    // Result is preserved
    const result = await persistence.getExecutionResult(jobs[0].id);
    expect(result?.status).toBe("success");

    // Delivery attempt must be recorded as failed in SQLite
    const deliveryAttempts = await persistence.listDeliveryAttempts(jobs[0].id);
    expect(deliveryAttempts.length).toBe(1);
    expect(deliveryAttempts[0].status).toBe("failed");
    expect(deliveryAttempts[0].errorMessage).toContain("temporarily unavailable");

    // Now restore channel and retry delivery independently WITHOUT rerunning the job
    let agentExecutionCount = 0;
    mockProvider.execute = async (req, ctx) => {
      agentExecutionCount++;
      return { id: "new-handle", provider: "mock", startedAt: new Date().toISOString() };
    };

    mockChannel.sendReply = async () => ({
      success: true,
      deliveredAt: new Date().toISOString(),
    });

    const failedAttempt = deliveryAttempts[0];
    const retrySuccess = await deliveryService.retryFailedDelivery(
      failedAttempt,
      result!.summary
    );

    expect(retrySuccess).toBe(true);
    // Crucial: The underlying agent was NEVER re-executed!
    expect(agentExecutionCount).toBe(0);

    // Delivery attempt status updated to delivered
    const updatedAttempts = await persistence.listDeliveryAttempts(jobs[0].id);
    expect(updatedAttempts[0].status).toBe("delivered");
    expect(updatedAttempts[0].attempt).toBe(2);
  });
});

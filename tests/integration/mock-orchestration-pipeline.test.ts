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

describe("Mock Orchestration Pipeline (End-to-End)", () => {
  let db: SqliteDatabase;
  let persistence: SqlitePersistenceRepository;
  let mockChannel: MockChannelAdapter;
  let mockProvider: MockExecutionProvider;
  let router: CommandRouter;

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
      allowedOperations: ["read", "review"],
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
    const delivery = new ResultDeliveryService(mockChannel);

    router = new CommandRouter(
      persistence,
      authorizer,
      jobManager,
      coordinator,
      delivery,
      configService
    );

    mockChannel.onMessage(async (msg) => {
      await router.processIncomingMessage(msg);
    });
  });

  afterEach(() => {
    db.close();
  });

  it("processes a valid /review command to full completion and delivers result", async () => {
    const rawMessage = {
      workspaceId: "ws-primary",
      channelConnectionId: "conn-mock-1",
      sourceType: "mock" as const,
      providerMessageId: "prov-msg-001",
      conversationId: "chat_123",
      senderId: "user_123",
      text: "/review wedocit check cursor state handling",
    };

    const normalized = MessageNormalizer.normalize(rawMessage);
    await mockChannel.simulateIncomingMessage(normalized);

    // Should have sent:
    // 1. Immediate acknowledgement
    // 2. Final result summary
    expect(mockChannel.sentReplies.length).toBe(2);

    const ack = mockChannel.sentReplies[0];
    expect(ack.text).toContain("Job");
    expect(ack.text).toContain("accepted and queued");

    const resultMsg = mockChannel.sentReplies[1];
    expect(resultMsg.text).toContain("SUCCESS");
    expect(resultMsg.text).toContain("Artifacts:");

    // Verify database state
    const jobs = await persistence.listJobs();
    expect(jobs.length).toBe(1);
    expect(jobs[0].status).toBe("completed");

    const transitions = await persistence.getJobTransitions(jobs[0].id);
    expect(transitions.map((t) => t.toStatus)).toEqual([
      "received",
      "validated",
      "queued",
      "running",
      "completed",
    ]);

    // Verify audit events recorded
    const audits = await persistence.listAuditEvents(normalized.correlationId);
    expect(audits.length).toBeGreaterThanOrEqual(2);
  });

  it("ignores duplicate messages without creating extra jobs or replies", async () => {
    const rawMessage = {
      workspaceId: "ws-primary",
      channelConnectionId: "conn-mock-1",
      sourceType: "mock" as const,
      providerMessageId: "prov-msg-duplicate",
      conversationId: "chat_123",
      senderId: "user_123",
      text: "/review wedocit check tests",
    };

    const msg1 = MessageNormalizer.normalize(rawMessage);
    await mockChannel.simulateIncomingMessage(msg1);
    const replyCountFirst = mockChannel.sentReplies.length;

    // Send identical provider message id
    await mockChannel.simulateIncomingMessage(msg1);

    // Replies should remain unchanged
    expect(mockChannel.sentReplies.length).toBe(replyCountFirst);

    // Jobs should still be 1
    const jobs = await persistence.listJobs();
    expect(jobs.length).toBe(1);
  });
});

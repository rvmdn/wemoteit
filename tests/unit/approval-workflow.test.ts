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

describe("Approval Workflow & Gate (Phase 3)", () => {
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

  it("gates mutating task and issues approval token", async () => {
    const rawMsg = {
      workspaceId: "ws-primary",
      channelConnectionId: "conn-mock",
      sourceType: "mock" as const,
      providerMessageId: "prov-mutating-1",
      conversationId: "chat_123",
      senderId: "user_123",
      text: "/run wedocit delete obsolete test files",
    };

    const normalized = MessageNormalizer.normalize(rawMsg);
    await mockChannel.simulateIncomingMessage(normalized);

    // Assert that reply asks for approval
    expect(mockChannel.sentReplies.length).toBe(1);
    const reply = mockChannel.sentReplies[0].text;
    expect(reply).toContain("Approval Required");
    expect(reply).toContain("/approve APP-");

    // Extract approval token
    const tokenMatch = reply.match(/\/approve\s+(APP-[A-Z0-9]+)/);
    expect(tokenMatch).not.toBeNull();
    const token = tokenMatch![1];

    // Verify pending approvals in database
    const pendingList = await persistence.listPendingApprovals("ws-primary");
    expect(pendingList.length).toBe(1);
    expect(pendingList[0].token).toBe(token);

    // No job should have run yet
    const jobsBefore = await persistence.listJobs();
    expect(jobsBefore.length).toBe(0);

    // Now send approval reply: /approve APP-XXXX
    const approveMsg = MessageNormalizer.normalize({
      workspaceId: "ws-primary",
      channelConnectionId: "conn-mock",
      sourceType: "mock",
      providerMessageId: "prov-approve-1",
      conversationId: "chat_123",
      senderId: "user_123",
      text: `/approve ${token}`,
    });

    await mockChannel.simulateIncomingMessage(approveMsg);

    // Should receive acceptance and execution result
    expect(mockChannel.sentReplies.length).toBe(3);
    expect(mockChannel.sentReplies[1].text).toContain("Approval Granted");
    expect(mockChannel.sentReplies[2].text).toContain("SUCCESS");

    // Job should now be completed in SQLite
    const jobsAfter = await persistence.listJobs();
    expect(jobsAfter.length).toBe(1);
    expect(jobsAfter[0].status).toBe("completed");

    // Approval status should be 'approved'
    const approvalInDb = await persistence.getPendingApprovalByToken(token);
    expect(approvalInDb?.status).toBe("approved");
  });

  it("rejects invalid or non-existent approval tokens", async () => {
    const invalidMsg = MessageNormalizer.normalize({
      workspaceId: "ws-primary",
      channelConnectionId: "conn-mock",
      sourceType: "mock",
      providerMessageId: "prov-invalid-token",
      conversationId: "chat_123",
      senderId: "user_123",
      text: "/approve APP-INVALID",
    });

    await mockChannel.simulateIncomingMessage(invalidMsg);
    expect(mockChannel.sentReplies.length).toBe(1);
    expect(mockChannel.sentReplies[0].text).toContain("Invalid approval token");
  });

  it("rejects expired approval tokens", async () => {
    // Seed foreign keys
    await persistence.saveIncomingMessage({
      id: "msg-dummy-exp",
      schemaVersion: 1,
      workspaceId: "ws-primary",
      channelConnectionId: "conn-mock",
      sourceType: "mock",
      providerMessageId: "prov-exp",
      conversationId: "chat_123",
      senderId: "user_123",
      senderType: "user",
      messageType: "text",
      text: "/run dummy",
      attachments: [],
      receivedAt: new Date().toISOString(),
      correlationId: "corr-exp",
      metadata: {},
    });

    await persistence.saveCommand({
      id: "cmd-dummy",
      schemaVersion: 1,
      workspaceId: "ws-primary",
      commandType: "run_task",
      requestedAction: "run_task",
      arguments: {},
      targetRepositoryId: "wedocit",
      targetAgentProfileId: "mock",
      authorizationDecision: "require_approval",
      approvalRequirement: true,
      approvalToken: null,
      sourceMessageId: "msg-dummy-exp",
      correlationId: "corr-exp",
      createdAt: new Date().toISOString(),
    });

    // Manually insert an expired approval
    await persistence.savePendingApproval({
      id: "appr-expired",
      commandId: "cmd-dummy",
      token: "APP-EXPIRED",
      workspaceId: "ws-primary",
      requestedBy: "user_123",
      action: "run_task",
      repositoryId: "wedocit",
      prompt: "dummy",
      expiresAt: new Date(Date.now() - 60000).toISOString(), // 1 minute in the past
      status: "pending",
      createdAt: new Date().toISOString(),
    });

    const approveExpired = MessageNormalizer.normalize({
      workspaceId: "ws-primary",
      channelConnectionId: "conn-mock",
      sourceType: "mock",
      providerMessageId: "prov-approve-expired",
      conversationId: "chat_123",
      senderId: "user_123",
      text: "/approve APP-EXPIRED",
    });

    await mockChannel.simulateIncomingMessage(approveExpired);
    expect(mockChannel.sentReplies[0].text).toContain("expired");

    const updated = await persistence.getPendingApprovalByToken("APP-EXPIRED");
    expect(updated?.status).toBe("expired");
  });
});

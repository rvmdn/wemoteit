import { describe, it, expect, beforeEach } from "vitest";
import { JobManager } from "../../src/application/jobs/job-manager.js";
import { SqliteDatabase } from "../../src/adapters/persistence/sqlite/sqlite.database.js";
import { SqlitePersistenceRepository } from "../../src/adapters/persistence/sqlite/sqlite.repository.js";
import { Command } from "../../src/domain/command/command.entity.js";

describe("Job Manager", () => {
  let db: SqliteDatabase;
  let repo: SqlitePersistenceRepository;
  let jobManager: JobManager;

  beforeEach(async () => {
    db = new SqliteDatabase(":memory:");
    db.migrate();
    repo = new SqlitePersistenceRepository(db);
    jobManager = new JobManager(repo);

    // Seed required foreign keys
    await repo.saveWorkspace({
      id: "ws-primary",
      schemaVersion: 1,
      name: "Primary",
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await repo.saveIncomingMessage({
      id: "msg-1",
      schemaVersion: 1,
      workspaceId: "ws-primary",
      channelConnectionId: "conn-1",
      sourceType: "mock",
      providerMessageId: "prov-1",
      conversationId: "chat-1",
      senderId: "user-1",
      senderType: "user",
      messageType: "text",
      text: "/status",
      attachments: [],
      receivedAt: new Date().toISOString(),
      correlationId: "corr-1",
      metadata: {},
    });
  });

  const sampleCommand: Command = {
    id: "cmd-1",
    schemaVersion: 1,
    workspaceId: "ws-primary",
    commandType: "status",
    requestedAction: "display_status",
    arguments: {},
    targetRepositoryId: null,
    targetAgentProfileId: "mock",
    authorizationDecision: "allow",
    approvalRequirement: false,
    approvalToken: null,
    sourceMessageId: "msg-1",
    correlationId: "corr-1",
    createdAt: new Date().toISOString(),
  };

  it("creates a job and records initial transition", async () => {
    await repo.saveCommand(sampleCommand);
    const job = await jobManager.createJob(sampleCommand);
    expect(job.status).toBe("received");

    const transitions = await repo.getJobTransitions(job.id);
    expect(transitions.length).toBe(1);
    expect(transitions[0].toStatus).toBe("received");
  });

  it("idempotently returns existing job on repeated creation", async () => {
    await repo.saveCommand(sampleCommand);
    const job1 = await jobManager.createJob(sampleCommand);
    const job2 = await jobManager.createJob(sampleCommand);
    expect(job1.id).toBe(job2.id);
  });

  it("executes valid state transitions", async () => {
    await repo.saveCommand(sampleCommand);
    const job = await jobManager.createJob(sampleCommand);
    const validated = await jobManager.transitionJob(job.id, "validated");
    expect(validated.status).toBe("validated");

    const queued = await jobManager.transitionJob(job.id, "queued");
    expect(queued.status).toBe("queued");

    const running = await jobManager.transitionJob(job.id, "running");
    expect(running.status).toBe("running");
    expect(running.startedAt).toBeDefined();

    const completed = await jobManager.transitionJob(job.id, "completed");
    expect(completed.status).toBe("completed");
    expect(completed.completedAt).toBeDefined();
  });

  it("rejects invalid state transitions", async () => {
    await repo.saveCommand(sampleCommand);
    const job = await jobManager.createJob(sampleCommand);
    await expect(jobManager.transitionJob(job.id, "completed")).rejects.toThrow();
  });

  it("safely recovers interrupted running jobs on restart", async () => {
    await repo.saveCommand(sampleCommand);
    const job = await jobManager.createJob(sampleCommand);
    await jobManager.transitionJob(job.id, "validated");
    await jobManager.transitionJob(job.id, "queued");
    await jobManager.transitionJob(job.id, "running");

    const recoveredCount = await jobManager.recoverStalledJobs();
    expect(recoveredCount).toBe(1);

    const reloaded = await repo.getJob(job.id);
    expect(reloaded?.status).toBe("failed");
    expect(reloaded?.errorCode).toBe("UNEXPECTED_SYSTEM_RESTART");
  });
});

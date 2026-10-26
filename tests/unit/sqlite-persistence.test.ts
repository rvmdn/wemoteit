import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqliteDatabase } from "../../src/adapters/persistence/sqlite/sqlite.database.js";
import { SqlitePersistenceRepository } from "../../src/adapters/persistence/sqlite/sqlite.repository.js";

describe("SQLite Persistence Repository", () => {
  let db: SqliteDatabase;
  let repo: SqlitePersistenceRepository;

  beforeEach(() => {
    db = new SqliteDatabase(":memory:");
    db.migrate();
    repo = new SqlitePersistenceRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it("persists and retrieves workspaces", async () => {
    const ws = {
      id: "ws-100",
      schemaVersion: 1 as const,
      name: "Engineering WS",
      status: "active" as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await repo.saveWorkspace(ws);
    const loaded = await repo.getWorkspace("ws-100");
    expect(loaded).toBeDefined();
    expect(loaded?.name).toBe("Engineering WS");
  });

  it("persists repository profiles and lists them by workspace", async () => {
    await repo.saveWorkspace({
      id: "ws-test",
      schemaVersion: 1,
      name: "Test WS",
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const repoProfile = {
      id: "repo-1",
      schemaVersion: 1 as const,
      workspaceId: "ws-test",
      name: "wedocit",
      description: "Editor",
      path: "F:/Project/Desktop/wedocit",
      allowedOperations: ["read" as const, "review" as const],
      allowedBranches: ["main"],
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await repo.saveRepositoryProfile(repoProfile);

    const list = await repo.listRepositoryProfiles("ws-test");
    expect(list.length).toBe(1);
    expect(list[0].id).toBe("repo-1");
    expect(list[0].allowedOperations).toContain("read");
  });

  it("persists and queries audit events", async () => {
    const event = {
      id: "aud-1",
      schemaVersion: 1 as const,
      workspaceId: "ws-test",
      actorType: "user" as const,
      actorId: "user_123",
      eventType: "message_received" as const,
      resourceType: "message",
      resourceId: "msg-1",
      outcome: "success" as const,
      reasonCode: null,
      correlationId: "corr-audit-1",
      occurredAt: new Date().toISOString(),
      details: { foo: "bar" },
    };

    await repo.saveAuditEvent(event);
    const events = await repo.listAuditEvents("corr-audit-1");
    expect(events.length).toBe(1);
    expect(events[0].details.foo).toBe("bar");
  });
});

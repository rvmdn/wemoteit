import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { SqliteDatabase } from "../../src/adapters/persistence/sqlite/sqlite.database.js";
import { SqlitePersistenceRepository } from "../../src/adapters/persistence/sqlite/sqlite.repository.js";
import { GeminiAccountPoolManager } from "../../src/adapters/agents/gemini/gemini-account-pool.js";
import { GeminiExecutionProvider } from "../../src/adapters/agents/gemini/gemini-execution.provider.js";
import { GeminiAccountInstance } from "../../src/domain/agent/gemini-account.entity.js";

describe("Gemini Account Pool & Multi-Account Rotation (Phase 8)", () => {
  let db: SqliteDatabase;
  let persistence: SqlitePersistenceRepository;
  let poolManager: GeminiAccountPoolManager;

  const sampleAccount1: GeminiAccountInstance = {
    id: "inst-1",
    schemaVersion: 1,
    label: "Google Account 1 (Primary)",
    apiKey: "AIzaSyDummyKeyNumberOne11111111111",
    model: "gemini-1.5-pro",
    tier: "free",
    status: "active",
    priority: 1,
    requestsToday: 0,
    cooldownUntil: null,
    lastUsedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const sampleAccount2: GeminiAccountInstance = {
    id: "inst-2",
    schemaVersion: 1,
    label: "Google Account 2 (Standby Ammunition)",
    apiKey: "AIzaSyDummyKeyNumberTwo22222222222",
    model: "gemini-1.5-pro",
    tier: "free",
    status: "active",
    priority: 2,
    requestsToday: 0,
    cooldownUntil: null,
    lastUsedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  beforeEach(async () => {
    db = new SqliteDatabase(":memory:");
    db.migrate();
    persistence = new SqlitePersistenceRepository(db);
    poolManager = new GeminiAccountPoolManager(persistence);
  });

  afterEach(() => {
    db.close();
  });

  it("stores and lists multiple Gemini accounts in pool", async () => {
    await persistence.saveGeminiAccount(sampleAccount1);
    await persistence.saveGeminiAccount(sampleAccount2);

    const accounts = await persistence.listGeminiAccounts();
    expect(accounts.length).toBe(2);
    expect(accounts[0].id).toBe("inst-1");
    expect(accounts[1].id).toBe("inst-2");

    const masked = await poolManager.listMaskedAccounts();
    expect(masked[0].maskedKey).toContain("...");
    expect(masked[0].maskedKey).not.toBe(sampleAccount1.apiKey);
  });

  it("acquires highest priority active account from pool", async () => {
    await persistence.saveGeminiAccount(sampleAccount1);
    await persistence.saveGeminiAccount(sampleAccount2);

    const acquired = await poolManager.acquireAccount();
    expect(acquired.id).toBe("inst-1");
  });

  it("fails over to standby account when primary account hits rate limit (429)", async () => {
    await persistence.saveGeminiAccount(sampleAccount1);
    await persistence.saveGeminiAccount(sampleAccount2);

    // Primary account hits rate limit (60s cooldown)
    await poolManager.reportRateLimit("inst-1", 60);

    const stats = await poolManager.getStats();
    expect(stats.activeAccounts).toBe(1);
    expect(stats.coolingDownAccounts).toBe(1);

    // Next acquired account MUST be standby account 2!
    const nextAcquired = await poolManager.acquireAccount();
    expect(nextAcquired.id).toBe("inst-2");
    expect(nextAcquired.label).toContain("Account 2");
  });

  it("auto-recovers account when cooldown period expires", async () => {
    // Create account with cooldown in the past
    const expiredCooldownAcc: GeminiAccountInstance = {
      ...sampleAccount1,
      status: "cooling_down",
      cooldownUntil: new Date(Date.now() - 5000).toISOString(),
    };
    await persistence.saveGeminiAccount(expiredCooldownAcc);

    const acquired = await poolManager.acquireAccount();
    expect(acquired.id).toBe("inst-1");
    expect(acquired.status).toBe("active");
  });

  it("tracks request count and stats accurately across pool", async () => {
    await persistence.saveGeminiAccount(sampleAccount1);
    await persistence.saveGeminiAccount(sampleAccount2);

    await poolManager.reportSuccess("inst-1");
    await poolManager.reportSuccess("inst-1");
    await poolManager.reportSuccess("inst-2");

    const stats = await poolManager.getStats();
    expect(stats.totalRequestsToday).toBe(3);
  });

  it("executes generation with GeminiExecutionProvider and auto-rotates on 429", async () => {
    await persistence.saveGeminiAccount(sampleAccount1);
    await persistence.saveGeminiAccount(sampleAccount2);

    const provider = new GeminiExecutionProvider(poolManager);
    const caps = await provider.getCapabilities();
    expect(caps.supportedLanguages).toContain("typescript");

    let callCount = 0;
    // Mock global fetch to simulate 429 on account 1, then success on account 2
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      callCount++;
      if (url.includes(sampleAccount1.apiKey)) {
        return {
          ok: false,
          status: 429,
          text: async () => JSON.stringify({ error: { message: "RESOURCE_EXHAUSTED" } }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: "Proyek wedocit adalah editor dokumen pengujian cerdas." }],
              },
            },
          ],
        }),
      };
    }) as any;

    try {
      const handle = await provider.execute(
        {
          jobId: "job-test-gemini",
          workspaceId: "ws-primary",
          action: "review",
          prompt: "jelaskan wedocit",
          correlationId: "corr-gemini-test",
        },
        { workingDirectory: "F:/Project/Desktop/wedocit" }
      );

      // Wait for async execution
      let status = await provider.getStatus(handle);
      const start = Date.now();
      while (status.state === "running" && Date.now() - start < 3000) {
        await new Promise((r) => setTimeout(r, 50));
        status = await provider.getStatus(handle);
      }

      expect(status.state).toBe("completed");
      expect(status.result?.status).toBe("success");
      expect(status.result?.summary).toContain("Proyek wedocit");
      expect(callCount).toBe(2); // First failed (429), second succeeded!
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("rotates account on HTTP 503 (model overloaded)", async () => {
    await persistence.saveGeminiAccount(sampleAccount1);
    await persistence.saveGeminiAccount(sampleAccount2);

    const provider = new GeminiExecutionProvider(poolManager);
    let callCount = 0;

    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      callCount++;
      if (url.includes(sampleAccount1.apiKey)) {
        return {
          ok: false,
          status: 503,
          text: async () => JSON.stringify({ error: { message: "The model is overloaded. Please try again later." } }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: "Berhasil pulih dari 503" }] } }],
        }),
      };
    }) as any;

    try {
      const handle = await provider.execute(
        {
          jobId: "job-test-503",
          workspaceId: "ws-primary",
          action: "review",
          prompt: "test overload",
          correlationId: "corr-503-test",
        },
        {}
      );

      let status = await provider.getStatus(handle);
      const start = Date.now();
      while (status.state === "running" && Date.now() - start < 3000) {
        await new Promise((r) => setTimeout(r, 50));
        status = await provider.getStatus(handle);
      }

      expect(status.state).toBe("completed");
      expect(status.result?.status).toBe("success");
      expect(status.result?.summary).toContain("Berhasil pulih dari 503");
      expect(callCount).toBe(2);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("surfaces finishReason when text generation is empty or blocked", async () => {
    await persistence.saveGeminiAccount(sampleAccount1);

    const provider = new GeminiExecutionProvider(poolManager);
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation(async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ finishReason: "SAFETY" }],
        }),
      };
    }) as any;

    try {
      const handle = await provider.execute(
        {
          jobId: "job-test-safety",
          workspaceId: "ws-primary",
          action: "review",
          prompt: "unsafe prompt",
          correlationId: "corr-safety",
        },
        {}
      );

      let status = await provider.getStatus(handle);
      const start = Date.now();
      while (status.state === "running" && Date.now() - start < 3000) {
        await new Promise((r) => setTimeout(r, 50));
        status = await provider.getStatus(handle);
      }

      expect(status.state).toBe("failed");
      expect(status.result?.summary).toContain("finishReason: SAFETY");
    } finally {
      global.fetch = originalFetch;
    }
  });
});

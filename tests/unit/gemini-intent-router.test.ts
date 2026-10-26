import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { SqliteDatabase } from "../../src/adapters/persistence/sqlite/sqlite.database.js";
import { SqlitePersistenceRepository } from "../../src/adapters/persistence/sqlite/sqlite.repository.js";
import { GeminiAccountPoolManager } from "../../src/adapters/agents/gemini/gemini-account-pool.js";
import { GeminiIntentRouter } from "../../src/adapters/agents/gemini/gemini-intent-router.js";
import { WindowsActionAdapter } from "../../src/adapters/os/windows/windows-action.adapter.js";
import { CommandRouter } from "../../src/application/routing/command-router.js";
import { CommandAuthorizer } from "../../src/application/authorization/command-authorizer.js";
import { JobManager } from "../../src/application/jobs/job-manager.js";
import { ExecutionCoordinator } from "../../src/application/execution/execution-coordinator.js";
import { ResultDeliveryService } from "../../src/application/delivery/result-delivery.service.js";
import { ConfigService } from "../../src/adapters/configuration/config.service.js";
import { MockExecutionProvider } from "../../src/adapters/agents/mock/mock-execution.provider.js";
import { NormalizedIncomingMessage } from "../../src/domain/message/message.entity.js";
import { GeminiAccountInstance } from "../../src/domain/agent/gemini-account.entity.js";

describe("Phase 9: Natural Language Intent Router & Windows Action Copilot", () => {
  let db: SqliteDatabase;
  let persistence: SqlitePersistenceRepository;
  let poolManager: GeminiAccountPoolManager;
  let intentRouter: GeminiIntentRouter;
  let windowsAdapter: WindowsActionAdapter;
  let commandRouter: CommandRouter;
  let authorizer: CommandAuthorizer;
  let jobManager: JobManager;
  let coordinator: ExecutionCoordinator;
  let deliveryService: ResultDeliveryService;
  let configService: ConfigService;
  let deliveredMessages: string[];

  const sampleAccount: GeminiAccountInstance = {
    id: "inst-primary",
    schemaVersion: 1,
    label: "Google AI Primary",
    apiKey: "AIzaSyTestKeyForIntentRouter123456",
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

  const baseMsg: NormalizedIncomingMessage = {
    id: "msg-nl-1",
    schemaVersion: 1,
    workspaceId: "ws-default",
    channelConnectionId: "conn-wa-1",
    sourceType: "whatsapp",
    providerMessageId: "prov-msg-1",
    conversationId: "self",
    senderId: "self",
    senderType: "user",
    messageType: "text",
    text: "tolong review wedocit apa itu",
    attachments: [],
    receivedAt: new Date().toISOString(),
    correlationId: "corr-nl-1",
    metadata: {},
  };

  beforeEach(async () => {
    db = new SqliteDatabase(":memory:");
    db.migrate();
    persistence = new SqlitePersistenceRepository(db);
    poolManager = new GeminiAccountPoolManager(persistence);
    await persistence.saveGeminiAccount(sampleAccount);

    configService = new ConfigService();
    configService.updateWhatsappChannelConfig({
      authorizedSenderId: "self",
      authorizedConversationId: "self",
      enabled: true,
    });

    authorizer = new CommandAuthorizer(configService);
    jobManager = new JobManager(persistence);

    const providerRegistry = new Map();
    providerRegistry.set("mock", new MockExecutionProvider());
    coordinator = new ExecutionCoordinator(jobManager, persistence, providerRegistry);

    deliveredMessages = [];
    const mockChannelAdapter = {
      sendReply: vi.fn().mockImplementation(async (req) => {
        deliveredMessages.push(req.text);
        return { success: true, deliveredMessageId: "out-1", deliveredAt: new Date().toISOString() };
      }),
    } as any;

    deliveryService = new ResultDeliveryService(mockChannelAdapter, persistence);
    intentRouter = new GeminiIntentRouter(poolManager);
    windowsAdapter = new WindowsActionAdapter();

    commandRouter = new CommandRouter(
      persistence,
      authorizer,
      jobManager,
      coordinator,
      deliveryService,
      configService,
      intentRouter,
      windowsAdapter
    );
  });

  afterEach(() => {
    db.close();
  });

  it("resolves natural language to execute_slash_command intent via function calling", async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    name: "execute_slash_command",
                    args: {
                      command: "/review wedocit apa itu?",
                      explanation: "Menganalisa repo wedocit",
                    },
                  },
                },
              ],
            },
          },
        ],
      }),
    }) as any;

    try {
      const intent = await intentRouter.resolveIntent(baseMsg, [], ["wedocit"]);
      expect(intent.type).toBe("slash_command");
      if (intent.type === "slash_command") {
        expect(intent.commandText).toBe("/review wedocit apa itu?");
      }
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("resolves natural language to launch_app intent (e.g. 'nyalakan teams')", async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    name: "launch_app",
                    args: {
                      appName: "teams",
                    },
                  },
                },
              ],
            },
          },
        ],
      }),
    }) as any;

    try {
      const msg = { ...baseMsg, text: "tolong nyalakan teams" };
      const intent = await intentRouter.resolveIntent(msg, [], []);
      expect(intent.type).toBe("launch_app");
      if (intent.type === "launch_app") {
        expect(intent.appName).toBe("teams");
      }
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("resolves natural language to get_system_status (e.g. 'cek baterai')", async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    name: "get_system_status",
                    args: {
                      metrics: "battery",
                    },
                  },
                },
              ],
            },
          },
        ],
      }),
    }) as any;

    try {
      const msg = { ...baseMsg, text: "sisa baterai laptop berapa persen?" };
      const intent = await intentRouter.resolveIntent(msg, [], []);
      expect(intent.type).toBe("get_system_status");
      if (intent.type === "get_system_status") {
        expect(intent.metrics).toBe("battery");
      }
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("returns conversational reply for chit-chat or questions without tools", async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: "Halo! Saya asisten remote wemoteit yang siap membantu mengendalikan Windows dan proyek coding Anda.",
                },
              ],
            },
          },
        ],
      }),
    }) as any;

    try {
      const msg = { ...baseMsg, text: "halo siapa kamu?" };
      const intent = await intentRouter.resolveIntent(msg, [], []);
      expect(intent.type).toBe("conversational_reply");
      if (intent.type === "conversational_reply") {
        expect(intent.replyText).toContain("Halo! Saya asisten remote wemoteit");
      }
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("integrates with CommandRouter: maps natural language to slash command and processes job", async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    name: "execute_slash_command",
                    args: {
                      command: "/status",
                    },
                  },
                },
              ],
            },
          },
        ],
      }),
    }) as any;

    try {
      const msg = { ...baseMsg, text: "bagaimana status bot sekarang?" };
      await commandRouter.processIncomingMessage(msg);

      expect(deliveredMessages.length).toBeGreaterThan(0);
      expect(deliveredMessages.some((m) => m.includes("wemoteit System Status"))).toBe(true);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("integrates with CommandRouter: delivers conversational reply to WhatsApp", async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: "Siap, semua layanan berjalan normal.",
                },
              ],
            },
          },
        ],
      }),
    }) as any;

    try {
      const msg = { ...baseMsg, text: "apakah bot siap bekerja?" };
      await commandRouter.processIncomingMessage(msg);

      expect(deliveredMessages.length).toBeGreaterThan(0);
      expect(deliveredMessages.some((m) => m.includes("🤖 Siap, semua layanan berjalan normal."))).toBe(true);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("routes 'tutup teams' to terminate_app intent and executes termination", async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    name: "terminate_app",
                    args: { appName: "teams" },
                  },
                },
              ],
            },
          },
        ],
      }),
    }) as any;

    const terminateSpy = vi.spyOn(windowsAdapter, "terminateApp").mockResolvedValue({
      success: true,
      message: "🛑 Berhasil menghentikan 1 proses untuk aplikasi *teams*.",
    });

    try {
      const msg = { ...baseMsg, text: "tutup teams sekarang" };
      await commandRouter.processIncomingMessage(msg);

      expect(terminateSpy).toHaveBeenCalledWith("teams");
      expect(deliveredMessages.some((m) => m.includes("Berhasil menghentikan 1 proses untuk aplikasi *teams*"))).toBe(true);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("blocks natural language requests from unauthorized senders", async () => {
    const unauthorizedMsg = {
      ...baseMsg,
      senderId: "628999999999", // unauthorized
      text: "buka teams",
    };

    await commandRouter.processIncomingMessage(unauthorizedMsg);
    expect(deliveredMessages.length).toBe(1);
    expect(deliveredMessages[0]).toContain("Request Denied");
  });

  it("preserves fast-path execution for slash commands with zero NLU overhead", async () => {
    const fastPathMsg = {
      ...baseMsg,
      text: "/status",
    };

    await commandRouter.processIncomingMessage(fastPathMsg);
    expect(deliveredMessages.length).toBe(1);
    expect(deliveredMessages[0]).toContain("wemoteit System Status");
  });
});


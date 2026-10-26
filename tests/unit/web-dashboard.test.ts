import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { DashboardWebServer } from "../../src/interfaces/web/server.js";
import { ConfigService } from "../../src/adapters/configuration/config.service.js";
import { SqliteDatabase } from "../../src/adapters/persistence/sqlite/sqlite.database.js";
import { SqlitePersistenceRepository } from "../../src/adapters/persistence/sqlite/sqlite.repository.js";
import { WhatsAppWebAdapter } from "../../src/adapters/channels/whatsapp/whatsapp-web.adapter.js";
import { JobManager } from "../../src/application/jobs/job-manager.js";

describe("Web Management Dashboard & Account Security Gate", () => {
  let dbHelper: SqliteDatabase;
  let persistence: SqlitePersistenceRepository;
  let configService: ConfigService;
  let whatsappAdapter: WhatsAppWebAdapter;
  let jobManager: JobManager;
  let dashboardServer: DashboardWebServer;
  let port: number;

  beforeAll(async () => {
    configService = new ConfigService();
    dbHelper = new SqliteDatabase(":memory:");
    dbHelper.migrate();
    persistence = new SqlitePersistenceRepository(dbHelper);
    jobManager = new JobManager(persistence);

    whatsappAdapter = new WhatsAppWebAdapter({
      workspaceId: "ws-test",
      channelConnectionId: "conn-wa-test",
      authorizedSenderId: "self",
      authorizedConversationId: "self",
      sessionDataDir: "./data/test_session",
      headless: true,
      browserChannel: "msedge",
    });

    // Use ephemeral port 3199 for testing
    port = 3199;
    dashboardServer = new DashboardWebServer({
      port,
      configService,
      persistence,
      whatsappAdapter,
      jobManager,
    });

    await dashboardServer.start();
  });

  afterAll(async () => {
    configService.updateWhatsappChannelConfig({
      authorizedSenderId: "self",
      authorizedConversationId: "self",
      enabled: true,
    });
    await dashboardServer.stop();
    await whatsappAdapter.stop();
    dbHelper.close();
  });

  it("serves the Dashboard HTML interface on root /", async () => {
    const res = await fetch(`http://localhost:${port}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("wemoteit");
    expect(html).toContain("WhatsApp AI Agent Control Dashboard");
    expect(html).toContain("Kroscek & Kunci Akun Pengirim Sah");
  });

  it("returns comprehensive system and orchestrator status on /api/status", async () => {
    const res = await fetch(`http://localhost:${port}/api/status`);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.workspace).toBeDefined();
    expect(data.whatsapp).toBeDefined();
    expect(data.whatsapp.sessionState).toBe("uninitialized");
    expect(data.jobs).toBeDefined();
    expect(typeof data.jobs.running).toBe("number");
    expect(typeof data.jobs.completed).toBe("number");
    expect(Array.isArray(data.repositories)).toBe(true);
  });

  it("returns live WhatsApp session and QR status on /api/whatsapp/status", async () => {
    const res = await fetch(`http://localhost:${port}/api/whatsapp/status`);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.sessionState).toBe("uninitialized");
    expect(data.qr).toBeNull();
    expect(data.authorizedSenderId).toBeDefined();
  });

  it("locks the authorized sender phone number and activates security gate on /api/security/lock-account", async () => {
    const lockPayload = {
      authorizedSenderId: "628999888777",
      authorizedConversationId: "self",
      enableWhatsapp: true,
    };

    const res = await fetch(`http://localhost:${port}/api/security/lock-account`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(lockPayload),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.whatsapp.authorizedSenderId).toBe("628999888777");
    expect(data.whatsapp.enabled).toBe(true);

    // Verify config was updated in configService
    const currentConfig = configService.getConfig();
    expect(currentConfig.channels.whatsapp.authorizedSenderId).toBe("628999888777");
    expect(currentConfig.channels.whatsapp.enabled).toBe(true);
  });

  it("rejects locking with empty sender ID", async () => {
    const res = await fetch(`http://localhost:${port}/api/security/lock-account`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ authorizedSenderId: "" }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Bad Request");
  });

  it("lists recent jobs and pending approvals on /api/jobs", async () => {
    const res = await fetch(`http://localhost:${port}/api/jobs`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.jobs)).toBe(true);
    expect(Array.isArray(data.pendingApprovals)).toBe(true);
  });

  it("checks CDP remote debugging availability on /api/whatsapp/cdp-status", async () => {
    const res = await fetch(`http://localhost:${port}/api/whatsapp/cdp-status`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.endpoint).toBe("http://localhost:9222");
    expect(typeof data.available).toBe("boolean");
  });

  it("handles launching debug browser request on /api/whatsapp/launch-debug-browser", async () => {
    const res = await fetch(`http://localhost:${port}/api/whatsapp/launch-debug-browser`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ browser: "msedge", port: 9222 }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  it("returns 404 for non-existent API routes", async () => {
    const res = await fetch(`http://localhost:${port}/api/non_existent_route`);
    expect(res.status).toBe(404);
  });
});

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { URL } from "node:url";
import { spawn } from "node:child_process";
import { ConfigService } from "../../adapters/configuration/config.service.js";
import { SqlitePersistenceRepository } from "../../adapters/persistence/sqlite/sqlite.repository.js";
import { WhatsAppWebAdapter } from "../../adapters/channels/whatsapp/whatsapp-web.adapter.js";
import { JobManager } from "../../application/jobs/job-manager.js";
import { CommandRouter } from "../../application/routing/command-router.js";
import { MessageNormalizer } from "../../application/normalization/message-normalizer.js";
import { GeminiAccountPoolManager } from "../../adapters/agents/gemini/gemini-account-pool.js";
import { logger } from "../../adapters/logging/logger.js";

export interface DashboardServerOptions {
  port?: number;
  configService: ConfigService;
  persistence: SqlitePersistenceRepository;
  whatsappAdapter: WhatsAppWebAdapter;
  jobManager: JobManager;
  commandRouter?: CommandRouter;
  geminiPoolManager?: GeminiAccountPoolManager;
}

export class DashboardWebServer {
  private server: http.Server | null = null;
  private port: number;

  constructor(private readonly options: DashboardServerOptions) {
    this.port = options.port || 3100;
  }

  public async start(): Promise<{ port: number; server: http.Server }> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        try {
          await this.handleRequest(req, res);
        } catch (err: any) {
          logger.error({ error: err.message }, "Unhandled error in dashboard web server");
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Internal Server Error", message: err.message }));
        }
      });

      this.server.on("error", (err) => {
        reject(err);
      });

      this.server.listen(this.port, () => {
        logger.info({ port: this.port }, "Dashboard web server listening");
        resolve({ port: this.port, server: this.server! });
      });
    });
  }

  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // CORS & Security headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = parsedUrl.pathname;

    // 1. Static UI routes
    if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
      const htmlPath = path.resolve(process.cwd(), "src/interfaces/web/public/index.html");
      if (fs.existsSync(htmlPath)) {
        const content = fs.readFileSync(htmlPath, "utf-8");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(content);
        return;
      } else {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Dashboard UI index.html not found.");
        return;
      }
    }

    // 2. REST API Routes
    if (pathname.startsWith("/api/")) {
      await this.handleApiRoute(parsedUrl, req, res);
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not Found" }));
  }

  private async handleApiRoute(
    parsedUrl: URL,
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const pathname = parsedUrl.pathname;
    const config = this.options.configService.getConfig();
    const adapter = this.options.whatsappAdapter;

    // GET /api/status
    if (req.method === "GET" && pathname === "/api/status") {
      const runningJobs = await this.options.persistence.listJobsByStatus("running");
      const queuedJobs = await this.options.persistence.listJobsByStatus("queued");
      const completedJobs = await this.options.persistence.listJobsByStatus("completed");
      const failedJobs = await this.options.persistence.listJobsByStatus("failed");
      const pendingApprovals = await this.options.persistence.listPendingApprovals(config.workspace.id);

      const health = await adapter.healthCheck();
      const accountInfo = await adapter.getConnectedAccountInfo();

      this.json(res, 200, {
        workspace: config.workspace,
        whatsapp: {
          sessionState: adapter.getSessionState(),
          health: health.status,
          enabled: config.channels.whatsapp.enabled,
          authorizedSenderId: config.channels.whatsapp.authorizedSenderId,
          authorizedConversationId: config.channels.whatsapp.authorizedConversationId,
          headless: config.channels.whatsapp.headless,
          sessionDataDir: config.channels.whatsapp.sessionDataDir,
          connectedAccount: accountInfo,
        },
        jobs: {
          running: runningJobs.length,
          queued: queuedJobs.length,
          completed: completedJobs.length,
          failed: failedJobs.length,
          pendingApprovals: pendingApprovals.filter((a) => a.status === "pending").length,
        },
        repositories: config.repositories,
        agents: config.agents,
      });
      return;
    }

    // GET /api/whatsapp/status
    if (req.method === "GET" && pathname === "/api/whatsapp/status") {
      const sessionState = adapter.getSessionState();
      const qrDataUrl = adapter.getQrCodeDataUrl();
      const accountInfo = await adapter.getConnectedAccountInfo();

      this.json(res, 200, {
        sessionState,
        qr: qrDataUrl,
        authorizedSenderId: config.channels.whatsapp.authorizedSenderId,
        authorizedConversationId: config.channels.whatsapp.authorizedConversationId,
        enabled: config.channels.whatsapp.enabled,
        headless: config.channels.whatsapp.headless,
        connectedAccount: accountInfo,
      });
      return;
    }

    // GET /api/whatsapp/cdp-status
    if (req.method === "GET" && pathname === "/api/whatsapp/cdp-status") {
      const endpoint = parsedUrl.searchParams?.get("endpoint") || "http://localhost:9222";
      try {
        const cdpRes = await fetch(`${endpoint}/json/version`, {
          signal: AbortSignal.timeout(1500),
        });
        if (cdpRes.ok) {
          const versionData = await cdpRes.json();
          this.json(res, 200, {
            available: true,
            endpoint,
            browser: versionData.Browser,
            webSocketDebuggerUrl: versionData.webSocketDebuggerUrl,
          });
          return;
        }
      } catch {
        // Not running or unreachable
      }
      this.json(res, 200, { available: false, endpoint });
      return;
    }

    // POST /api/whatsapp/launch-debug-browser
    if (req.method === "POST" && pathname === "/api/whatsapp/launch-debug-browser") {
      const body = await this.readJsonBody(req);
      const browser = body.browser === "chrome" ? "chrome.exe" : "msedge.exe";
      const port = body.port || 9222;

      try {
        // Launch Microsoft Edge or Chrome with remote debugging port & WhatsApp Web
        const child = spawn(
          browser,
          [`--remote-debugging-port=${port}`, "https://web.whatsapp.com"],
          {
            detached: true,
            stdio: "ignore",
            shell: true,
          }
        );
        child.unref();

        logger.info({ browser, port }, "Launched browser with remote debugging port");
        this.json(res, 200, {
          success: true,
          message: `Browser ${browser} diluncurkan dengan port debugging ${port}`,
        });
      } catch (err: any) {
        this.json(res, 500, {
          success: false,
          error: `Gagal meluncurkan browser: ${err.message}`,
        });
      }
      return;
    }

    // POST /api/whatsapp/connect
    if (req.method === "POST" && pathname === "/api/whatsapp/connect") {
      const body = await this.readJsonBody(req);
      const mode = body.mode === "cdp" ? "cdp" : "launch";

      if (mode === "cdp") {
        const cdpEndpoint = body.cdpEndpoint || "http://localhost:9222";
        adapter.updateConfig({
          connectionMode: "cdp",
          cdpEndpoint,
        });
      } else {
        const browserChannel = body.browserChannel === "chrome" ? "chrome" : "msedge";
        const headless = body.headless !== undefined ? !!body.headless : config.channels.whatsapp.headless;

        adapter.updateConfig({
          connectionMode: "launch",
          browserChannel,
          headless,
        });
      }

      // If already connected or listening, return current state
      const currentState = adapter.getSessionState();
      if (currentState === "authenticated" || currentState === "listening") {
        this.json(res, 200, {
          success: true,
          message: "WhatsApp is already connected",
          sessionState: currentState,
        });
        return;
      }

      // Start adapter in background
      try {
        await adapter.initialize();
        adapter.start().catch((err) => {
          logger.error({ error: err.message }, "Background WhatsApp adapter start failed");
        });

        this.json(res, 200, {
          success: true,
          message: mode === "cdp" ? "Attaching to existing browser via CDP..." : "Connecting WhatsApp...",
          sessionState: adapter.getSessionState(),
        });
      } catch (err: any) {
        this.json(res, 500, {
          success: false,
          error: err.message,
        });
      }
      return;
    }

    // POST /api/whatsapp/disconnect
    if (req.method === "POST" && pathname === "/api/whatsapp/disconnect") {
      await adapter.stop();
      this.json(res, 200, {
        success: true,
        message: "WhatsApp session stopped",
        sessionState: adapter.getSessionState(),
      });
      return;
    }

    // POST /api/security/lock-account
    if (req.method === "POST" && pathname === "/api/security/lock-account") {
      const body = await this.readJsonBody(req);
      const authorizedSenderId = String(body.authorizedSenderId || "").trim();
      const authorizedConversationId = body.authorizedConversationId
        ? String(body.authorizedConversationId).trim()
        : "self";
      const enableWhatsapp = body.enableWhatsapp !== undefined ? !!body.enableWhatsapp : true;

      if (!authorizedSenderId) {
        this.json(res, 400, {
          error: "Bad Request",
          message: "authorizedSenderId cannot be empty. Use 'self' or a valid phone number (e.g. 6281234567890).",
        });
        return;
      }

      // Update configuration on disk & in-memory
      const updatedConfig = this.options.configService.updateWhatsappChannelConfig({
        authorizedSenderId,
        authorizedConversationId,
        enabled: enableWhatsapp,
      });

      // Update live adapter
      adapter.updateConfig({
        authorizedSenderId,
        authorizedConversationId,
      });

      logger.info(
        { authorizedSenderId, authorizedConversationId, enabled: enableWhatsapp },
        "Authorized WhatsApp account locked via dashboard"
      );

      this.json(res, 200, {
        success: true,
        message: `Account successfully locked to '${authorizedSenderId}'`,
        whatsapp: {
          authorizedSenderId: updatedConfig.channels.whatsapp.authorizedSenderId,
          authorizedConversationId: updatedConfig.channels.whatsapp.authorizedConversationId,
          enabled: updatedConfig.channels.whatsapp.enabled,
        },
      });
      return;
    }

    // GET /api/jobs
    if (req.method === "GET" && pathname === "/api/jobs") {
      const limit = parseInt(parsedUrl.searchParams?.get("limit") || "20", 10);
      const jobs = await this.options.persistence.listJobs(limit);
      const pendingApprovals = await this.options.persistence.listPendingApprovals(config.workspace.id);

      this.json(res, 200, {
        jobs,
        pendingApprovals: pendingApprovals.filter((a) => a.status === "pending"),
      });
      return;
    }

    // POST /api/jobs/approve
    if (req.method === "POST" && pathname === "/api/jobs/approve") {
      const body = await this.readJsonBody(req);
      const token = String(body.token || "").trim();

      if (!token) {
        this.json(res, 400, { error: "Token is required" });
        return;
      }

      if (this.options.commandRouter) {
        const approvalMsg = MessageNormalizer.normalize({
          workspaceId: config.workspace.id,
          channelConnectionId: "conn-dashboard",
          sourceType: "whatsapp",
          providerMessageId: `msg-dash-${Date.now()}`,
          conversationId: config.channels.whatsapp.authorizedConversationId,
          senderId: config.channels.whatsapp.authorizedSenderId,
          text: `/approve ${token}`,
        });

        await this.options.commandRouter.processIncomingMessage(approvalMsg);
        this.json(res, 200, { success: true, message: `Token ${token} approval dispatched` });
      } else {
        this.json(res, 501, { error: "CommandRouter not available" });
      }
      return;
    }

    // POST /api/jobs/cancel
    if (req.method === "POST" && pathname === "/api/jobs/cancel") {
      const body = await this.readJsonBody(req);
      const jobId = String(body.jobId || "").trim();

      if (!jobId) {
        this.json(res, 400, { error: "jobId is required" });
        return;
      }

      if (this.options.commandRouter) {
        const cancelMsg = MessageNormalizer.normalize({
          workspaceId: config.workspace.id,
          channelConnectionId: "conn-dashboard",
          sourceType: "whatsapp",
          providerMessageId: `msg-dash-cancel-${Date.now()}`,
          conversationId: config.channels.whatsapp.authorizedConversationId,
          senderId: config.channels.whatsapp.authorizedSenderId,
          text: `/cancel ${jobId}`,
        });

        await this.options.commandRouter.processIncomingMessage(cancelMsg);
        this.json(res, 200, { success: true, message: `Cancellation for job ${jobId} dispatched` });
      } else {
        this.json(res, 501, { error: "CommandRouter not available" });
      }
      return;
    }

    // POST /api/test/command
    if (req.method === "POST" && pathname === "/api/test/command") {
      const body = await this.readJsonBody(req);
      const text = String(body.command || "").trim();

      if (!text) {
        this.json(res, 400, { error: "Command text is required" });
        return;
      }

      if (this.options.commandRouter) {
        const testMsg = MessageNormalizer.normalize({
          workspaceId: config.workspace.id,
          channelConnectionId: "conn-dashboard",
          sourceType: "whatsapp",
          providerMessageId: `msg-test-${Date.now()}`,
          conversationId: config.channels.whatsapp.authorizedConversationId,
          senderId: config.channels.whatsapp.authorizedSenderId,
          text,
        });

        await this.options.commandRouter.processIncomingMessage(testMsg);
        this.json(res, 200, {
          success: true,
          message: `Command '${text}' processed`,
          correlationId: testMsg.correlationId,
        });
      } else {
        this.json(res, 501, { error: "CommandRouter not available" });
      }
      return;
    }

    // GET /api/gemini/accounts
    if (req.method === "GET" && pathname === "/api/gemini/accounts") {
      if (this.options.geminiPoolManager) {
        const accounts = await this.options.geminiPoolManager.listMaskedAccounts();
        const stats = await this.options.geminiPoolManager.getStats();
        this.json(res, 200, { accounts, stats });
      } else {
        const accounts = await this.options.persistence.listGeminiAccounts();
        this.json(res, 200, { accounts, stats: { totalAccounts: accounts.length, activeAccounts: accounts.length } });
      }
      return;
    }

    // POST /api/gemini/accounts
    if (req.method === "POST" && pathname === "/api/gemini/accounts") {
      const body = await this.readJsonBody(req);
      const id = String(body.id || `inst-${Date.now()}`).trim();
      const label = String(body.label || "Google Account").trim();
      const apiKey = String(body.apiKey || "").trim();
      const model = String(body.model || "gemini-1.5-pro").trim();
      const tier = body.tier === "payg" ? "payg" : "free";
      const priority = Number(body.priority) || 1;

      if (!apiKey) {
        this.json(res, 400, { error: "API Key is required" });
        return;
      }

      const now = new Date().toISOString();
      await this.options.persistence.saveGeminiAccount({
        id,
        schemaVersion: 1,
        label,
        apiKey,
        model,
        tier,
        status: "active",
        priority,
        requestsToday: 0,
        cooldownUntil: null,
        lastUsedAt: null,
        createdAt: now,
        updatedAt: now,
      });

      this.json(res, 200, { success: true, message: `Account '${label}' saved to pool`, accountId: id });
      return;
    }

    // DELETE /api/gemini/accounts
    if (req.method === "DELETE" && pathname === "/api/gemini/accounts") {
      const id = parsedUrl.searchParams.get("id");
      if (!id) {
        this.json(res, 400, { error: "Account ID is required" });
        return;
      }
      await this.options.persistence.deleteGeminiAccount(id);
      this.json(res, 200, { success: true, message: `Account '${id}' removed from pool` });
      return;
    }

    // POST /api/gemini/test
    if (req.method === "POST" && pathname === "/api/gemini/test") {
      const body = await this.readJsonBody(req);
      const apiKey = String(body.apiKey || "").trim();
      const model = String(body.model || "gemini-1.5-pro").trim();

      if (!apiKey) {
        this.json(res, 400, { error: "API key is required" });
        return;
      }

      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: "Ping test: respond with 'PONG: Gemini is ready'" }] }],
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          this.json(res, 400, { success: false, error: `HTTP ${response.status}: ${errText}` });
          return;
        }

        const data: any = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "OK";
        this.json(res, 200, { success: true, answer: text.trim() });
      } catch (err: any) {
        this.json(res, 500, { success: false, error: err.message });
      }
      return;
    }

    this.json(res, 404, { error: "API route not found" });
  }

  private json(res: http.ServerResponse, statusCode: number, data: any): void {
    res.writeHead(statusCode, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  }

  private async readJsonBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let data = "";
      req.on("data", (chunk) => {
        data += chunk;
      });
      req.on("end", () => {
        if (!data) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (err: any) {
          reject(new Error(`Invalid JSON body: ${err.message}`));
        }
      });
      req.on("error", (err) => {
        reject(err);
      });
    });
  }
}

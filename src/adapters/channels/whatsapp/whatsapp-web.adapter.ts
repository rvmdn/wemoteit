import path from "node:path";
import fs from "node:fs";
import { chromium, BrowserContext, Page, Browser } from "playwright";
import { InputChannelAdapter, ChannelHealth } from "../../../ports/input-channel.port.js";
import { OutputChannelAdapter, OutgoingDeliveryRequest, DeliveryResult } from "../../../ports/output-channel.port.js";
import { NormalizedIncomingMessage, NormalizedIncomingMessageSchema } from "../../../domain/message/message.entity.js";
import { logger } from "../../logging/logger.js";

export interface WhatsAppAdapterConfig {
  workspaceId: string;
  channelConnectionId: string;
  authorizedSenderId: string;
  authorizedConversationId: string;
  sessionDataDir: string;
  headless: boolean;
  browserChannel?: "msedge" | "chrome";
  connectionMode?: "launch" | "cdp";
  cdpEndpoint?: string;
}

export type WhatsAppSessionState =
  | "uninitialized"
  | "launching"
  | "needs_qr_login"
  | "authenticated"
  | "listening"
  | "disconnected"
  | "error";

export class WhatsAppWebAdapter implements InputChannelAdapter, OutputChannelAdapter {
  public readonly provider = "whatsapp";

  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private cdpBrowser: Browser | null = null;
  private sessionState: WhatsAppSessionState = "uninitialized";
  private messageHandler: ((message: NormalizedIncomingMessage) => Promise<void>) | null = null;
  private qrCodeDataUrl: string | null = null;
  private qrPollTimer: NodeJS.Timeout | null = null;

  // Historical message tracking to avoid processing old messages on startup
  private seenProviderMessageIds = new Set<string>();
  private startupTime = Date.now();
  private isSendingReply = false;
  private recentSentTexts = new Set<string>();

  constructor(private readonly config: WhatsAppAdapterConfig) {}

  public getSessionState(): WhatsAppSessionState {
    return this.sessionState;
  }

  public getQrCodeDataUrl(): string | null {
    return this.qrCodeDataUrl;
  }

  public updateConfig(updates: Partial<WhatsAppAdapterConfig>): void {
    Object.assign(this.config, updates);
  }

  public async getConnectedAccountInfo(): Promise<{ name?: string; status?: string } | null> {
    if (!this.page || this.page.isClosed() || (this.sessionState !== "listening" && this.sessionState !== "authenticated")) {
      return null;
    }
    try {
      return await this.page.evaluate(() => {
        const titleElem = document.querySelector("header [title]");
        const profileImg = document.querySelector("header img");
        return {
          name: titleElem?.getAttribute("title") || profileImg?.getAttribute("alt") || "WhatsApp User",
          status: "connected",
        };
      });
    } catch {
      return null;
    }
  }

  public async initialize(): Promise<void> {
    const sessionDir = path.resolve(process.cwd(), this.config.sessionDataDir);
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }
    logger.info({ sessionDir }, "WhatsApp session directory initialized");
  }

  public async start(): Promise<void> {
    this.sessionState = "launching";
    this.startupTime = Date.now();

    try {
      if (this.config.connectionMode === "cdp") {
        const cdpUrl = this.config.cdpEndpoint || "http://localhost:9222";
        logger.info({ cdpUrl }, "Connecting to existing browser via Chrome DevTools Protocol (CDP)");

        this.cdpBrowser = await chromium.connectOverCDP(cdpUrl, { timeout: 15000 });
        const contexts = this.cdpBrowser.contexts();
        this.context = contexts[0] || (await this.cdpBrowser.newContext());

        const pages = this.context.pages();
        this.page = pages.find((p) => p.url().includes("whatsapp.com")) || null;

        if (!this.page) {
          logger.info("No active WhatsApp Web tab found in existing browser; opening new tab");
          this.page = await this.context.newPage();
          await this.page.goto("https://web.whatsapp.com", {
            waitUntil: "domcontentloaded",
            timeout: 60000,
          });
        } else {
          logger.info({ url: this.page.url() }, "Attached to existing WhatsApp Web tab in browser");
        }

        logger.info("Attached to browser session, monitoring authentication state...");
        await this.monitorAuthState();
        return;
      }

      // Default: launch dedicated persistent context
      logger.info({ headless: this.config.headless }, "Launching WhatsApp Web browser context");
      const sessionDir = path.resolve(process.cwd(), this.config.sessionDataDir);
      const browserChannel = this.config.browserChannel || "msedge";

      this.context = await chromium.launchPersistentContext(sessionDir, {
        channel: browserChannel,
        headless: this.config.headless,
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-blink-features=AutomationControlled",
        ],
        viewport: { width: 1280, height: 800 },
      });

      this.page = this.context.pages()[0] || (await this.context.newPage());

      await this.page.goto("https://web.whatsapp.com", {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });

      logger.info("Navigated to WhatsApp Web, monitoring authentication state...");
      await this.monitorAuthState();
    } catch (err: any) {
      this.sessionState = "error";
      logger.error({ error: err.message }, "Failed to start WhatsApp Web adapter");
      throw err;
    }
  }

  public async stop(): Promise<void> {
    logger.info("Stopping WhatsApp Web adapter");
    this.sessionState = "disconnected";
    if (this.qrPollTimer) {
      clearInterval(this.qrPollTimer);
      this.qrPollTimer = null;
    }
    this.qrCodeDataUrl = null;
    try {
      if (this.cdpBrowser) {
        // Disconnect CDP without closing the user's browser window
        await this.cdpBrowser.close();
        this.cdpBrowser = null;
        this.context = null;
        this.page = null;
      } else if (this.context) {
        await this.context.close();
        this.context = null;
        this.page = null;
      }
    } catch (err: any) {
      logger.warn({ error: err.message }, "Error while closing browser context");
    }
  }

  public async healthCheck(): Promise<ChannelHealth> {
    const isHealthy =
      this.sessionState === "authenticated" || this.sessionState === "listening";

    return {
      status: isHealthy ? "healthy" : this.sessionState === "needs_qr_login" ? "degraded" : "unhealthy",
      lastCheck: new Date().toISOString(),
      details: {
        sessionState: this.sessionState,
        seenMessagesCount: this.seenProviderMessageIds.size,
        sessionDir: this.config.sessionDataDir,
      },
    };
  }

  public onMessage(handler: (message: NormalizedIncomingMessage) => Promise<void>): void {
    this.messageHandler = handler;
  }

  /**
   * Send a reply back to the active conversation
   */
  public async sendReply(request: OutgoingDeliveryRequest): Promise<DeliveryResult> {
    if (!this.page || this.page.isClosed()) {
      return {
        success: false,
        deliveredAt: new Date().toISOString(),
        error: "WhatsApp browser page is not active",
        retryable: true,
      };
    }

    try {
      this.isSendingReply = true;
      this.recentSentTexts.add(request.text.trim());
      if (this.recentSentTexts.size > 50) {
        const first = this.recentSentTexts.values().next().value;
        if (first) this.recentSentTexts.delete(first);
      }

      // Ensure target conversation is active and input textbox is visible
      await this.ensureConversationOpen();

      // Find main message input field
      const inputSelector = "footer div[contenteditable='true'][role='textbox']";
      await this.page.waitForSelector(inputSelector, { timeout: 10000 });

      // Focus and type text
      await this.page.click(inputSelector);

      // Fast instant text insertion (equivalent to copy-paste, zero keystroke delay)
      const lines = request.text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].length > 0) {
          await this.page.keyboard.insertText(lines[i]);
        }
        if (i < lines.length - 1) {
          // Shift+Enter for newline in WhatsApp
          await this.page.keyboard.down("Shift");
          await this.page.keyboard.press("Enter");
          await this.page.keyboard.up("Shift");
        }
      }

      // Press Enter to send
      await this.page.keyboard.press("Enter");
      await this.page.waitForTimeout(500);

      logger.info({ correlationId: request.correlationId }, "WhatsApp reply sent successfully");

      return {
        success: true,
        deliveredMessageId: `wa-out-${Date.now()}`,
        deliveredAt: new Date().toISOString(),
      };
    } catch (err: any) {
      logger.error({ error: err.message, correlationId: request.correlationId }, "Failed to send WhatsApp reply");
      return {
        success: false,
        deliveredAt: new Date().toISOString(),
        error: err.message,
        retryable: true,
      };
    } finally {
      this.isSendingReply = false;
    }
  }

  /**
   * Monitor authentication state (detect QR code vs loaded main screen)
   */
  private async monitorAuthState(): Promise<void> {
    if (!this.page) return;

    try {
      // Robust modern selectors for WhatsApp Web
      const qrSelector = "canvas, [data-ref], [data-testid='qrcode'], div[aria-label*='Scan']";
      const mainChatSelector = "#side, [data-testid='chat-list'], header, div[role='textbox'], [aria-label='Chat list']";

      const matched = await Promise.race([
        this.page.waitForSelector(mainChatSelector, { timeout: 25000 }).then(() => "chat_list"),
        this.page.waitForSelector(qrSelector, { timeout: 25000 }).then(() => "qr_code"),
      ]).catch(() => "unknown");

      if (matched === "chat_list") {
        this.sessionState = "authenticated";
        this.qrCodeDataUrl = null;
        logger.info("WhatsApp Web already authenticated using saved profile.");
        await this.setupMessageListener();
      } else {
        this.sessionState = "needs_qr_login";
        logger.warn(
          "WhatsApp Web requires QR code authentication. Monitoring QR code for scan..."
        );
        await this.captureQrCode();
        this.startQrPollingAndLoginWatch(mainChatSelector);
      }
    } catch (err: any) {
      this.sessionState = "error";
      logger.error({ error: err.message }, "Error detecting WhatsApp Web authentication state");
    }
  }

  private async captureQrCode(): Promise<void> {
    if (!this.page || this.page.isClosed()) return;
    try {
      const dataUrl = await this.page.evaluate(() => {
        const canvas = document.querySelector("canvas");
        return canvas ? canvas.toDataURL("image/png") : null;
      });
      if (dataUrl) {
        this.qrCodeDataUrl = dataUrl;
      }
    } catch {
      // Ignore transient evaluate issues during re-renders
    }
  }

  private startQrPollingAndLoginWatch(mainChatSelector: string): void {
    if (this.qrPollTimer) {
      clearInterval(this.qrPollTimer);
    }

    this.qrPollTimer = setInterval(async () => {
      if (!this.page || this.page.isClosed()) {
        if (this.qrPollTimer) {
          clearInterval(this.qrPollTimer);
          this.qrPollTimer = null;
        }
        return;
      }

      try {
        const isAuth = await this.page.evaluate((sel) => {
          return !!document.querySelector(sel);
        }, mainChatSelector);

        if (isAuth) {
          if (this.qrPollTimer) {
            clearInterval(this.qrPollTimer);
            this.qrPollTimer = null;
          }
          this.sessionState = "authenticated";
          this.qrCodeDataUrl = null;
          logger.info("QR scan confirmed. WhatsApp Web authenticated successfully!");
          await this.setupMessageListener();
          return;
        }

        // Keep QR image fresh
        await this.captureQrCode();
      } catch {
        // Page may be re-rendering
      }
    }, 2000);
  }

  public async ensureConversationOpen(): Promise<void> {
    if (!this.page || this.page.isClosed()) return;
    try {
      await this.page.evaluate(() => {
        // If message textbox is already present, conversation is already open
        if (document.querySelector("footer div[contenteditable='true'][role='textbox']")) {
          return;
        }

        // Search for self chat '(You)' in chat list and click it
        const chatListSpans = Array.from(
          document.querySelectorAll("#pane-side span, div[data-testid='chat-list'] span, #side span")
        );
        const youSpan = chatListSpans.find((s) => {
          const t = s.textContent || "";
          return t.includes("(You)") || t.includes("Message yourself");
        });

        if (youSpan) {
          const clickTarget =
            youSpan.closest("div[role='listitem'], div[data-testid='cell-frame-container']") || youSpan;
          (clickTarget as HTMLElement).click();
          return;
        }

        // Fallback: click first chat item in list
        const firstChat = document.querySelector(
          "#pane-side div[role='listitem'], [data-testid='chat-list'] div[role='listitem']"
        );
        if (firstChat) {
          (firstChat as HTMLElement).click();
        }
      });
    } catch {
      // Ignore transient DOM evaluation errors
    }
  }

  /**
   * Setup DOM observer to capture new messages in the self-chat or active conversation
   */
  private async setupMessageListener(): Promise<void> {
    if (!this.page) return;

    this.sessionState = "listening";
    logger.info("Initializing DOM observer for incoming WhatsApp messages");

    // Automatically click and open the self-chat conversation
    await this.ensureConversationOpen();
    setTimeout(() => this.ensureConversationOpen(), 2500);

    // Expose Node bridge function to browser context
    await this.page.exposeFunction("__wemoteit_on_message", async (rawMsg: {
      providerMessageId: string;
      text: string;
      senderId: string;
      timestamp: number;
    }) => {
      // Do not process messages while the bot is actively typing its own reply
      if (this.isSendingReply) {
        return;
      }

      // Do not process messages matching text recently sent by the bot
      if (this.recentSentTexts.has(rawMsg.text.trim())) {
        return;
      }

      // Ignore bot notification prefixes in self-chat to prevent feedback loops
      if (/^[⚠️✅⏳🔒🛑🤖💻📊📂📋🔍🌙☀️🔋💾⚡📸]/.test(rawMsg.text.trim())) {
        return;
      }

      // Historical message exclusion
      if (this.seenProviderMessageIds.has(rawMsg.providerMessageId)) {
        return;
      }
      this.seenProviderMessageIds.add(rawMsg.providerMessageId);

      // Exclude messages timestamped prior to startup
      if (rawMsg.timestamp && rawMsg.timestamp < this.startupTime - 5000) {
        logger.debug({ id: rawMsg.providerMessageId }, "Ignoring historical message");
        return;
      }

      logger.info(
        { providerMessageId: rawMsg.providerMessageId, text: rawMsg.text.slice(0, 50) },
        "New WhatsApp message detected from active conversation"
      );

      if (this.messageHandler) {
        const normalized: NormalizedIncomingMessage = NormalizedIncomingMessageSchema.parse({
          id: `wa-${rawMsg.providerMessageId.slice(0, 16)}`,
          schemaVersion: 1,
          workspaceId: this.config.workspaceId,
          channelConnectionId: this.config.channelConnectionId,
          sourceType: "whatsapp",
          providerMessageId: rawMsg.providerMessageId,
          conversationId: this.config.authorizedConversationId,
          senderId: rawMsg.senderId || this.config.authorizedSenderId,
          senderType: "user",
          messageType: "text",
          text: rawMsg.text,
          attachments: [],
          receivedAt: new Date(rawMsg.timestamp || Date.now()).toISOString(),
          correlationId: `corr-wa-${rawMsg.providerMessageId.slice(0, 12)}`,
          metadata: {
            rawProviderId: rawMsg.providerMessageId,
          },
        });

        await this.messageHandler(normalized);
      }
    });

    // Inject MutationObserver into the page to detect newly rendered messages
    await this.page.evaluate(() => {
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of Array.from(mutation.addedNodes)) {
            if (node instanceof HTMLElement) {
              const msgContainer = node.matches("[data-id]") ? node : node.querySelector("[data-id]");
              if (msgContainer) {
                const dataId = msgContainer.getAttribute("data-id") || "";
                const textElem =
                  msgContainer.querySelector(".selectable-text") ||
                  msgContainer.querySelector("span[dir='ltr']") ||
                  msgContainer;
                const text = textElem.textContent || "";

                if (dataId && text.trim()) {
                  // data-id format in WhatsApp Web: [fromMe]_[remoteJid]_[messageId]
                  const parts = dataId.split("_");
                  const isFromMe = parts[0] === "true";
                  const providerMessageId = parts.length >= 3 ? parts[2] : dataId;
                  const rawSender = parts.length >= 2 ? parts[1] : "self";
                  const cleanSender = rawSender.replace(/@(c\.us|s\.whatsapp\.net)$/, "");
                  const senderId = isFromMe ? "self" : cleanSender;

                  (window as any).__wemoteit_on_message({
                    providerMessageId,
                    text: text.trim(),
                    senderId,
                    timestamp: Date.now(),
                  });
                }
              }
            }
          }
        }
      });

      const messagePanel =
        document.querySelector("[data-testid='conversation-panel-messages']") ||
        document.querySelector("div[role='application']") ||
        document.body;

      observer.observe(messagePanel, { childList: true, subtree: true });
    });

    logger.info("WhatsApp Web MutationObserver attached and active.");
  }
}

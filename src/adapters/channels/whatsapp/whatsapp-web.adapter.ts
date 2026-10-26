import path from "node:path";
import fs from "node:fs";
import { chromium, BrowserContext, Page } from "playwright";
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
  private sessionState: WhatsAppSessionState = "uninitialized";
  private messageHandler: ((message: NormalizedIncomingMessage) => Promise<void>) | null = null;

  // Historical message tracking to avoid processing old messages on startup
  private seenProviderMessageIds = new Set<string>();
  private startupTime = Date.now();

  constructor(private readonly config: WhatsAppAdapterConfig) {}

  public getSessionState(): WhatsAppSessionState {
    return this.sessionState;
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
    logger.info({ headless: this.config.headless }, "Launching WhatsApp Web browser context");

    const sessionDir = path.resolve(process.cwd(), this.config.sessionDataDir);

    try {
      // Prefer Microsoft Edge or Google Chrome available on host
      const browserChannel = this.config.browserChannel || "msedge";

      this.context = await chromium.launchPersistentContext(sessionDir, {
        channel: browserChannel,
        headless: this.config.headless,
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
    try {
      if (this.context) {
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
      // Find main message input field
      const inputSelector = "footer div[contenteditable='true'][role='textbox']";
      await this.page.waitForSelector(inputSelector, { timeout: 10000 });

      // Focus and type text
      await this.page.click(inputSelector);

      // Paste or insert message lines safely
      const lines = request.text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        await this.page.keyboard.type(lines[i], { delay: 10 });
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
    }
  }

  /**
   * Monitor authentication state (detect QR code vs loaded main screen)
   */
  private async monitorAuthState(): Promise<void> {
    if (!this.page) return;

    try {
      // Race between QR Code canvas and main conversation list
      const qrSelector = "canvas[aria-label*='Scan'], [data-ref]";
      const mainChatSelector = "#side, [data-testid='chat-list'], header";

      const matched = await Promise.race([
        this.page.waitForSelector(mainChatSelector, { timeout: 45000 }).then(() => "chat_list"),
        this.page.waitForSelector(qrSelector, { timeout: 45000 }).then(() => "qr_code"),
      ]);

      if (matched === "qr_code") {
        this.sessionState = "needs_qr_login";
        logger.warn(
          "WhatsApp Web requires QR code authentication. Please scan the QR code in the browser window to link your session."
        );

        // Wait until user scans and chat list loads
        await this.page.waitForSelector(mainChatSelector, { timeout: 300000 });
        this.sessionState = "authenticated";
        logger.info("QR scan confirmed. WhatsApp Web authenticated successfully!");
      } else {
        this.sessionState = "authenticated";
        logger.info("WhatsApp Web already authenticated using saved profile.");
      }

      await this.setupMessageListener();
    } catch (err: any) {
      this.sessionState = "error";
      logger.error({ error: err.message }, "Error detecting WhatsApp Web authentication state");
    }
  }

  /**
   * Setup DOM observer to capture new messages in the self-chat or active conversation
   */
  private async setupMessageListener(): Promise<void> {
    if (!this.page) return;

    this.sessionState = "listening";
    logger.info("Initializing DOM observer for incoming WhatsApp messages");

    // Expose Node bridge function to browser context
    await this.page.exposeFunction("__wemoteit_on_message", async (rawMsg: {
      providerMessageId: string;
      text: string;
      senderId: string;
      timestamp: number;
    }) => {
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
                  const providerMessageId = parts.length >= 3 ? parts[2] : dataId;
                  const senderId = parts.length >= 2 ? parts[1] : "self";

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

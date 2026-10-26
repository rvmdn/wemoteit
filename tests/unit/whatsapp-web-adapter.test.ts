import { describe, it, expect, beforeEach } from "vitest";
import { WhatsAppWebAdapter } from "../../src/adapters/channels/whatsapp/whatsapp-web.adapter.js";
import { NormalizedIncomingMessage } from "../../src/domain/message/message.entity.js";

describe("WhatsApp Web Adapter Specification & Lifecycle", () => {
  let adapter: WhatsAppWebAdapter;

  beforeEach(() => {
    adapter = new WhatsAppWebAdapter({
      workspaceId: "ws-primary",
      channelConnectionId: "conn-wa-1",
      authorizedSenderId: "self",
      authorizedConversationId: "self",
      sessionDataDir: "./data/test_whatsapp_session",
      headless: true,
      browserChannel: "msedge",
    });
  });

  it("initializes with uninitialized state", () => {
    expect(adapter.provider).toBe("whatsapp");
    expect(adapter.getSessionState()).toBe("uninitialized");
  });

  it("reports unhealthy when uninitialized", async () => {
    const health = await adapter.healthCheck();
    expect(health.status).toBe("unhealthy");
    expect(health.details?.sessionState).toBe("uninitialized");
  });

  it("exposes onMessage handler registration", () => {
    let captured: NormalizedIncomingMessage | null = null;
    adapter.onMessage(async (msg) => {
      captured = msg;
    });

    expect(adapter.getSessionState()).toBe("uninitialized");
  });
});

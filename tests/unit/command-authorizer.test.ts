import { describe, it, expect } from "vitest";
import { CommandAuthorizer } from "../../src/application/authorization/command-authorizer.js";
import { ConfigService } from "../../src/adapters/configuration/config.service.js";
import { NormalizedIncomingMessage } from "../../src/domain/message/message.entity.js";

describe("Command Authorizer", () => {
  const configService = new ConfigService();
  const authorizer = new CommandAuthorizer(configService);

  const baseMessage: NormalizedIncomingMessage = {
    id: "msg-test",
    schemaVersion: 1,
    workspaceId: "ws-primary",
    channelConnectionId: "conn-mock",
    sourceType: "mock",
    providerMessageId: "prov-1",
    conversationId: "chat_123",
    senderId: "user_123",
    senderType: "user",
    messageType: "text",
    text: "/help",
    attachments: [],
    receivedAt: new Date().toISOString(),
    correlationId: "corr-1",
    metadata: {},
  };

  it("authorizes valid sender and /help command", () => {
    const res = authorizer.authorizeAndParse(baseMessage);
    expect(res.decision).toBe("allow");
    expect(res.command?.commandType).toBe("help");
  });

  it("denies unauthorized sender", () => {
    const unauthorizedMsg = {
      ...baseMessage,
      senderId: "evil_hacker",
    };
    const res = authorizer.authorizeAndParse(unauthorizedMsg);
    expect(res.decision).toBe("deny");
    expect(res.reason).toContain("not authorized");
  });

  it("denies unauthorized conversation", () => {
    const unauthorizedChat = {
      ...baseMessage,
      conversationId: "random_group_chat",
    };
    const res = authorizer.authorizeAndParse(unauthorizedChat);
    expect(res.decision).toBe("deny");
    expect(res.reason).toContain("not authorized");
  });

  it("allows read-only repository review", () => {
    const msg = {
      ...baseMessage,
      text: "/review wedocit check editor tests",
    };
    const res = authorizer.authorizeAndParse(msg);
    expect(res.decision).toBe("allow");
    expect(res.command?.commandType).toBe("review_repository");
    expect(res.command?.targetRepositoryId).toBe("wedocit");
  });

  it("requires approval for mutating tasks when policy demands it", () => {
    const msg = {
      ...baseMessage,
      text: "/run wedocit refactor content.js",
    };
    const res = authorizer.authorizeAndParse(msg);
    expect(res.decision).toBe("require_approval");
    expect(res.command?.commandType).toBe("run_task");
  });

  it("allows mutating tasks when approval token is supplied", () => {
    const msg = {
      ...baseMessage,
      text: "/run wedocit refactor content.js --approve=tok123",
    };
    const res = authorizer.authorizeAndParse(msg);
    expect(res.decision).toBe("allow");
    expect(res.command?.approvalToken).toBe("tok123");
  });
});

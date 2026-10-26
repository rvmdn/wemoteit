import { describe, it, expect } from "vitest";
import { CommandAuthorizer } from "../../src/application/authorization/command-authorizer.js";
import { ConfigService } from "../../src/adapters/configuration/config.service.js";
import { NormalizedIncomingMessage } from "../../src/domain/message/message.entity.js";

describe("Path Traversal & Boundary Security (Phase 3)", () => {
  const configService = new ConfigService();
  const authorizer = new CommandAuthorizer(configService);

  const baseMessage: NormalizedIncomingMessage = {
    id: "msg-sec-test",
    schemaVersion: 1,
    workspaceId: "ws-primary",
    channelConnectionId: "conn-mock",
    sourceType: "mock",
    providerMessageId: "prov-sec-1",
    conversationId: "chat_123",
    senderId: "user_123",
    senderType: "user",
    messageType: "text",
    text: "",
    attachments: [],
    receivedAt: new Date().toISOString(),
    correlationId: "corr-sec-1",
    metadata: {},
  };

  it("rejects path traversal with parent directory reference (../)", () => {
    const msg = {
      ...baseMessage,
      text: "/review ../../etc/passwd",
    };
    const res = authorizer.authorizeAndParse(msg);
    expect(res.decision).toBe("deny");
    expect(res.reason).toContain("Path traversal");
  });

  it("rejects path traversal with backslashes (..\\)", () => {
    const msg = {
      ...baseMessage,
      text: "/review ..\\..\\windows\\system32",
    };
    const res = authorizer.authorizeAndParse(msg);
    expect(res.decision).toBe("deny");
    expect(res.reason).toContain("Path traversal");
  });

  it("rejects unregistered repository aliases", () => {
    const msg = {
      ...baseMessage,
      text: "/review secret_internal_repo",
    };
    const res = authorizer.authorizeAndParse(msg);
    expect(res.decision).toBe("deny");
    expect(res.reason).toContain("not registered");
  });

  it("allows authorized repository alias without path traversal", () => {
    const msg = {
      ...baseMessage,
      text: "/review wedocit inspect parser logic",
    };
    const res = authorizer.authorizeAndParse(msg);
    expect(res.decision).toBe("allow");
    expect(res.command?.targetRepositoryId).toBe("wedocit");
  });
});

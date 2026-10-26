import { describe, it, expect } from "vitest";
import {
  WorkspaceSchema,
  JobSchema,
  canTransitionJob,
  NormalizedIncomingMessageSchema,
} from "../../src/domain/index.js";

describe("Domain Entities & State Machine", () => {
  it("validates valid workspace schema", () => {
    const ws = WorkspaceSchema.parse({
      id: "ws-1",
      name: "Primary Workspace",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(ws.status).toBe("active");
    expect(ws.schemaVersion).toBe(1);
  });

  it("rejects invalid workspace status", () => {
    expect(() =>
      WorkspaceSchema.parse({
        id: "ws-1",
        name: "Test",
        status: "invalid_status",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    ).toThrow();
  });

  it("validates incoming message with text", () => {
    const msg = NormalizedIncomingMessageSchema.parse({
      id: "msg-123",
      workspaceId: "ws-1",
      channelConnectionId: "conn-1",
      sourceType: "whatsapp",
      providerMessageId: "prov-1",
      conversationId: "self",
      senderId: "self",
      text: "/status",
      receivedAt: new Date().toISOString(),
      correlationId: "corr-1",
    });
    expect(msg.messageType).toBe("text");
  });

  it("enforces valid job state transitions", () => {
    expect(canTransitionJob("received", "validated")).toBe(true);
    expect(canTransitionJob("validated", "queued")).toBe(true);
    expect(canTransitionJob("queued", "running")).toBe(true);
    expect(canTransitionJob("running", "completed")).toBe(true);
    expect(canTransitionJob("running", "cancel_requested")).toBe(true);
    expect(canTransitionJob("cancel_requested", "cancelled")).toBe(true);

    // Invalid transitions
    expect(canTransitionJob("completed", "running")).toBe(false);
    expect(canTransitionJob("cancelled", "queued")).toBe(false);
    expect(canTransitionJob("received", "completed")).toBe(false);
  });
});

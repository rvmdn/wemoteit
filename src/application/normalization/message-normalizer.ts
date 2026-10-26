import crypto from "node:crypto";
import {
  NormalizedIncomingMessage,
  NormalizedIncomingMessageSchema,
  MessageSourceType,
} from "../../domain/message/message.entity.js";
import { ValidationError } from "../../shared/errors/app-error.js";

export interface RawIncomingMessage {
  workspaceId: string;
  channelConnectionId: string;
  sourceType: MessageSourceType;
  providerMessageId: string;
  conversationId: string;
  senderId: string;
  senderType?: "user" | "bot" | "system";
  text: string;
  attachments?: Array<{
    id: string;
    mimeType: string;
    filename?: string;
    fileSize?: number;
    storagePath: string;
  }>;
  receivedAt?: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}

export class MessageNormalizer {
  public static normalize(raw: RawIncomingMessage): NormalizedIncomingMessage {
    if (!raw.text && (!raw.attachments || raw.attachments.length === 0)) {
      throw new ValidationError("Message must contain text or attachments");
    }

    const trimmedText = (raw.text || "").trim();
    if (trimmedText.length > 8000) {
      throw new ValidationError("Message text exceeds maximum length of 8,000 characters");
    }

    const correlationId =
      raw.correlationId ||
      `corr-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;

    const normalizedId = `msg-${crypto
      .createHash("sha256")
      .update(`${raw.channelConnectionId}:${raw.providerMessageId}`)
      .digest("hex")
      .slice(0, 16)}`;

    const candidate: NormalizedIncomingMessage = {
      id: normalizedId,
      schemaVersion: 1,
      workspaceId: raw.workspaceId,
      channelConnectionId: raw.channelConnectionId,
      sourceType: raw.sourceType,
      providerMessageId: raw.providerMessageId,
      conversationId: raw.conversationId,
      senderId: raw.senderId,
      senderType: raw.senderType || "user",
      messageType: raw.attachments && raw.attachments.length > 0 ? "document" : "text",
      text: trimmedText,
      attachments: raw.attachments || [],
      receivedAt: raw.receivedAt || new Date().toISOString(),
      correlationId,
      metadata: raw.metadata || {},
    };

    return NormalizedIncomingMessageSchema.parse(candidate);
  }
}

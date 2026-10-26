import { z } from "zod";

export const MessageSourceTypeSchema = z.enum(["whatsapp", "mock", "webhook", "cli"]);
export type MessageSourceType = z.infer<typeof MessageSourceTypeSchema>;

export const MessageTypeSchema = z.enum(["text", "image", "document", "system"]);
export type MessageType = z.infer<typeof MessageTypeSchema>;

export const AttachmentReferenceSchema = z.object({
  id: z.string().min(1),
  mimeType: z.string(),
  filename: z.string().optional(),
  fileSize: z.number().int().nonnegative().optional(),
  storagePath: z.string(),
});
export type AttachmentReference = z.infer<typeof AttachmentReferenceSchema>;

export const NormalizedIncomingMessageSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(1).default(1),
  workspaceId: z.string().min(1),
  channelConnectionId: z.string().min(1),
  sourceType: MessageSourceTypeSchema,
  providerMessageId: z.string().min(1),
  conversationId: z.string().min(1),
  senderId: z.string().min(1),
  senderType: z.enum(["user", "bot", "system"]).default("user"),
  messageType: MessageTypeSchema.default("text"),
  text: z.string().max(8000),
  attachments: z.array(AttachmentReferenceSchema).default([]),
  receivedAt: z.string().datetime(),
  correlationId: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type NormalizedIncomingMessage = z.infer<typeof NormalizedIncomingMessageSchema>;

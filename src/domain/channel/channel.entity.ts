import { z } from "zod";

export const ChannelProviderSchema = z.enum(["whatsapp", "mock", "telegram"]);
export type ChannelProvider = z.infer<typeof ChannelProviderSchema>;

export const ChannelConnectionStatusSchema = z.enum([
  "disconnected",
  "connecting",
  "connected",
  "error",
]);
export type ChannelConnectionStatus = z.infer<typeof ChannelConnectionStatusSchema>;

export const ChannelDefinitionSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(1).default(1),
  provider: ChannelProviderSchema,
  displayName: z.string().min(1),
  enabled: z.boolean().default(true),
  capabilities: z.array(z.string()).default([]),
  configuration: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ChannelDefinition = z.infer<typeof ChannelDefinitionSchema>;

export const ChannelConnectionSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  channelDefinitionId: z.string().min(1),
  status: ChannelConnectionStatusSchema.default("disconnected"),
  healthStatus: z.string().default("healthy"),
  lastConnectedAt: z.string().datetime().nullable().default(null),
  lastErrorCode: z.string().nullable().default(null),
  configurationRef: z.string().nullable().default(null),
});
export type ChannelConnection = z.infer<typeof ChannelConnectionSchema>;

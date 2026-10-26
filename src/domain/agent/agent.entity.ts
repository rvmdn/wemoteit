import { z } from "zod";

export const AgentExecutionModeSchema = z.enum([
  "cli",
  "sdk",
  "ui_automation",
  "mock",
]);
export type AgentExecutionMode = z.infer<typeof AgentExecutionModeSchema>;

export const AgentProfileSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(1).default(1),
  provider: z.string().min(1),
  displayName: z.string().min(1),
  enabled: z.boolean().default(true),
  capabilities: z.array(z.string()).default([]),
  supportedOperations: z.array(z.string()).default([]),
  executionMode: AgentExecutionModeSchema.default("mock"),
  configurationRef: z.string().nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AgentProfile = z.infer<typeof AgentProfileSchema>;

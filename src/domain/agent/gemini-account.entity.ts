import { z } from "zod";

export const GeminiAccountStatusSchema = z.enum([
  "active",
  "cooling_down",
  "exhausted",
  "disabled",
]);
export type GeminiAccountStatus = z.infer<typeof GeminiAccountStatusSchema>;

export const GeminiAccountTierSchema = z.enum(["free", "payg"]);
export type GeminiAccountTier = z.infer<typeof GeminiAccountTierSchema>;

export const GeminiAccountInstanceSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(1).default(1),
  label: z.string().min(1),
  apiKey: z.string().min(1),
  model: z.string().default("gemini-1.5-pro"),
  tier: GeminiAccountTierSchema.default("free"),
  status: GeminiAccountStatusSchema.default("active"),
  priority: z.number().int().default(1),
  requestsToday: z.number().int().default(0),
  cooldownUntil: z.string().nullable().default(null),
  lastUsedAt: z.string().nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type GeminiAccountInstance = z.infer<typeof GeminiAccountInstanceSchema>;

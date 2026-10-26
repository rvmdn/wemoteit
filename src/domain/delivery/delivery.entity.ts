import { z } from "zod";

export const DeliveryAttemptStatusSchema = z.enum(["pending", "delivered", "failed"]);
export type DeliveryAttemptStatus = z.infer<typeof DeliveryAttemptStatusSchema>;

export const DeliveryAttemptSchema = z.object({
  id: z.string().min(1),
  jobId: z.string().min(1),
  channelConnectionId: z.string().min(1),
  conversationId: z.string().min(1),
  status: DeliveryAttemptStatusSchema,
  errorMessage: z.string().nullable().default(null),
  attempt: z.number().int().default(1),
  deliveredAt: z.string().datetime().nullable().default(null),
  correlationId: z.string().min(1),
});

export type DeliveryAttempt = z.infer<typeof DeliveryAttemptSchema>;

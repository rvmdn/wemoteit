import { z } from "zod";

export const AuditEventTypeSchema = z.enum([
  "message_received",
  "message_rejected",
  "command_parsed",
  "authorization_allowed",
  "authorization_denied",
  "approval_requested",
  "job_created",
  "job_state_changed",
  "execution_started",
  "execution_completed",
  "execution_failed",
  "delivery_attempted",
  "delivery_succeeded",
  "delivery_failed",
  "config_changed",
]);
export type AuditEventType = z.infer<typeof AuditEventTypeSchema>;

export const AuditEventSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(1).default(1),
  workspaceId: z.string().min(1),
  actorType: z.enum(["user", "system", "agent", "channel"]),
  actorId: z.string().min(1),
  eventType: AuditEventTypeSchema,
  resourceType: z.string().min(1),
  resourceId: z.string().min(1),
  outcome: z.enum(["success", "denied", "failure", "pending"]),
  reasonCode: z.string().nullable().default(null),
  correlationId: z.string().min(1),
  occurredAt: z.string().datetime(),
  details: z.record(z.string(), z.unknown()).default({}),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

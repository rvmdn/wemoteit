import { z } from "zod";

export const JobStatusSchema = z.enum([
  "received",
  "validated",
  "queued",
  "running",
  "completed",
  "failed",
  "cancel_requested",
  "cancelled",
]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const ValidJobTransitions: Record<JobStatus, JobStatus[]> = {
  received: ["validated", "failed"],
  validated: ["queued", "failed"],
  queued: ["running", "cancel_requested", "failed"],
  running: ["completed", "failed", "cancel_requested"],
  cancel_requested: ["cancelled", "failed"],
  completed: [],
  failed: [],
  cancelled: [],
};

export function canTransitionJob(from: JobStatus, to: JobStatus): boolean {
  return ValidJobTransitions[from]?.includes(to) ?? false;
}

export const JobSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(1).default(1),
  workspaceId: z.string().min(1),
  commandId: z.string().min(1),
  sourceMessageId: z.string().min(1),
  repositoryId: z.string().nullable().default(null),
  agentProfileId: z.string().min(1),
  status: JobStatusSchema.default("received"),
  priority: z.number().int().default(0),
  attempt: z.number().int().default(0),
  maxAttempts: z.number().int().default(3),
  idempotencyKey: z.string().min(1),
  correlationId: z.string().min(1),
  resultRef: z.string().nullable().default(null),
  errorCode: z.string().nullable().default(null),
  errorSummary: z.string().nullable().default(null),
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable().default(null),
  completedAt: z.string().datetime().nullable().default(null),
  updatedAt: z.string().datetime(),
});
export type Job = z.infer<typeof JobSchema>;

export const JobStateTransitionSchema = z.object({
  id: z.string().min(1),
  jobId: z.string().min(1),
  fromStatus: JobStatusSchema,
  toStatus: JobStatusSchema,
  reason: z.string().optional(),
  occurredAt: z.string().datetime(),
});
export type JobStateTransition = z.infer<typeof JobStateTransitionSchema>;

import { z } from "zod";

export const ExecutionResultStatusSchema = z.enum(["success", "failure", "cancelled", "timeout"]);
export type ExecutionResultStatus = z.infer<typeof ExecutionResultStatusSchema>;

export const ResultArtifactSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mimeType: z.string().default("text/plain"),
  path: z.string().min(1),
  sizeBytes: z.number().int().nonnegative().optional(),
});
export type ResultArtifact = z.infer<typeof ResultArtifactSchema>;

export const ExecutionResultSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(1).default(1),
  jobId: z.string().min(1),
  status: ExecutionResultStatusSchema,
  summary: z.string().max(4000),
  outputRef: z.string().nullable().default(null),
  artifacts: z.array(ResultArtifactSchema).default([]),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  durationMs: z.number().int().nonnegative(),
  errorCode: z.string().nullable().default(null),
  correlationId: z.string().min(1),
});
export type ExecutionResult = z.infer<typeof ExecutionResultSchema>;

import { z } from "zod";

export const CommandTypeSchema = z.enum([
  "help",
  "status",
  "list_repositories",
  "job_status",
  "review_repository",
  "run_task",
  "cancel_job",
]);
export type CommandType = z.infer<typeof CommandTypeSchema>;

export const AuthorizationDecisionSchema = z.enum([
  "allow",
  "deny",
  "require_approval",
]);
export type AuthorizationDecision = z.infer<typeof AuthorizationDecisionSchema>;

export const CommandSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(1).default(1),
  workspaceId: z.string().min(1),
  commandType: CommandTypeSchema,
  requestedAction: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()).default({}),
  targetRepositoryId: z.string().nullable().default(null),
  targetAgentProfileId: z.string().nullable().default(null),
  authorizationDecision: AuthorizationDecisionSchema,
  authorizationReason: z.string().optional(),
  approvalRequirement: z.boolean().default(false),
  approvalToken: z.string().nullable().default(null),
  sourceMessageId: z.string().min(1),
  correlationId: z.string().min(1),
  createdAt: z.string().datetime(),
});
export type Command = z.infer<typeof CommandSchema>;

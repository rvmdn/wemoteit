import { z } from "zod";

export const ApprovalStatusSchema = z.enum(["pending", "approved", "rejected", "expired"]);
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;

export const PendingApprovalSchema = z.object({
  id: z.string().min(1),
  commandId: z.string().min(1),
  token: z.string().min(1),
  workspaceId: z.string().min(1),
  requestedBy: z.string().min(1),
  action: z.string().min(1),
  repositoryId: z.string().nullable().default(null),
  prompt: z.string().min(1),
  expiresAt: z.string().datetime(),
  status: ApprovalStatusSchema.default("pending"),
  createdAt: z.string().datetime(),
});

export type PendingApproval = z.infer<typeof PendingApprovalSchema>;

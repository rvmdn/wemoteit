import { z } from "zod";

export const RepositoryOperationSchema = z.enum([
  "read",
  "review",
  "modify",
  "test",
  "commit",
]);
export type RepositoryOperation = z.infer<typeof RepositoryOperationSchema>;

export const RepositoryProfileSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(1).default(1),
  workspaceId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  path: z.string().min(1),
  allowedOperations: z.array(RepositoryOperationSchema).default(["read", "review"]),
  allowedBranches: z.array(z.string()).default(["main", "master", "develop"]),
  enabled: z.boolean().default(true),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type RepositoryProfile = z.infer<typeof RepositoryProfileSchema>;

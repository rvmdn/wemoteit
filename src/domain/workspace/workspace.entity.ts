import { z } from "zod";

export const WorkspaceStatusSchema = z.enum(["active", "suspended", "archived"]);
export type WorkspaceStatus = z.infer<typeof WorkspaceStatusSchema>;

export const WorkspaceSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(1).default(1),
  name: z.string().min(1),
  status: WorkspaceStatusSchema.default("active"),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Workspace = z.infer<typeof WorkspaceSchema>;

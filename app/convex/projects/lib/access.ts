import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import type { QueryCtx, MutationCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";

export async function requireUser(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError("Sign in to access your projects.");
  return userId;
}
export async function requireProject(
  ctx: QueryCtx | MutationCtx,
  id: Id<"projects">,
) {
  const userId = await requireUser(ctx);
  const project = await ctx.db.get("projects", id);
  if (!project || project.ownerId !== userId)
    throw new ConvexError("Project not found.");
  return project;
}

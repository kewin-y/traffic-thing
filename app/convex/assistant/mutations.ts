import { createThread } from "@convex-dev/agent";
import { ConvexError, v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { components } from "../_generated/api";
import { requireProject } from "../projects/lib/access";

export const begin = internalMutation({
  args: { projectId: v.id("projects"), requestId: v.string() },
  returns: v.string(),
  handler: async (ctx, { projectId, requestId }) => {
    const project = await requireProject(ctx, projectId);
    const existing = await ctx.db
      .query("assistantThreads")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .unique();
    if (existing && (existing.busyUntil ?? 0) > Date.now())
      throw new ConvexError(
        "The assistant is already replying to this project. Try again shortly.",
      );
    const lock = { activeRequest: requestId, busyUntil: Date.now() + 120_000 };
    if (existing) {
      await ctx.db.patch("assistantThreads", existing._id, lock);
      return existing.threadId;
    }
    const threadId = await createThread(ctx, components.agent, {
      userId: project.ownerId,
    });
    await ctx.db.insert("assistantThreads", { projectId, threadId, ...lock });
    return threadId;
  },
});

export const finish = internalMutation({
  args: { projectId: v.id("projects"), requestId: v.string() },
  returns: v.null(),
  handler: async (ctx, { projectId, requestId }) => {
    const thread = await ctx.db
      .query("assistantThreads")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .unique();
    if (thread?.activeRequest === requestId)
      await ctx.db.patch("assistantThreads", thread._id, {
        activeRequest: undefined,
        busyUntil: undefined,
      });
    return null;
  },
});

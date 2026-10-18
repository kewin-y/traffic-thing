import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import {
  listUIMessages,
  syncStreams,
  vStreamArgs,
  vStreamMessagesReturnValue,
} from "@convex-dev/agent";
import { query } from "../_generated/server";
import { requireProject } from "../projects/lib/access";
import { components } from "../_generated/api";

export const thread = query({
  args: { projectId: v.id("projects") },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, { projectId }) => {
    await requireProject(ctx, projectId);
    const thread = await ctx.db
      .query("assistantThreads")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .unique();
    return thread?.threadId ?? null;
  },
});

export const listMessages = query({
  args: {
    projectId: v.id("projects"),
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: vStreamArgs,
  },
  returns: vStreamMessagesReturnValue.omit("page").extend({
    page: v.array(
      v.object({
        id: v.string(),
        key: v.string(),
        order: v.number(),
        stepOrder: v.number(),
        status: v.union(
          v.literal("pending"),
          v.literal("streaming"),
          v.literal("success"),
          v.literal("failed"),
        ),
        role: v.union(
          v.literal("user"),
          v.literal("assistant"),
          v.literal("system"),
        ),
        parts: v.array(v.object({ type: v.literal("text"), text: v.string() })),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    await requireProject(ctx, args.projectId);
    const thread = await ctx.db
      .query("assistantThreads")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .unique();
    if (thread?.threadId !== args.threadId)
      throw new Error("Conversation not found.");
    // useUIMessages requests numItems: 0 for its streaming-only subscription.
    if (
      !Number.isInteger(args.paginationOpts.numItems) ||
      args.paginationOpts.numItems < 0 ||
      args.paginationOpts.numItems > 100
    )
      throw new ConvexError("Load between 0 and 100 messages at a time.");
    const paginated = await listUIMessages(ctx, components.agent, args);
    const streams = await syncStreams(ctx, components.agent, args);
    return {
      ...paginated,
      streams,
      page: paginated.page.map((message) => ({
        id: message.id,
        key: message.key,
        order: message.order,
        stepOrder: message.stepOrder,
        status: message.status,
        role: message.role,
        parts: message.parts
          .filter((part) => part.type === "text")
          .map((part) => ({ type: "text" as const, text: part.text })),
      })),
    };
  },
});

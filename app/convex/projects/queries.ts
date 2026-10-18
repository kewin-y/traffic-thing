import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";
import { query } from "../_generated/server";
import { projectDocument, projectState } from "./schema";
import { requireProject, requireUser } from "./lib/access";

export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(projectDocument),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    return ctx.db
      .query("projects")
      .withIndex("by_ownerId_and_updatedAt", (q) => q.eq("ownerId", userId))
      .order("desc")
      .paginate(args.paginationOpts);
  },
});
export const get = query({
  args: { slug: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      project: projectDocument,
      revision: v.number(),
      state: projectState,
    }),
  ),
  handler: async (ctx, { slug }) => {
    const userId = await requireUser(ctx);
    const project = await ctx.db
      .query("projects")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (!project || project.ownerId !== userId) return null;
    const saved = await ctx.db
      .query("projectStates")
      .withIndex("by_projectId", (q) => q.eq("projectId", project._id))
      .unique();
    return saved
      ? { project, revision: saved.revision, state: saved.state }
      : null;
  },
});
export const getById = query({
  args: { id: v.id("projects") },
  returns: v.union(
    v.null(),
    v.object({
      project: projectDocument,
      revision: v.number(),
      state: projectState,
    }),
  ),
  handler: async (ctx, { id }) => {
    const project = await requireProject(ctx, id);
    const saved = await ctx.db
      .query("projectStates")
      .withIndex("by_projectId", (q) => q.eq("projectId", project._id))
      .unique();
    return saved ? { project, revision: saved.revision, state: saved.state } : null;
  },
});

export const currentOwner = query({
  args: {},
  returns: v.id("users"),
  handler: async (ctx) => requireUser(ctx),
});

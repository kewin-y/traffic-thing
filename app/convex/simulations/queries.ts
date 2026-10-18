import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";
import { query, internalQuery } from "../_generated/server";
import { requireProject, requireUser } from "../projects/lib/access";
import { projectState } from "../projects/schema";
import { runDocument } from "./schema";
import { roadEditValidator, roadEdits } from "./lib/edits";
import type { WorkerEdit } from "../../shared/simulations";
import { workerConfiguration } from "./lib/config";

export const configuration = query({
  args: {},
  returns: v.object({
    ready: v.boolean(),
    message: v.union(v.null(), v.string()),
  }),
  handler: async (ctx) => {
    await requireUser(ctx);
    const { ready, message } = workerConfiguration();
    return { ready, message };
  },
});
export const list = query({
  args: {
    projectId: v.id("projects"),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(runDocument),
  handler: async (ctx, args) => {
    await requireProject(ctx, args.projectId);
    return ctx.db
      .query("simulationRuns")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .paginate(args.paginationOpts);
  },
});
export const snapshot = query({
  args: { runId: v.id("simulationRuns") },
  returns: v.union(v.null(), projectState),
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get("simulationRuns", runId);
    if (!run) return null;
    await requireProject(ctx, run.projectId);
    return (
      (
        await ctx.db
          .query("simulationSnapshots")
          .withIndex("by_runId", (q) => q.eq("runId", runId))
          .unique()
      )?.state ?? null
    );
  },
});
export const recordingUrl = query({
  args: { runId: v.id("simulationRuns") },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get("simulationRuns", runId);
    if (!run) return null;
    await requireProject(ctx, run.projectId);
    return run.recordingStorageId
      ? ctx.storage.getUrl(run.recordingStorageId)
      : null;
  },
});
export const get = internalQuery({
  args: { runId: v.id("simulationRuns") },
  returns: v.union(v.null(), runDocument),
  handler: (ctx, { runId }) => ctx.db.get("simulationRuns", runId),
});
/** Road edits the run's snapshot scene implies, in the worker's protocol. */
export const editsForRun = internalQuery({
  args: { runId: v.id("simulationRuns") },
  returns: v.array(roadEditValidator),
  handler: async (ctx, { runId }) => {
    const snapshot = await ctx.db
      .query("simulationSnapshots")
      .withIndex("by_runId", (q) => q.eq("runId", runId))
      .unique();
    return roadEdits(snapshot?.state.scene ?? []) as WorkerEdit[];
  },
});
export const getByExternalId = internalQuery({
  args: { runId: v.string() },
  returns: v.union(v.null(), runDocument),
  handler: async (ctx, { runId }) => {
    const id = ctx.db.normalizeId("simulationRuns", runId);
    return id ? ctx.db.get("simulationRuns", id) : null;
  },
});

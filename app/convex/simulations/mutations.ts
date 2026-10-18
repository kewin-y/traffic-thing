import { ConvexError, v } from "convex/values";
import { mutation, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { requireProject } from "../projects/lib/access";
import { simulationSettingsSchema } from "../../shared/simulations";
import { settings, runDocument, resultSummary } from "./schema";
import { workerConfiguration } from "./lib/config";
import { simulationPool } from "./lib/pool";

export const start = mutation({
  args: {
    projectId: v.id("projects"),
    requestId: v.string(),
    expectedRevision: v.number(),
    settings,
  },
  returns: v.id("simulationRuns"),
  handler: async (ctx, args) => {
    const project = await requireProject(ctx, args.projectId);
    const parsed = simulationSettingsSchema.safeParse(args.settings);
    if (!parsed.success || !/^[a-zA-Z0-9_-]{16,128}$/.test(args.requestId))
      throw new ConvexError("Invalid simulation settings.");
    const existing = await ctx.db
      .query("simulationRuns")
      .withIndex("by_ownerId_and_requestId", (q) =>
        q.eq("ownerId", project.ownerId).eq("requestId", args.requestId),
      )
      .unique();
    if (existing) {
      if (
        existing.projectId !== project._id ||
        existing.projectRevision !== args.expectedRevision ||
        existing.settings.durationSeconds !== parsed.data.durationSeconds ||
        existing.settings.seed !== parsed.data.seed ||
        existing.settings.record !== parsed.data.record
      )
        throw new ConvexError("Submission token was already used.");
      return existing._id;
    }
    for (const status of ["queued", "running"] as const)
      if (
        await ctx.db
          .query("simulationRuns")
          .withIndex("by_projectId_and_status", (q) =>
            q.eq("projectId", project._id).eq("status", status),
          )
          .first()
      )
        throw new ConvexError("This project already has an active simulation.");
    const config = workerConfiguration();
    if (!config.ready) throw new ConvexError(config.message!);
    if (!project.network)
      throw new ConvexError(
        "This project has no published simulation network.",
      );
    const state = await ctx.db
      .query("projectStates")
      .withIndex("by_projectId", (q) => q.eq("projectId", project._id))
      .unique();
    if (!state || state.revision !== args.expectedRevision)
      throw new ConvexError("Save your latest map changes before simulating.");
    const runId = await ctx.db.insert("simulationRuns", {
      projectId: project._id,
      ownerId: project.ownerId,
      requestId: args.requestId,
      mode: "baseline",
      projectRevision: state.revision,
      projectName: project.name,
      network: project.network,
      settings: parsed.data,
      transport: config.transport,
      status: "queued",
      attempts: 0,
    });
    await ctx.db.insert("simulationSnapshots", { runId, state: state.state });
    if (config.transport === "push")
      await simulationPool.enqueueAction(
        ctx,
        internal.simulations.actions.dispatch,
        { runId },
        {
          onComplete: internal.simulations.actions.onComplete,
          context: { runId },
        },
      );
    return runId;
  },
});
export const claim = internalMutation({
  args: { runId: v.optional(v.id("simulationRuns")) },
  returns: v.union(v.null(), runDocument),
  handler: async (ctx, { runId }) => {
    for (let i = 0; i < 6; i++) {
      const run = runId
        ? await ctx.db.get("simulationRuns", runId)
        : ((await ctx.db
            .query("simulationRuns")
            .withIndex("by_transport_and_status_and_leaseExpiresAt", (q) =>
              q
                .eq("transport", "pull")
                .eq("status", "running")
                .lte("leaseExpiresAt", Date.now()),
            )
            .first()) ??
          (await ctx.db
            .query("simulationRuns")
            .withIndex("by_transport_and_status_and_leaseExpiresAt", (q) =>
              q.eq("transport", "pull").eq("status", "queued"),
            )
            .first()));
      if (!run || run.status === "succeeded" || run.status === "failed")
        return null;
      if (
        run.status === "running" &&
        (run.leaseExpiresAt ?? 0) > Date.now() &&
        (!runId || run.transport !== "push")
      )
        return null;
      if (run.attempts >= 5) {
        await ctx.db.patch("simulationRuns", run._id, {
          status: "failed",
          finishedAt: Date.now(),
          error: "Worker did not complete after five attempts.",
          leaseExpiresAt: undefined,
        });
        if (runId) return null;
        continue;
      }
      const patch = {
        status: "running" as const,
        attempts: run.attempts + 1,
        startedAt: run.startedAt ?? Date.now(),
        leaseExpiresAt: Date.now() + 600_000,
        error: undefined,
      };
      await ctx.db.patch("simulationRuns", run._id, patch);
      return { ...run, ...patch };
    }
    return null;
  },
});
export const finish = internalMutation({
  args: {
    runId: v.id("simulationRuns"),
    leaseId: v.number(),
    summary: v.optional(resultSummary),
    recordingStorageId: v.optional(v.string()),
    error: v.optional(v.string()),
    retryable: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get("simulationRuns", args.runId);
    if (!run || run.status !== "running" || run.attempts !== args.leaseId)
      return null;
    if (args.summary) {
      const storageId = args.recordingStorageId
        ? ctx.db.system.normalizeId("_storage", args.recordingStorageId)
        : null;
      if (
        run.settings.record &&
        (!storageId || !(await ctx.db.system.get("_storage", storageId)))
      )
        throw new Error("Recording upload is missing.");
      await ctx.db.patch("simulationRuns", run._id, {
        status: "succeeded",
        result: args.summary,
        recordingStorageId: storageId ?? undefined,
        finishedAt: Date.now(),
        leaseExpiresAt: undefined,
        error: undefined,
      });
    } else {
      const retry = args.retryable && run.attempts < 5;
      await ctx.db.patch("simulationRuns", run._id, {
        status: retry ? "queued" : "failed",
        finishedAt: retry ? undefined : Date.now(),
        leaseExpiresAt: undefined,
        error: args.error ?? "Simulation failed.",
      });
    }
    return null;
  },
});
export const exhausted = internalMutation({
  args: { runId: v.id("simulationRuns") },
  returns: v.null(),
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get("simulationRuns", runId);
    if (run && ["running", "queued"].includes(run.status))
      await ctx.db.patch("simulationRuns", runId, {
        status: "failed",
        finishedAt: Date.now(),
        leaseExpiresAt: undefined,
        error: "Worker could not complete this run. Please try again.",
      });
    return null;
  },
});

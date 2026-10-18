import { vOnCompleteValidator } from "@convex-dev/workpool";
import { v } from "convex/values";
import { internalAction, internalMutation, env } from "../_generated/server";
import { internal } from "../_generated/api";
import { workerConfiguration } from "./lib/config";
import { parseWorkerResult, workerRequest } from "./lib/result";

export const dispatch = internalAction({
  args: { runId: v.id("simulationRuns") },
  returns: v.null(),
  handler: async (ctx, { runId }) => {
    const run = await ctx.runMutation(internal.simulations.mutations.claim, {
      runId,
    });
    if (!run) return null;
    const finish = internal.simulations.mutations.finish;
    try {
      const config = workerConfiguration();
      if (!config.ready || config.transport !== "push")
        throw new Error("Worker configuration changed.");
      const response = await fetch(`${config.url}/simulate`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.WORKER_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(workerRequest(run)),
        redirect: "error",
        signal: AbortSignal.timeout(420_000),
      });
      if (!response.ok) {
        const retryable =
          response.status === 429 ||
          response.status === 503 ||
          (response.status >= 500 && response.status !== 504);
        await ctx.runMutation(finish, {
          runId,
          leaseId: run.attempts,
          error:
            response.status === 409
              ? "Worker network version does not match this project."
              : `Worker rejected the simulation (${response.status}).`,
          retryable,
        });
        if (retryable) throw new Error("Worker temporarily unavailable.");
        return null;
      }
      const result = parseWorkerResult(await response.json(), run);
      await ctx.runMutation(finish, {
        runId,
        leaseId: run.attempts,
        ...result,
      });
    } catch (error) {
      // A completed failure/success is never overwritten by a transport retry.
      const current = await ctx.runQuery(internal.simulations.queries.get, {
        runId,
      });
      if (current?.status === "running")
        await ctx.runMutation(finish, {
          runId,
          leaseId: run.attempts,
          error: "Worker connection failed or returned an invalid result.",
          retryable: true,
        });
      throw new Error(
        error instanceof Error &&
          error.message === "Worker temporarily unavailable."
          ? error.message
          : "Worker connection failed.",
      );
    }
    return null;
  },
});
export const onComplete = internalMutation({
  args: vOnCompleteValidator(v.object({ runId: v.id("simulationRuns") })),
  returns: v.null(),
  handler: async (ctx, { context, result }) => {
    if (result.kind !== "success")
      await ctx.runMutation(internal.simulations.mutations.exhausted, {
        runId: context.runId,
      });
    return null;
  },
});

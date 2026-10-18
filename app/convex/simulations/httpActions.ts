import { z } from "zod";
import { httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { authenticateWorker } from "../networks/httpActions";
import { parseWorkerResult, workerRequest } from "./lib/result";

export const claim = httpAction(async (ctx, request) => {
  const denied = await authenticateWorker(request);
  if (denied) return denied;
  const run = await ctx.runMutation(internal.simulations.mutations.claim, {});
  if (!run)
    return Response.json(null, { headers: { "Cache-Control": "no-store" } });
  const edits = await ctx.runQuery(
    internal.simulations.queries.editsForRun,
    { runId: run._id },
  );
  return Response.json(
    { runId: run._id, leaseId: run.attempts, request: workerRequest(run, edits) },
    { headers: { "Cache-Control": "no-store" } },
  );
});
const completion = z.object({
  runId: z.string(),
  leaseId: z.number().int().positive(),
  result: z.unknown().optional(),
  error: z.string().max(500).optional(),
  retryable: z.boolean().optional(),
});
export const complete = httpAction(async (ctx, request) => {
  const denied = await authenticateWorker(request);
  if (denied) return denied;
  // Bound streamed bodies too; Content-Length is not required by HTTP clients.
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: "Missing body" }, { status: 400 });
  let body = "";
  const decoder = new TextDecoder();
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 65_536) {
      await reader.cancel();
      return Response.json({ error: "Body too large" }, { status: 413 });
    }
    body += decoder.decode(value, { stream: true });
  }
  body += decoder.decode();
  let data;
  try {
    data = completion.parse(JSON.parse(body));
  } catch {
    return Response.json({ error: "Invalid completion" }, { status: 400 });
  }
  // Normalize IDs inside an internal query rather than trusting strings from the worker.
  let run;
  try {
    run = await ctx.runQuery(internal.simulations.queries.getByExternalId, {
      runId: data.runId,
    });
  } catch {
    return Response.json({ error: "Invalid run ID" }, { status: 400 });
  }
  if (!run) return Response.json({ error: "Run not found" }, { status: 404 });
  if (run.transport !== "pull")
    return Response.json({ error: "Wrong transport" }, { status: 409 });
  if (run.status !== "running" || run.attempts !== data.leaseId)
    return Response.json({ accepted: false });
  try {
    if (data.result !== undefined) {
      const edits = await ctx.runQuery(
        internal.simulations.queries.editsForRun,
        { runId: run._id },
      );
      const parsed = parseWorkerResult(data.result, run, edits);
      await ctx.runMutation(internal.simulations.mutations.finish, {
        runId: run._id,
        leaseId: data.leaseId,
        ...parsed,
      });
    } else
      await ctx.runMutation(internal.simulations.mutations.finish, {
        runId: run._id,
        leaseId: data.leaseId,
        error: data.error ?? "Simulation failed.",
        retryable: data.retryable ?? false,
      });
  } catch {
    await ctx.runMutation(internal.simulations.mutations.finish, {
      runId: run._id,
      leaseId: data.leaseId,
      error: "Worker returned an invalid result or missing recording.",
      retryable: false,
    });
  }
  return Response.json({ accepted: true });
});

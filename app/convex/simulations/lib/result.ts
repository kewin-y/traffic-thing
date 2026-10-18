import {
  workerResultSchema,
  type WorkerEdit,
} from "../../../shared/simulations";
import type { Doc } from "../../_generated/dataModel";

/**
 * The worker echoes the edits it applied back in the request's order and
 * shape. Compare canonically (fixed key order, sorted by edge) so neither
 * side's JSON key order can hide a difference.
 */
function appliedEditsMatch(
  applied: readonly WorkerEdit[],
  expected: readonly WorkerEdit[],
): boolean {
  const canon = (edits: readonly WorkerEdit[]) =>
    edits
      .map((edit) => ({
        type: edit.type,
        edge_id: edit.edge_id,
        lane_count:
          edit.type === "set_lane_count" ? edit.lane_count : undefined,
        speed_mps:
          edit.type === "set_speed_limit" ? edit.speed_mps : undefined,
      }))
      .sort((a, b) =>
        a.edge_id === b.edge_id
          ? a.type.localeCompare(b.type)
          : a.edge_id.localeCompare(b.edge_id),
      );
  return JSON.stringify(canon(applied)) === JSON.stringify(canon(expected));
}

export function parseWorkerResult(
  value: unknown,
  run: Doc<"simulationRuns">,
  expectedEdits: readonly WorkerEdit[] = [],
) {
  const parsed = workerResultSchema.safeParse(value);
  if (!parsed.success)
    throw new Error("The worker returned an invalid simulation result.");
  const data = parsed.data;
  if (
    data.request_id !== run._id ||
    data.network !== run.network.name ||
    data.network_version !== run.network.version ||
    data.seed !== run.settings.seed ||
    data.simulation_time_seconds !== run.settings.durationSeconds ||
    Boolean(data.timeline) !== run.settings.record
  )
    throw new Error(
      "The worker result does not match this run's settings or network version.",
    );
  if (!appliedEditsMatch(data.applied_edits, expectedEdits))
    throw new Error(
      "The worker applied different edits than this run requested.",
    );
  return {
    summary: {
      sumoVersion: data.sumo_version,
      simulationTimeSeconds: data.simulation_time_seconds,
      completed: data.completed,
      departed: data.departed,
      running: data.running,
      pending: data.pending,
      averageTripDurationSeconds: data.average_trip_duration_seconds,
      averageWaitingTimeSeconds: data.average_waiting_time_seconds,
      averageTimeLossSeconds: data.average_time_loss_seconds,
    },
    recordingStorageId: data.timeline?.storage_id,
  };
}

export function workerRequest(
  run: Doc<"simulationRuns">,
  edits: readonly WorkerEdit[] = [],
) {
  return {
    request_id: run._id,
    network: run.network.name,
    network_version: run.network.version,
    duration_seconds: run.settings.durationSeconds,
    seed: run.settings.seed,
    edits: edits.map((edit) =>
      edit.type === "set_lane_count"
        ? { type: edit.type, edge_id: edit.edge_id, lane_count: edit.lane_count }
        : edit.type === "set_speed_limit"
          ? { type: edit.type, edge_id: edit.edge_id, speed_mps: edit.speed_mps }
          : { type: edit.type, edge_id: edit.edge_id },
    ),
    record: run.settings.record,
    sample_interval_seconds: 5,
  };
}

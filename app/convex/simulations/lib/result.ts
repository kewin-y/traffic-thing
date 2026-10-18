import { workerResultSchema } from "../../../shared/simulations";
import type { Doc } from "../../_generated/dataModel";

export function parseWorkerResult(value: unknown, run: Doc<"simulationRuns">) {
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

export function workerRequest(run: Doc<"simulationRuns">) {
  return {
    request_id: run._id,
    network: run.network.name,
    network_version: run.network.version,
    duration_seconds: run.settings.durationSeconds,
    seed: run.settings.seed,
    edits: [],
    record: run.settings.record,
    sample_interval_seconds: 5,
  };
}

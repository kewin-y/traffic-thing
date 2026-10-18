import { z } from "zod";

export const simulationSettingsSchema = z.object({
  durationSeconds: z
    .number()
    .int()
    .min(1, "Use at least 1 second.")
    .max(3600, "Use at most 3600 seconds."),
  seed: z
    .number()
    .int()
    .min(0, "Seed must be nonnegative.")
    .max(2147483647, "Seed must be at most 2147483647."),
  record: z.boolean(),
});
export type SimulationSettings = z.infer<typeof simulationSettingsSchema>;
export const defaultSimulationSettings: SimulationSettings = {
  durationSeconds: 200,
  seed: 42,
  // Recordings drive playback in the history panel.
  record: true,
};
const metric = z.number().finite().nonnegative().nullable();
/** Road edits the app derives from the scene and the worker applies to SUMO. */
export const workerEditSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("set_speed_limit"), edge_id: z.string().min(1), speed_mps: z.number().gt(0) }),
  z.object({ type: z.literal("set_lane_count"), edge_id: z.string().min(1), lane_count: z.number().int().min(1) }),
  z.object({ type: z.literal("close_edge"), edge_id: z.string().min(1) }),
]);
export type WorkerEdit = z.infer<typeof workerEditSchema>;
/** `edge/…` osmId prefix used by scene components that override network edges. */
export const EDGE_OVERRIDE_PREFIX = "edge/";
export const workerResultSchema = z.object({
  request_id: z.string().min(1),
  network: z.string().min(1),
  network_version: z.string().regex(/^[a-f0-9]{16}$/),
  seed: z.number().int(),
  sumo_version: z.string().min(1).max(200),
  simulation_time_seconds: z.number().finite().positive(),
  completed: z.number().int().nonnegative(),
  departed: z.number().int().nonnegative(),
  running: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  average_trip_duration_seconds: metric,
  average_waiting_time_seconds: metric,
  average_time_loss_seconds: metric,
  applied_edits: z.array(workerEditSchema),
  timeline: z
    .object({
      storage_id: z.string().min(1),
      format: z.literal("application/gzip"),
      filename: z.literal("timeline.json.gz"),
      sample_interval_seconds: z.literal(5),
    })
    .optional(),
});

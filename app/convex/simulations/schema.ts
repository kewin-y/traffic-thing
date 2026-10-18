import { defineTable } from "convex/server";
import { v } from "convex/values";
import { projectState } from "../projects/schema";

export const settings = v.object({
  durationSeconds: v.number(),
  seed: v.number(),
  record: v.boolean(),
});
export const resultSummary = v.object({
  sumoVersion: v.string(),
  simulationTimeSeconds: v.number(),
  completed: v.number(),
  departed: v.number(),
  running: v.number(),
  pending: v.number(),
  averageTripDurationSeconds: v.union(v.null(), v.number()),
  averageWaitingTimeSeconds: v.union(v.null(), v.number()),
  averageTimeLossSeconds: v.union(v.null(), v.number()),
});
export const runFields = {
  projectId: v.id("projects"),
  ownerId: v.id("users"),
  requestId: v.string(),
  mode: v.literal("baseline"),
  projectRevision: v.number(),
  projectName: v.string(),
  network: v.object({ name: v.string(), version: v.string() }),
  settings,
  transport: v.union(v.literal("pull"), v.literal("push")),
  status: v.union(
    v.literal("queued"),
    v.literal("running"),
    v.literal("succeeded"),
    v.literal("failed"),
  ),
  attempts: v.number(),
  startedAt: v.optional(v.number()),
  finishedAt: v.optional(v.number()),
  leaseExpiresAt: v.optional(v.number()),
  error: v.optional(v.string()),
  result: v.optional(resultSummary),
  recordingStorageId: v.optional(v.id("_storage")),
};
export const runDocument = v.object({
  _id: v.id("simulationRuns"),
  _creationTime: v.number(),
  ...runFields,
});
export const simulationsTables = {
  simulationRuns: defineTable(runFields)
    .index("by_projectId", ["projectId"])
    .index("by_projectId_and_status", ["projectId", "status"])
    .index("by_ownerId_and_requestId", ["ownerId", "requestId"])
    .index("by_transport_and_status_and_leaseExpiresAt", [
      "transport",
      "status",
      "leaseExpiresAt",
    ]),
  simulationSnapshots: defineTable({
    runId: v.id("simulationRuns"),
    state: projectState,
  }).index("by_runId", ["runId"]),
};

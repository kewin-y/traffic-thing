import { defineTable } from "convex/server";
import { v } from "convex/values";
import { componentKinds } from "../../shared/projects";

const point = v.array(v.number());
export const projectState = v.object({
  schemaVersion: v.literal(1),
  origin: v.object({ lng: v.number(), lat: v.number() }),
  scene: v.array(
    v.object({
      id: v.string(),
      kind: v.union(...componentKinds.map((kind) => v.literal(kind))),
      x: v.number(),
      y: v.number(),
      rotation: v.number(),
      length: v.optional(v.number()),
      width: v.optional(v.number()),
      laneCount: v.optional(v.number()),
      height: v.optional(v.number()),
      speedKmh: v.optional(v.number()),
      hours: v.optional(v.string()),
      colour: v.optional(v.string()),
      footprint: v.optional(v.array(point)),
      path: v.optional(v.array(point)),
      osmId: v.optional(v.union(v.string(), v.number())),
      osmAt: v.optional(point),
    }),
  ),
  areas: v.array(v.object({ id: v.string(), rings: v.array(v.array(point)) })),
  measurements: v.array(
    v.object({ id: v.string(), a: v.string(), b: v.string() }),
  ),
  camera: v.object({
    lng: v.number(),
    lat: v.number(),
    zoom: v.number(),
    pitch: v.number(),
    bearing: v.number(),
  }),
});
export const projectFields = {
  ownerId: v.id("users"),
  name: v.string(),
  slug: v.string(),
  description: v.string(),
  updatedAt: v.number(),
  network: v.union(
    v.null(),
    v.object({ name: v.string(), version: v.string() }),
  ),
};
export const projectsTables = {
  projects: defineTable(projectFields)
    .index("by_ownerId_and_updatedAt", ["ownerId", "updatedAt"])
    .index("by_slug", ["slug"]),
  projectStates: defineTable({
    projectId: v.id("projects"),
    revision: v.number(),
    state: projectState,
  }).index("by_projectId", ["projectId"]),
};
export const projectDocument = v.object({
  _id: v.id("projects"),
  _creationTime: v.number(),
  ...projectFields,
});

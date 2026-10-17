import { defineTable } from "convex/server";
import { v } from "convex/values";

export const networkFields = {
  name: v.string(),
  version: v.string(),
  attribution: v.string(),
  edgeCount: v.number(),
  geojsonSha256: v.string(),
  geojsonStorageId: v.id("_storage"),
  manifestStorageId: v.id("_storage"),
};

export const networksTables = {
  networks: defineTable(networkFields)
    .index("by_name_and_version", ["name", "version"])
    // Name-only index orders versions by publication time, not their hash.
    .index("by_name", ["name"]),
};

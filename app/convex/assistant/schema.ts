import { defineTable } from "convex/server";
import { v } from "convex/values";

export const assistantTables = {
  assistantThreads: defineTable({
    projectId: v.id("projects"),
    threadId: v.string(),
    activeRequest: v.optional(v.string()),
    busyUntil: v.optional(v.number()),
  }).index("by_projectId", ["projectId"]),
};

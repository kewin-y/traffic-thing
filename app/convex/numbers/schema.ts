// Tables owned by the numbers feature, merged into the root schema.
// Convex requires a single schema file, so features export table fragments.
import { defineTable } from "convex/server";
import { v } from "convex/values";

export const numbersTables = {
  numbers: defineTable({
    value: v.number(),
  }),
};

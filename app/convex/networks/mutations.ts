import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { networkFields } from "./schema";

// Only the authenticated, validated HTTP publisher may register a version.
export const register = internalMutation({
  args: networkFields,
  returns: v.object({ id: v.id("networks"), created: v.boolean() }),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("networks")
      .withIndex("by_name_and_version", (q) =>
        q.eq("name", args.name).eq("version", args.version),
      )
      .unique();
    if (existing) {
      if (existing.geojsonSha256 !== args.geojsonSha256) {
        throw new Error("Network versions are immutable");
      }
      // Concurrent/retried publishes keep the first files and remove duplicates.
      for (const id of [args.geojsonStorageId, args.manifestStorageId]) {
        if (
          id !== existing.geojsonStorageId &&
          id !== existing.manifestStorageId
        ) {
          await ctx.storage.delete(id);
        }
      }
      return { id: existing._id, created: false };
    }
    const id = await ctx.db.insert("networks", args);
    return { id, created: true };
  },
});

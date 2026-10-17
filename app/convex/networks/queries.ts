import { v } from "convex/values";
import { query } from "../_generated/server";

// These are shared operator-published road networks, available to signed-in users.
export const get = query({
  args: { name: v.string(), version: v.optional(v.string()) },
  returns: v.union(
    v.null(),
    v.object({
      id: v.id("networks"),
      name: v.string(),
      version: v.string(),
      attribution: v.string(),
      edgeCount: v.number(),
      geojsonUrl: v.string(),
      manifestUrl: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    if (!(await ctx.auth.getUserIdentity()))
      throw new Error("Not authenticated");
    const version = args.version;
    const row =
      version !== undefined
        ? await ctx.db
            .query("networks")
            .withIndex("by_name_and_version", (q) =>
              q.eq("name", args.name).eq("version", version),
            )
            .unique()
        : await ctx.db
            .query("networks")
            .withIndex("by_name", (q) => q.eq("name", args.name))
            .order("desc")
            .first();
    if (!row) return null;
    const [geojsonUrl, manifestUrl] = await Promise.all([
      ctx.storage.getUrl(row.geojsonStorageId),
      ctx.storage.getUrl(row.manifestStorageId),
    ]);
    if (!geojsonUrl || !manifestUrl)
      throw new Error("Network assets are missing");
    return {
      id: row._id,
      name: row.name,
      version: row.version,
      attribution: row.attribution,
      edgeCount: row.edgeCount,
      geojsonUrl,
      manifestUrl,
    };
  },
});

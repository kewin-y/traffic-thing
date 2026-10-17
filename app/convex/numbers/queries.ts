// A query reads data from the database. See https://docs.convex.dev/functions/queries.
import { v } from "convex/values";
import { query } from "../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

export const listNumbers = query({
  args: {
    count: v.number(),
  },
  handler: async (ctx, args) => {
    const numbers = await ctx.db
      .query("numbers")
      // Ordered by _creationTime, return most recent
      .order("desc")
      .take(args.count);
    const userId = await getAuthUserId(ctx);
    const user = userId === null ? null : await ctx.db.get("users", userId);
    return {
      viewer: user?.email ?? null,
      numbers: numbers.reverse().map((number) => number.value),
    };
  },
});

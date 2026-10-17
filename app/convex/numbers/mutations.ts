// A mutation writes data to the database. See https://docs.convex.dev/functions/mutations.
import { v } from "convex/values";
import { mutation } from "../_generated/server";

export const addNumber = mutation({
  args: {
    value: v.number(),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("numbers", { value: args.value });
    console.log("Added new document with id:", id);
  },
});

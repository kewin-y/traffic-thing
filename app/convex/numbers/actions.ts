// Actions can call third-party APIs and cross-runtime functions.
// See https://docs.convex.dev/functions/actions.
import { v } from "convex/values";
import { action } from "../_generated/server";
import { api } from "../_generated/api";

export const runSample = action({
  args: {
    first: v.number(),
    second: v.string(),
  },
  handler: async (ctx, args) => {
    // const response = await fetch("https://api.thirdpartyservice.com");

    const data = await ctx.runQuery(api.numbers.queries.listNumbers, {
      count: 10,
    });
    console.log(data);

    await ctx.runMutation(api.numbers.mutations.addNumber, {
      value: args.first,
    });
  },
});

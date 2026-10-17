import { defineSchema } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { numbersTables } from "./numbers/schema";

// Convex requires a single schema file: feature-owned tables live in
// `convex/<feature>/schema.ts` fragments and are merged here.
// Convex Auth requires indexes defined on `authTables` kept as-is.
export default defineSchema({
  ...authTables,
  ...numbersTables,
});

import { defineApp } from "convex/server";
import { v } from "convex/values";
import workpool from "@convex-dev/workpool/convex.config.js";

const app = defineApp({
  env: {
    WORKER_URL: v.optional(v.string()),
    WORKER_API_KEY: v.optional(v.string()),
  },
});
app.use(workpool, { name: "simulationPool" });
export default app;

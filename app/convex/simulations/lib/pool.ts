import { Workpool } from "@convex-dev/workpool";
import { components } from "../../_generated/api";
export const simulationPool = new Workpool(components.simulationPool, {
  maxParallelism: 1,
  retryActionsByDefault: true,
  defaultRetryBehavior: { maxAttempts: 5, initialBackoffMs: 2000, base: 2 },
});

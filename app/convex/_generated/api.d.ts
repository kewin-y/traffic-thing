/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as assistant_actions from "../assistant/actions.js";
import type * as assistant_agent from "../assistant/agent.js";
import type * as assistant_mutations from "../assistant/mutations.js";
import type * as assistant_queries from "../assistant/queries.js";
import type * as auth from "../auth.js";
import type * as http from "../http.js";
import type * as networks_httpActions from "../networks/httpActions.js";
import type * as networks_lib_assets from "../networks/lib/assets.js";
import type * as networks_mutations from "../networks/mutations.js";
import type * as networks_queries from "../networks/queries.js";
import type * as projects_lib_access from "../projects/lib/access.js";
import type * as projects_mutations from "../projects/mutations.js";
import type * as projects_queries from "../projects/queries.js";
import type * as simulations_actions from "../simulations/actions.js";
import type * as simulations_httpActions from "../simulations/httpActions.js";
import type * as simulations_lib_config from "../simulations/lib/config.js";
import type * as simulations_lib_edits from "../simulations/lib/edits.js";
import type * as simulations_lib_pool from "../simulations/lib/pool.js";
import type * as simulations_lib_result from "../simulations/lib/result.js";
import type * as simulations_mutations from "../simulations/mutations.js";
import type * as simulations_queries from "../simulations/queries.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "assistant/actions": typeof assistant_actions;
  "assistant/agent": typeof assistant_agent;
  "assistant/mutations": typeof assistant_mutations;
  "assistant/queries": typeof assistant_queries;
  auth: typeof auth;
  http: typeof http;
  "networks/httpActions": typeof networks_httpActions;
  "networks/lib/assets": typeof networks_lib_assets;
  "networks/mutations": typeof networks_mutations;
  "networks/queries": typeof networks_queries;
  "projects/lib/access": typeof projects_lib_access;
  "projects/mutations": typeof projects_mutations;
  "projects/queries": typeof projects_queries;
  "simulations/actions": typeof simulations_actions;
  "simulations/httpActions": typeof simulations_httpActions;
  "simulations/lib/config": typeof simulations_lib_config;
  "simulations/lib/edits": typeof simulations_lib_edits;
  "simulations/lib/pool": typeof simulations_lib_pool;
  "simulations/lib/result": typeof simulations_lib_result;
  "simulations/mutations": typeof simulations_mutations;
  "simulations/queries": typeof simulations_queries;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  simulationPool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"simulationPool">;
  agent: import("@convex-dev/agent/_generated/component.js").ComponentApi<"agent">;
};

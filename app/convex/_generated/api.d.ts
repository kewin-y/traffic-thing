/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as http from "../http.js";
import type * as networks_httpActions from "../networks/httpActions.js";
import type * as networks_lib_assets from "../networks/lib/assets.js";
import type * as networks_mutations from "../networks/mutations.js";
import type * as networks_queries from "../networks/queries.js";
import type * as numbers_actions from "../numbers/actions.js";
import type * as numbers_mutations from "../numbers/mutations.js";
import type * as numbers_queries from "../numbers/queries.js";
import type * as projects_lib_access from "../projects/lib/access.js";
import type * as projects_mutations from "../projects/mutations.js";
import type * as projects_queries from "../projects/queries.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  http: typeof http;
  "networks/httpActions": typeof networks_httpActions;
  "networks/lib/assets": typeof networks_lib_assets;
  "networks/mutations": typeof networks_mutations;
  "networks/queries": typeof networks_queries;
  "numbers/actions": typeof numbers_actions;
  "numbers/mutations": typeof numbers_mutations;
  "numbers/queries": typeof numbers_queries;
  "projects/lib/access": typeof projects_lib_access;
  "projects/mutations": typeof projects_mutations;
  "projects/queries": typeof projects_queries;
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

export declare const components: {};

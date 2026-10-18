# Convex backend

- `auth.ts`, `auth.config.ts`: authentication.
- `assistant/`: project conversations and planning tools.
- `networks/`: versioned road assets and publishing.
- `projects/`: owned projects and saved map state.
- `simulations/`: queued runs, worker dispatch, and results.
- `schema.ts`: combined feature tables; `http.ts`: HTTP routes.

Run `pnpm dev` from `app/` to sync functions and generate API types;
`pnpm test` runs backend and frontend tests.
See [worker setup](../../worker/README.md#app-simulations) for shared secrets and dispatch.

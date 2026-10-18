# Traffic app

Next.js frontend and Convex backend with email/password authentication,
persistent map projects, and a recent-project dashboard.

See the [repository overview](../README.md) for the development environment and
the [worker README](../worker/README.md) for SUMO simulation setup and its HTTP API.

## Tech stack

- Next.js 16, React 19, TypeScript
- Convex + Convex Auth (email/password)
- Tailwind CSS 4, shadcn/ui (Base UI), Hugeicons
- TanStack Form + Zod
- `@wrksz/themes` (light/dark/system themes)
- MapLibre GL JS (3D intersection editor in `src/features/intersection-editor/`)

## Project structure

- `src/app/` — Next.js App Router routes, layouts, and global styles
- `src/features/` — feature-specific components, hooks, and utilities
- `src/components/`, `src/hooks/`, `src/lib/`, `src/contexts/` — shared frontend code
- `src/proxy.ts` — authentication and route protection
- `convex/` — backend functions, schema, and generated API
- `shared/` — project validation and state types shared by frontend and backend
- `public/` — static assets

The `@/*` import alias points to `src/*`; `@/convex/*` points to this directory's `convex/` folder. App configuration and environment files live here in `app/`.

## Usage

Requires Node.js and pnpm. From the repository root:

```bash
cd app
pnpm install
pnpm dev
```

The `predev` script runs `convex init` and `setup.mjs --once` to configure
Convex and authentication. The `dev` script starts Convex and Next.js together.
Follow the setup prompts, then open [localhost:3000](http://localhost:3000).

For recording uploads, set `WORKER_API_KEY` on the Convex deployment from this
directory, using the same key as the worker. See [recording setup](../worker/README.md#recordings-in-convex).

Other commands:

- `pnpm lint` checks code
- `pnpm build` builds the Next.js app
- `pnpm test` runs the Convex backend tests

Imported road GeoJSON and network manifests can be published to Convex storage
using the [network publisher](../worker/README.md#publish-map-assets-to-convex).
The authenticated `api.networks.queries.get` query resolves their download URLs
by network name and optional version.

## Map projects

`/` opens `/dashboard` (sign-in required). Create a project using the New project
form, then edit it at `/project/[slug]`. The former `/dashboard/editor` route
redirects to the dashboard. Existing browser-local maps can be imported from
the dashboard; the original local save is retained.

Convex stores owner-scoped metadata in `projects` and the current versioned map
state in `projectStates`. Project state includes scene components, editable
areas, measurements, the fixed geometry origin, and the camera. Each project
pins the exact published road-network version available at creation; a project
created before a network is published keeps a null network reference.

Edits autosave after 800 ms of inactivity and flush on client navigation. A
browser recovery draft is scoped to the account, project, and browser tab.
The editor displays save failures and offers retry and a JSON recovery download.
Revision checks reject stale-tab overwrites; download local changes before
choosing Load latest to discard them. Project state is validated with Zod and
Convex validators, with a 750,000-byte save limit below Convex's document limit.
Large geometry will need separate records or file storage in a future version.

## Baseline simulations

Use **Simulate** in a saved project to choose duration (1–3600 seconds), a seed,
and an optional recording. Runs retain an immutable copy of the full map state,
its revision, settings, and pinned network version. Live history shows queue
status, failures, metrics, and snapshot/recording downloads. The baseline uses
published roads and synthetic demand with `edits: []`; buildings, heights, signs,
and other editor changes are preserved for later support.

For local development, from `app/`:

```bash
npx convex env set WORKER_URL http://localhost:8000
```

Set `WORKER_API_KEY` on Convex to the same secret as `worker/.env`, and set
`CONVEX_SITE_URL` there to your deployment's `.convex.site` URL. From the root:

```bash
docker compose --env-file worker/.env up -d --build worker
```

Cloud Convex cannot connect to your machine's localhost. With a localhost
`WORKER_URL`, the local Docker worker instead polls authenticated Convex HTTP
endpoints, claims one run at a time, calls its own `/simulate`, and delivers the
result. No public URL or tunnel is needed. Keep the worker running to process
queued runs. `SIMULATION_POLLING=true` is enabled by Compose; disable it when
using the service only through its HTTP API or with a remote worker URL.

A remote HTTPS `WORKER_URL` uses the Convex Workpool component to dispatch
requests with parallelism 1 and bounded retries. Both transports verify returned
run IDs, settings, and network versions. The worker verifies the actual SUMO
network and demand checksums, caps execution time, and stores receipts in the
`worker-runs` Docker volume so duplicate deliveries reuse completed results.
Claims expire after ten minutes and are recovered when a worker next polls;
execution/delivery failures have a maximum of five attempts. Do not remove the
receipt volume while runs are active.

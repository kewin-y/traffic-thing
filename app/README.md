# Traffic app

Next.js, React, MapLibre, and Convex with email/password sign-in and saved map projects.
See the [worker README](../worker/README.md) for simulation setup.

## Setup

```bash
cd app
pnpm install
pnpm dev
```

Follow the Convex/auth setup prompts. Add `MAPTILER_API_KEY=...` to
`app/.env.local` and restart development for the basemap. Tiles are proxied
through `/api/maptiler/` to keep the key on the server.

Open [localhost:3000](http://localhost:3000). Create projects from the dashboard;
map edits autosave. Simulate runs the project's pinned network with GCN car
demand when the worker has a matching model, plus synthetic pedestrians, cyclists,
and scooters. Baseline and edited runs use the same demand pipeline and warm-up.
Deleting an imported road closes that direction; changing its width changes the
lane count. Other scene objects are visual only.

Recording is enabled by default. Select a run in history to play, pause, scrub,
change speed, and view congestion on the map. Playback identifies the car-demand
source and warm-up duration, and separates decorative resting people from
simulated pedestrians. Furniture positions come from the run's snapshot; the
underlying map shows the current editor layout. Older v1 recordings remain
downloadable but require a new run for playback. Trip averages include each
completed car's full history, potentially including warm-up time.

## Planning assistant

The editor's Chat tab can read the scene, open editable areas, and place or delete
components. Conversations are saved per project; each turn's edits form one undo step.
It does not run simulations.

Set the provider key on Convex from `app/` (requires Node.js 22+):

```bash
pnpm exec convex env set GOOGLE_GENERATIVE_AI_API_KEY '<key>'
# Optional model override (default: gemini-3.8-flash):
pnpm exec convex env set CHAT_MODEL '<Gemini model ID>'
```

Get a key from [Google AI Studio](https://aistudio.google.com/apikey), then run
`pnpm exec convex dev --once` to deploy the assistant component and functions.

## Commands

```bash
pnpm lint
pnpm exec tsc --noEmit
pnpm test
pnpm build
```

## Layout

- `src/app/`: routes and layouts; `src/proxy.ts`: route protection.
- `src/features/`: feature components, hooks, and utilities.
- `src/components/`, `src/hooks/`, `src/lib/`, `src/contexts/`: shared frontend code.
- `convex/`: backend; `shared/`: frontend/backend validation and types.

`@/*` resolves to `src/*`; `@/convex/*` resolves to `convex/*`.

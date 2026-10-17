# Traffic Thing

A traffic planning app for editing road scenarios and comparing SUMO simulations.

## Repository layout

- [`app/`](app/README.md) — Next.js frontend, Convex backend, and authentication.
- [`worker/`](worker/README.md) — uv-managed Python/SUMO HTTP service.
- [`scripts/`](scripts/) — Bash and PowerShell scripts to create demo network assets.
- [`compose.yaml`](compose.yaml) — local container configuration for the worker.
- `networks/` — local SUMO network and demand files; ignored by Git and mounted
  read-only into the worker.
- [`flake.nix`](flake.nix) and [`.envrc`](.envrc) — optional Nix/direnv development environment.

## Development environment

With Nix and direnv installed, run from the repository root:

```bash
direnv allow
```

Alternatively, enter the shell directly with `nix develop`. The devshell provides
Node.js, pnpm, uv, Python tooling, SUMO, and native libraries needed by the Python
SUMO wheels. Python itself is provisioned by uv rather than Nix.

Nix is not required for the containerized worker; its Docker image includes the
runtime and native dependencies.

## Prerequisites

Without Nix, install these before running anything:

- **Node.js 20+** and **pnpm** (`npm install -g pnpm`): the frontend.
- **uv** ([install guide](https://docs.astral.sh/uv/getting-started/installation/)): it
  provisions Python 3.12 and the worker's packages, including SUMO itself
  (`eclipse-sumo`, `sumolib`, `traci`, `libsumo` 1.28), so no separate SUMO install is needed.
- **A browser with WebGL** for the 3D editor (any current Chrome, Edge, Firefox or Safari).
- **A Convex account**: `pnpm dev` prompts you to create or link a project on first run.
- **A MapTiler API key** ([free tier](https://cloud.maptiler.com/account/keys/)) for the
  Toronto basemap.
- Optional: **Docker** for the containerized worker.

Then install project packages:

```bash
cd app && pnpm install     # includes maplibre-gl for the 3D editor
cd ../worker && uv sync --locked
```

## Getting started

1. Follow the [app setup](app/README.md#usage) to run Next.js and Convex.
2. Follow the [worker setup](worker/README.md#docker) to configure the API key,
   create demo assets with the supplied script, and start the worker with Docker.
3. The 3D editor opens at [localhost:3000](http://localhost:3000) on a downtown Toronto
   basemap from MapTiler. Add your MapTiler key to `app/.env.local` as
   `MAPTILER_API_KEY=...` and restart `pnpm dev`. The key stays on the server: the
   browser fetches tiles through `/api/maptiler/`. Exported scenarios can be
   [simulated in SUMO](worker/README.md#editor-scenarios). The export panel is hidden
   for now.

## Editor features

- **Add**: drag tools from the left panel onto the map. Lanes and crosswalks snap to the
  Spadina & College sample intersection; elsewhere they're placed where you drop them.
- **Edit the real map**: click an OpenStreetMap building or street to turn it into an
  editable component. Deleting it removes it from the basemap too. OSM street trees
  aren't in the vector tiles, so trees are added with the Tree tool.
- **Select, move and resize**: click to select, drag to move, and drag the white handles
  to change length or width. Right-click for exact dimensions, rotation and delete.
  Ctrl+Z undoes.
- **Measure**: measures the edge-to-edge distance between two components. The line
  follows them as they move.
- **Rule**: sidewalks can't be placed, moved or resized over roads or lanes.
- **Check**: puts a red **!** on components that break a guideline. Click it for a
  one-line explanation that links to the source. Rules and sources live in
  `app/src/features/intersection-editor/lib/rules.ts`:
  - [Toronto Lane Widths Guideline (2018)](https://www.toronto.ca/wp-content/uploads/2018/05/986b-Lane-Widths-Guideline-Version-2.0.1-May-2018.pdf): lanes 3.0–4.3 m, at least 3.1 m on streetcar routes
  - [Toronto standard T-310.010-10](https://www.toronto.ca/wp-content/uploads/2018/10/983b-ecs-specs-roadwd-T-310.010-10_Rev1_Sep2018.pdf): 2.1 m minimum pedestrian clearway
  - [HTA Reg. 623, Stop Signs at Intersections](https://www.ontario.ca/laws/regulation/900623): no stop signs at signalized intersections
  - [Toronto Spacing of Traffic Signals policy](https://www.toronto.ca/wp-content/uploads/2024/09/9769-TSClosely-Spaced-Signals-PolicyFinal.pdf): 215 m signal spacing (OTM Book 12)
  - [Toronto Vision Zero speed limit reductions](https://www.toronto.ca/services-payments/streets-parking-transportation/road-safety/vision-zero/safety-initiatives/initiatives/speed-limit-reductions/): 50 km/h maximum on arterials
  - [Toronto minimum separation distances (2026)](https://www.toronto.ca/wp-content/uploads/2026/07/8efa-Minimum-Separation-Distance.pdf): clearances around trees, poles and crossings
  - [Toronto Municipal Code Ch. 743 (Oct 2025)](https://www.toronto.ca/legdocs/municode/1184_743.pdf): no objects on streets without a permit
  - [Zoning By-law 569-2013](https://www.toronto.ca/city-government/planning-development/zoning-by-law-preliminary-zoning-reviews/zoning-by-law-569-2013-2/): buildings stay on their lot

  These are planning aids, not a compliance review: zone-specific limits such as height
  and setbacks aren't modelled.

Component-specific configuration, commands, and API details live in the respective
README rather than being duplicated here.

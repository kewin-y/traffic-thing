# SUMO worker

Python/SUMO HTTP service. Run the service and its tests in Docker.

## Setup

From the repository root:

```bash
cp worker/.env.example .env
openssl rand -hex 32
```

Put the generated secret in `.env` as `WORKER_API_KEY`. For standalone HTTP use,
set `CONVEX_SITE_URL=` and `SIMULATION_POLLING=false`. Then:

```bash
bash scripts/create-demo-network.sh
docker compose up -d worker
```

Open [API docs](http://localhost:8000/docs), authorize with the key, and try
`POST /simulate` with:

```json
{"network":"demo","duration_seconds":200,"seed":42,"edits":[]}
```

Health: `GET /health`. Logs: `docker compose logs -f worker`.
After code changes: `docker compose up -d --build worker`. Stop: `docker compose down`.

## Toronto network

```bash
bash scripts/import-toronto.sh
bash scripts/publish-network.sh toronto-downtown
```

Publishing requires the [Convex configuration below](#app-simulations).
The import writes SUMO roads, synthetic demand, GeoJSON, a manifest, and an OSM
snapshot to `networks/toronto-downtown/`. Use `--force` to regenerate from cache;
add `--refresh` to fetch new OSM data. Demo generation also accepts `--force`.

PowerShell equivalents:

```powershell
.\scripts\create-demo-network.ps1
.\scripts\import-toronto.ps1
.\scripts\publish-network.ps1 -Network toronto-downtown
```

Use `-Force` / `-Refresh` for regeneration. Demand is synthetic and imported road
attributes need review before planning use. Retain OSM attribution when displaying roads.
Publish before creating app projects so they pin the imported network version.

## App simulations

Set these in the root `.env`:

```dotenv
WORKER_API_KEY=<shared-secret>
CONVEX_SITE_URL=https://<deployment>.convex.site
SIMULATION_POLLING=true
```

Configure the same Convex deployment from `app/`:

```bash
pnpm exec convex env set WORKER_API_KEY '<shared-secret>'
pnpm exec convex env set WORKER_URL http://localhost:8000
```

Start `pnpm dev` to sync the backend, publish the network, then run
`docker compose up -d --build worker` from the repository root.
The local worker polls Convex for queued runs; no tunnel is needed.
A remote HTTPS `WORKER_URL` uses direct dispatch instead; disable polling there.

Assets must exist on the worker and in Convex with matching versions and checksums.
Keep the `worker-runs` volume: it stores receipts to prevent duplicate execution.
Recordings upload to Convex; playback is not implemented. App simulations support
imported-road closures and lane-count changes; other scene objects have no effect.

## HTTP API

`POST /simulate` requires `Authorization: Bearer <WORKER_API_KEY>`.
See [/docs](http://localhost:8000/docs) for the full schema.

- `network` selects `NETWORK_ROOT/<name>/network.net.xml` and `demand.rou.xml`.
- Edits: `set_speed_limit` (m/s), `set_lane_count`, `close_edge`; use SUMO edge IDs.
- `record: true` uploads a timeline to Convex; `sample_interval_seconds` defaults to 5.
- Metrics include completed/running/pending vehicles and average trip, wait, and delay times.
- Default limits: 120 seconds wall time, one concurrent run per server process.

Networks are mounted read-only. Use matching network, demand, duration, and seed
for comparisons. Fixed routes invalidated by edits fail rather than reroute.

## Standalone junction scenarios

With uv and SUMO dependencies installed, from `worker/`:

```bash
uv run python -m traffic_worker.scenario path/to/scenario.json
```

Add `--gui` to watch, or `--json --keep out/` to save output. This CLI models
four-arm junction lanes, speeds, controls, and demand; pedestrians and scenery
have no simulation effect.

## Tests

From the repository root:

```bash
docker build --target test -t traffic-thing-worker:test worker
docker run --rm -v "$PWD:/workspace:ro" -e PYTHONPATH=/workspace/worker/src \
  -e SIMULATION_POLLING=false -w /workspace/worker \
  traffic-thing-worker:test python -m pytest -q -p no:cacheprovider
```

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
Recordings upload to Convex and play on the map when selected in run history.
App simulations support imported-road closures and lane-count changes; other
scene objects are visual only. The built image includes the committed GCN model.

## HTTP API

`POST /simulate` requires `Authorization: Bearer <WORKER_API_KEY>`.
See [/docs](http://localhost:8000/docs) for the full schema.

- `network` selects `NETWORK_ROOT/<name>/network.net.xml` and `demand.rou.xml`.
- Edits: `set_speed_limit` (m/s), `set_lane_count`, `close_edge`; use SUMO edge IDs.
- `record: true` uploads a timeline to Convex; `sample_interval_seconds` defaults to 5.
- Metrics count cars only; generated cyclists, scooter riders and pedestrians are excluded.
- Arrival/departure counts cover the measured window; running/pending are end snapshots.
- Averages cover the full history of cars arriving in the window, including warm-up time.
- Default limits: 400 seconds wall time, one concurrent run per server process.

Networks are mounted read-only. Use matching network, demand, duration, and seed
for comparisons. Fixed routes invalidated by edits fail rather than reroute.

## GCN demand and warm-up

The Docker image includes `traffic_gcn_checkpoint.pt`, `traffic_gcn_meta.json`,
and `street_segments.csv` in `/data/model`. `MODEL_ROOT` can point to an operator
supplied model directory; a missing directory disables predictions. `MODEL_NETWORK`
defaults to `toronto-downtown`. Other networks use their mounted demand.

For the model network, **both baseline and edited runs** sample car routes from
GCN per-edge volume targets. The model assumes 8% of predicted daily volume in
the simulated hour. Edits update model features; closed edges, including edges
absent from the model table, are forbidden to the route sampler. The candidate
route pool limits which alternative routes can be sampled. A prediction failure
logs an error and falls back to mounted demand; the result and recording report
`demand_source` (`model` or `mounted`). Compare runs using the same source.

A run first simulates up to 600 seconds of warm-up, capped so warm-up plus the
requested duration never exceeds 3,600 seconds. **Prediction targets, sampled car
departures and active travel all cover this full horizon.** A 200-second run
therefore simulates 800 seconds and measures the last 200. `warmup_seconds`
reports the unmeasured interval. Arrivals during warm-up are excluded, but the
full trip history of cars arriving in the measured window contributes to averages.
Do not compare these metrics directly with recordings from older workers.

## Active travel and playback

Before road edits, the worker derives a cached network with guessed sidewalks
and crossings. With `source.osm.xml` present, selected streets without a
`maxspeed` tag receive the configured 40 km/h fallback; tagged streets keep their
imported speed. Expressways, ramps, and living streets retain their imported
speeds. Lane edits count vehicle lanes in addition to dedicated sidewalks.
Drivers use zero default speed deviation; explicitly configured types retain
their own setting.

Walking, cycling and scooter trips follow the selected car demand: 2, 1/3 and
0.1 trips per car, with seeded departures and endpoints weighted by car-route
usage. These are synthetic assumptions, not GCN predictions of active travel.
Unroutable generated trips are dropped; mounted car routes remain strictly checked.

New recordings use `traffic-worker-timeline-v2`: WGS84 positions, headings and
speeds, plus sparse edge congestion samples. Up to 600 position frames include
initial and final states. Congestion updates on recorded frames when the sample
interval is due (rounded to the next position frame). The browser interpolates
positions, supports seeking and 0.5–16× playback, and colors roads by speed
relative to free flow. V1 recordings remain downloadable but must be rerun for
playback.

Resting people around benches, trees, parks and transit stops are decorative,
shown separately from simulated counts. Placed furniture uses the selected run's
saved snapshot; the underlying editor map still shows the current layout.

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

# SUMO worker

Run this simulation HTTP service **only through Docker**, including development.
The image provides Python 3.12, SUMO, `sumolib`, `traci`, and `libsumo` 1.28.0.
Each request runs in an isolated subprocess. Mounted source networks are never modified.

## Editor scenarios

The app's intersection editor exports a `scenario.json` that describes a four-arm
junction: the lanes on each arm, the speed limits, the junction control, and the demand.
`traffic_worker.scenario` builds a SUMO network from it and runs it locally. No
`NETWORK_ROOT`, API key or server is needed:

```bash
uv run python -m traffic_worker.scenario path/to/scenario.json
uv run python -m traffic_worker.scenario path/to/scenario.json --gui   # watch in sumo-gui
uv run python -m traffic_worker.scenario path/to/scenario.json --json --keep out/
```

How the scene maps to SUMO:

- Each lane becomes a SUMO lane, kerb side first: bike lanes allow `bicycle`, car
  lanes allow `passenger` (and `bicycle` when that edge has no bike lane), and
  streetcar tracks allow `tram`.
- The speed sign standing on an arm sets that arm's limit (default 40 km/h).
- Any traffic signal makes the junction signalized. Otherwise any stop sign makes it
  all-way stop, and with neither it is uncontrolled priority.
- Demand per arm splits 60% straight, 25% right and 15% left. Streetcars only run
  straight through. Flows with no lanes for their mode are skipped and listed.

The report gives completed trips, throughput, trips still en route, demand
**queued at entry** (the insertion backlog, which is the clearest congestion signal),
and average trip, waiting and delay times per mode, plus speed and waiting time per
approach. Teleporting is off, but `--ignore-junction-blocker 10` lets a vehicle move
past a deadlocked foe inside the junction, such as opposing left-turning cyclists.
Without it, permissive left turns gridlock. Buildings, trees, benches and sidewalks
are carried in the scenario, but they do not affect the simulation yet, and pedestrians
are not modelled.

## Docker

Run commands from the repository root with Docker running. Copy
`worker/.env.example` to `.env` and replace `WORKER_API_KEY` with a long random
secret. Compose and the demo scripts load this root `.env` automatically.

On Bash:

```bash
cp worker/.env.example .env
openssl rand -hex 32
```

On PowerShell:

```powershell
Copy-Item worker/.env.example .env
[guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N")
```

Copy the generated key into `.env` and keep the file out of version control.
Leave `CONVEX_SITE_URL` empty unless you are configuring [recording uploads](#recordings-in-convex).

Create a demo network and demand using the script for your shell (it builds the
worker image and runs SUMO inside Docker):

```bash
bash scripts/create-demo-network.sh
```

```powershell
.\scripts\create-demo-network.ps1
```

Both refuse to overwrite `networks/demo`; use `--force` (Bash) or `-Force`
(PowerShell) to regenerate it. Alternatively, supply your own
`networks/<name>/network.net.xml` and `demand.rou.xml`. Then start the worker:

```bash
docker compose up -d worker
```

The demo script already builds the image. If you supply your own assets instead,
or change worker code, start with `docker compose up -d --build worker`.

Network assets are mounted read-only and must be readable by container UID 10001.
The image runs as that non-root user and honors `PORT` (default 8000), including
its healthcheck.
For Railway, build with `worker/` as the build context and provide a populated
volume at `/data/networks`; the image intentionally contains no Toronto data.

On Windows, use Docker Desktop with the WSL 2 backend and Linux containers.
Check <http://localhost:8000/health>. To run a simulation, open
<http://localhost:8000/docs>, authorize with your API key, and try `POST /simulate`:

```json
{"network":"demo","duration_seconds":200,"seed":42,"edits":[]}
```

View logs: `docker compose logs -f worker`. Stop: `docker compose down`.

## Toronto downtown import

Import real OpenStreetMap roads around the CN Tower, Rogers Centre, Union Station,
the Entertainment District, and the waterfront. From the repository root:

```bash
bash scripts/import-toronto.sh
```

```powershell
.\scripts\import-toronto.ps1
```

The scripts build a separate Docker importer image; no host Python or API key is
required. The test rectangle is `[-79.405, 43.635, -79.370, 43.660]` in
`[west, south, east, north]` order. The simulation includes a 750 m buffer and
keeps complete edges crossing that boundary.

Files are written to `networks/toronto-downtown/`:

| File | Purpose |
| --- | --- |
| `network.net.xml` | Passenger-car SUMO network, using the largest connected component |
| `demand.rou.xml` | Synthetic routes for one hour, seed 42, targeting one vehicle every two seconds |
| `edges.geojson` | WGS84 road geometry with SUMO edge IDs for map selection and edit requests |
| `manifest.json` | Bounds, projection, network version, checksums, attribution, and demand settings |
| `source.osm.xml` | The OSM snapshot used to build this network |

Traffic demand is synthetic, not measured Toronto traffic. Imported road
attributes and signal programs need review before using results for planning.
The importer validates route loading with SUMO before publishing the files.

The downloaded snapshot is cached under `networks/.cache/`. Use `--force` to
regenerate from it, or `--force --refresh` to download current OSM data. In
PowerShell, use `-Force` and `-Refresh`. A failed generation preserves the previous
import. Generated files are ignored by Git.

Build and start the worker with `docker compose up -d --build worker`, then send
this body to its authenticated `POST /simulate` endpoint:

```json
{"network":"toronto-downtown","duration_seconds":200,"seed":42,"edits":[]}
```

Use `properties.edge_id` from `edges.geojson` when adding edits. Both the map
geometry and simulation network come from the same import. OSM attribution is
recorded in the GeoJSON and manifest; display it when rendering the roads.

## HTTP contract

`GET /health` is unauthenticated. `POST /simulate` requires
`Authorization: Bearer <WORKER_API_KEY>`. Interactive schemas are at `/docs`.
For example, replace `<your-key>` with the `WORKER_API_KEY` from `.env`:

```bash
curl --fail-with-body http://localhost:8000/simulate \
  -H 'Authorization: Bearer <your-key>' \
  -H 'Content-Type: application/json' \
  -d '{"network":"demo","duration_seconds":200,"seed":42,"edits":[
    {"type":"set_speed_limit","edge_id":"A0A1","speed_mps":5.0},
    {"type":"set_lane_count","edge_id":"A0A1","lane_count":1}
  ]}'
```

`network` selects `NETWORK_ROOT/<name>/network.net.xml` and `demand.rou.xml`.
Only simple names are accepted; symlinks cannot escape the network root. These
are trusted operator-managed SUMO assets, not arbitrary uploaded XML. SUMO XML
can itself reference local files, so do not mount untrusted scenarios.

Supported edits are `set_speed_limit` (metres/second), `set_lane_count`, and
`close_edge`. Duplicate edits of the same type on one edge are rejected; a closure
cannot be combined with another edit on that edge. Closures disallow all vehicle
classes. Fixed routes invalidated by edits fail rather than being silently
repaired. Native routing behavior explicitly configured in demand is preserved.
This worker does not yet generate or reroute demand.

Results include departed, completed, running, and pending vehicle counts, the
SUMO version, seed, applied edits, and average trip duration, waiting time, and
time loss. Averages cover completed, non-vaporized trips only and are `null` when
none complete. `pending` is the insertion backlog due before the exclusive
simulation horizon, not all future demand. Metrics exclude people/containers;
gridlock teleporting is disabled. Use identical network, demand, horizon, and seed
when comparing a baseline with a scenario.

### Recordings in Convex

Set `CONVEX_SITE_URL` in the worker environment to your deployment's HTTP actions
URL (for example `https://your-deployment.convex.site`). Configure the same
`WORKER_API_KEY` secret on that Convex deployment:

```bash
cd app
npx convex env set WORKER_API_KEY '<same-key-as-worker>'
cd ..
```

The Convex key is a deployment environment variable; adding it to
`app/.env.local` does not configure the endpoint. After editing the root `.env`,
run `docker compose up -d worker` to apply the worker environment.

Add `"record": true` to a simulation request to record a compressed JSON timeline.
`sample_interval_seconds` defaults to 5 (allowed range: 1–60). After simulation,
the worker calls `POST /networks/upload-url` with
`Authorization: Bearer <WORKER_API_KEY>` to obtain `{ "uploadUrl": "..." }`, then
streams `timeline.json.gz` to that URL as `application/gzip`. The upload URL
authorizes that upload; the worker does not forward its API key to it.

The simulation response includes:

```json
{
  "timeline": {
    "storage_id": "<Convex _storage ID>",
    "format": "application/gzip",
    "filename": "timeline.json.gz",
    "sample_interval_seconds": 5
  }
}
```

Local recording files are deleted after each request, including failed uploads.
Keep `storage_id` with the simulation result; backend playback code can resolve it with
`ctx.storage.getUrl(storageId)`. Recording requests return 503 if
`CONVEX_SITE_URL` is missing, or 502 if obtaining the upload URL or uploading fails.
Requests without recording do not need a Convex connection.

Requests are synchronous; no job is persisted. Convex job dispatch, durable
statuses, recovery, and playback are not connected yet. The default
wall-clock limit is 120 seconds (`SIMULATION_TIMEOUT_SECONDS`); timeout returns
504 and terminates the simulation process group. Capacity defaults to one run per
server process (`MAX_CONCURRENT_SIMULATIONS`); excess requests get 503 rather than
an in-memory queue. Invalid requests or failed simulations return 422; missing
assets return 404. Run one Uvicorn process per container so its concurrency limit
corresponds to the container's capacity.

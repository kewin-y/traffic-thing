# SUMO worker

This directory contains the uv-managed Python 3.12 simulation HTTP service.
It uses SUMO, `sumolib`, `traci`, and `libsumo` 1.28.0. Each request runs in an
isolated subprocess; network edits and simulation outputs use temporary files.
Mounted source networks are never modified.

## Local development

From the repository root, create a small synthetic network and fixed demand:

```bash
cd worker
uv sync --locked
mkdir -p ../networks/demo
uv run netgenerate --grid --grid.number 3 --default.lanenumber 2 \
  --output-file ../networks/demo/network.net.xml
uv run python -c 'from pathlib import Path; Path("../networks/demo/demand.rou.xml").write_text("""<routes>
  <route id="main" edges="A0A1 A1A2 A2B2 B2C2"/>
  <vehicle id="car-0" route="main" depart="0"/>
  <vehicle id="car-1" route="main" depart="1"/>
</routes>""")'
export WORKER_API_KEY="$(uv run python -c 'import secrets; print(secrets.token_hex(32))')"
export NETWORK_ROOT="$(realpath ../networks)"
uv run uvicorn traffic_worker.api:app --host 127.0.0.1 --port 8000
```

On Linux/Nix, enter the [repository devshell](../README.md#development-environment)
first: its shared libraries are needed by the native Python wheels. `uv` provisions
Python. Docker supplies these native libraries independently and does not require Nix.

## Docker

After creating `networks/demo` as above, run from the repository root with
`WORKER_API_KEY` exported in the same shell:

```bash
docker compose up --build
```

Alternatively, copy `worker/.env.example` to `worker/.env`, replace the example
secret, and use `docker compose --env-file worker/.env up --build`. Network assets
are mounted read-only and must be readable by container UID 10001. The image runs
as that non-root user and honors `PORT` (default 8000), including its healthcheck.
For Railway, build with `worker/` as the build context and provide a populated
volume at `/data/networks`; the image intentionally contains no Toronto data.

### Windows (PowerShell)

Install and start Docker Desktop with the WSL 2 backend and Linux containers.
No local Python or SUMO installation is needed.

1. Open **PowerShell** in the repository root (the folder containing `compose.yaml`).
   Paste each command below and press **Enter**:

   ```powershell
   Copy-Item worker/.env.example .env
   [guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N")
   notepad .env
   ```

2. Copy the generated 64-character string into `.env`, replacing the placeholder:

   ```dotenv
   WORKER_API_KEY=paste-the-generated-string-here
   ```

   Save and close Notepad. No quotes or spaces are needed. Keep `.env` out of
   version control; Docker Compose loads it automatically.

3. Paste this block into PowerShell to create a demo scenario and start the worker:

   ```powershell
   New-Item -ItemType Directory -Force networks/demo | Out-Null
   docker compose build worker
   docker compose run --rm --no-deps --volume "${PWD}/networks:/output" worker netgenerate --grid --grid.number 3 --default.lanenumber 2 --output-file /output/demo/network.net.xml
   @'
   <routes>
     <route id="main" edges="A0A1 A1A2 A2B2 B2C2"/>
     <vehicle id="car-0" route="main" depart="0"/>
     <vehicle id="car-1" route="main" depart="1"/>
   </routes>
   '@ | Set-Content -Encoding ascii networks/demo/demand.rou.xml
   docker compose up -d worker
   ```

4. Check <http://localhost:8000/health>. Open <http://localhost:8000/docs>,
   expand `POST /simulate`, and click **Try it out**. Set Authorization to
   `Bearer <your generated key>` and use this body, then click **Execute**:

   ```json
   {"network":"demo","duration_seconds":200,"seed":42,"edits":[]}
   ```

View logs: `docker compose logs -f worker`. Stop: `docker compose down`.

## HTTP contract

`GET /health` is unauthenticated. `POST /simulate` requires
`Authorization: Bearer <WORKER_API_KEY>`. Interactive schemas are at `/docs`.
For example, using the same exported key in another terminal:

```bash
curl --fail-with-body http://localhost:8000/simulate \
  -H "Authorization: Bearer $WORKER_API_KEY" \
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

Requests are synchronous; no job is persisted. Convex job dispatch, durable
statuses, recovery, and playback artifacts are not connected yet. The default
wall-clock limit is 120 seconds (`SIMULATION_TIMEOUT_SECONDS`); timeout returns
504 and terminates the simulation process group. Capacity defaults to one run per
server process (`MAX_CONCURRENT_SIMULATIONS`); excess requests get 503 rather than
an in-memory queue. Invalid requests or failed simulations return 422; missing
assets return 404. Run one Uvicorn process per container so its concurrency limit
corresponds to the container's capacity.

From `worker/`, run boundary regressions with `uv run --locked pytest`.

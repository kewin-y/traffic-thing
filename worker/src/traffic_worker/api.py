import json
import logging
import os
import secrets
import signal
import subprocess
import sys
import threading
import uuid
from contextlib import asynccontextmanager
from importlib.metadata import version
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from traffic_worker.assets import network_assets
from traffic_worker.models import SimulationRequest

logger = logging.getLogger(__name__)
bearer = HTTPBearer(auto_error=False)


@asynccontextmanager
async def lifespan(app: FastAPI):
    key = os.environ.get("WORKER_API_KEY", "")
    if not key:
        raise RuntimeError("WORKER_API_KEY must be configured")
    timeout = int(os.environ.get("SIMULATION_TIMEOUT_SECONDS", "120"))
    concurrency = int(os.environ.get("MAX_CONCURRENT_SIMULATIONS", "1"))
    if timeout <= 0 or concurrency <= 0:
        raise RuntimeError("Simulation timeout and concurrency must be positive integers")
    app.state.api_key = key
    app.state.timeout = timeout
    app.state.slots = threading.BoundedSemaphore(concurrency)
    app.state.network_root = Path(os.environ.get("NETWORK_ROOT", "/data/networks"))
    app.state.timeline_root = Path(os.environ.get("TIMELINE_ROOT", "/data/timelines"))
    app.state.timeline_root.mkdir(parents=True, exist_ok=True)
    yield


app = FastAPI(title="Traffic simulation worker", version="0.1.0", lifespan=lifespan)


def authenticate(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> None:
    if credentials is None or not secrets.compare_digest(
        credentials.credentials.encode(), request.app.state.api_key.encode()
    ):
        raise HTTPException(401, "Invalid worker credentials", headers={"WWW-Authenticate": "Bearer"})


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "sumo_version": version("eclipse-sumo")}


@app.post("/simulate", dependencies=[Depends(authenticate)])
def simulate(payload: SimulationRequest, request: Request) -> dict:
    try:
        network_assets(request.app.state.network_root, payload.network)
    except (OSError, ValueError):
        raise HTTPException(404, "Network assets not found or outside NETWORK_ROOT") from None
    if not request.app.state.slots.acquire(blocking=False):
        raise HTTPException(503, "Worker is busy", headers={"Retry-After": "1"})
    timeline_id = uuid.uuid4().hex if payload.record else None
    timeline_path = (
        request.app.state.timeline_root / f"{timeline_id}.json.gz"
        if timeline_id
        else None
    )
    timeline_ready = False
    try:
        child_environment = os.environ.copy()
        child_environment.pop("TIMELINE_OUTPUT_PATH", None)
        if timeline_path:
            child_environment["TIMELINE_OUTPUT_PATH"] = str(timeline_path)
        with subprocess.Popen(
            [sys.executable, "-m", "traffic_worker.runner"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            start_new_session=True,
            env=child_environment,
        ) as process:
            try:
                stdout, stderr = process.communicate(
                    payload.model_dump_json(), timeout=request.app.state.timeout
                )
            except subprocess.TimeoutExpired:
                # Kill netconvert as well as the runner before releasing capacity.
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.communicate()
                raise
        if process.returncode:
            logger.warning("Simulation failed: %s", stderr[-8000:])
            raise HTTPException(422, "Simulation failed; check road edits, demand, and worker logs")
        try:
            result = json.loads(stdout)
            if not isinstance(result, dict):
                raise TypeError("Expected a JSON object from runner")
        except (ValueError, TypeError):
            logger.error("Invalid runner output: %s", stdout[-2000:])
            raise HTTPException(500, "Simulation runner returned an invalid result") from None
        if timeline_id and timeline_path:
            if not timeline_path.is_file():
                logger.error("Recorded simulation did not produce a timeline")
                raise HTTPException(500, "Simulation runner did not produce a timeline")
            result["timeline"] = {
                "id": timeline_id,
                "url": f"/timelines/{timeline_id}",
                "format": "application/gzip",
                "filename": "timeline.json.gz",
                "sample_interval_seconds": payload.sample_interval_seconds,
            }
            timeline_ready = True
        return result
    except subprocess.TimeoutExpired:
        raise HTTPException(504, "Simulation exceeded its execution time limit") from None
    finally:
        if timeline_path and not timeline_ready:
            timeline_path.unlink(missing_ok=True)
            timeline_path.with_name(f"{timeline_path.name}.partial").unlink(missing_ok=True)
        request.app.state.slots.release()


@app.get("/timelines/{timeline_id}", dependencies=[Depends(authenticate)])
def get_timeline(timeline_id: str, request: Request) -> FileResponse:
    try:
        parsed_id = uuid.UUID(hex=timeline_id)
    except ValueError:
        raise HTTPException(404, "Timeline not found") from None
    if parsed_id.hex != timeline_id:
        raise HTTPException(404, "Timeline not found")
    path = request.app.state.timeline_root / f"{timeline_id}.json.gz"
    if not path.is_file():
        raise HTTPException(404, "Timeline not found")
    return FileResponse(
        path,
        media_type="application/gzip",
        filename="timeline.json.gz",
    )

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

import httpx
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from traffic_worker.assets import network_assets
from traffic_worker.models import SimulationRequest
from traffic_worker.predictor import Predictor   # new

import tempfile
from traffic_worker.demand import write_edgedata


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
        raise RuntimeError(
            "Simulation timeout and concurrency must be positive integers"
        )

    app.state.api_key = key
    app.state.convex_site_url = os.environ.get("CONVEX_SITE_URL", "").rstrip("/")
    app.state.timeout = timeout
    app.state.slots = threading.BoundedSemaphore(concurrency)
    app.state.network_root = Path(os.environ.get("NETWORK_ROOT", "/data/networks"))
    app.state.timeline_root = Path(os.environ.get("TIMELINE_ROOT", "/data/timelines"))
    app.state.timeline_root.mkdir(parents=True, exist_ok=True)

    model_root = Path(os.environ.get("MODEL_ROOT", "/data/model"))      # new

    app.state.model_network = os.environ.get("MODEL_NETWORK", "toronto-downtown")
    app.state.predictor = Predictor(model_root) if model_root.is_dir() else None
    if app.state.predictor is None:
        logger.warning("MODEL_ROOT not found; predictions disabled")

    yield


app = FastAPI(title="Traffic simulation worker", version="0.1.0", lifespan=lifespan)


def authenticate(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> None:
    if credentials is None or not secrets.compare_digest(
        credentials.credentials.encode(), request.app.state.api_key.encode()
    ):
        raise HTTPException(
            401, "Invalid worker credentials", headers={"WWW-Authenticate": "Bearer"}
        )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "sumo_version": version("eclipse-sumo")}

@app.post("/simulate", dependencies=[Depends(authenticate)])
def simulate(payload: SimulationRequest, request: Request) -> dict:
    if payload.record and not request.app.state.convex_site_url:
        raise HTTPException(503, "Recording uploads require CONVEX_SITE_URL")
    try:
        network_assets(request.app.state.network_root, payload.network)
    except (OSError, ValueError):
        raise HTTPException(
            404, "Network assets not found or outside NETWORK_ROOT"
        ) from None

    if not request.app.state.slots.acquire(blocking=False):
        raise HTTPException(503, "Worker is busy", headers={"Retry-After": "1"})
    timeline_id = uuid.uuid4().hex if payload.record else None
    scratch = None
    timeline_path = (
        request.app.state.timeline_root / f"{timeline_id}.json.gz"
        if timeline_id
        else None
    )

    try:
        child_environment = os.environ.copy()
        child_environment.pop("TIMELINE_OUTPUT_PATH", None)

        prediction = None
        predictor = request.app.state.predictor
        if predictor is not None and payload.network == request.app.state.model_network:
            try:
                edited, closed, skipped = predictor.apply_request_edits(payload.edits)
                volumes = predictor.predict_edited(edited, closed)
                scratch = tempfile.TemporaryDirectory(prefix="traffic-worker-model-")
                edgedata_path = Path(scratch.name) / "edgedata.xml"
                write_edgedata(
                    zip(volumes["edge_id"], volumes["veh_per_hour"]),
                    closed, payload.duration_seconds, edgedata_path,
                )
                child_environment["PREDICTED_EDGEDATA_PATH"] = str(edgedata_path)
                prediction = {"changes": predictor.compare(volumes), "unmodelled_edge_ids": skipped}
            except Exception:
                logger.exception("Model prediction failed; using mounted demand")

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
            raise HTTPException(
                422, "Simulation failed; check road edits, demand, and worker logs"
            )

        try:
            result = json.loads(stdout)
            if not isinstance(result, dict):
                raise TypeError("Expected a JSON object from runner")
        except (ValueError, TypeError):
            logger.error("Invalid runner output: %s", stdout[-2000:])
            raise HTTPException(
                500, "Simulation runner returned an invalid result"
            ) from None

        result["prediction"] = prediction

        if timeline_id and timeline_path:
            if not timeline_path.is_file():
                logger.error("Recorded simulation did not produce a timeline")
                raise HTTPException(500, "Simulation runner did not produce a timeline")
            try:
                storage_id = upload_timeline(
                    timeline_path,
                    request.app.state.convex_site_url,
                    request.app.state.api_key,
                )
            except (httpx.HTTPError, ValueError, TypeError, KeyError):
                # HTTP errors can contain the signed upload URL; do not log it.
                logger.warning("Recording upload to Convex failed")
                raise HTTPException(502, "Recording upload to Convex failed") from None
            result["timeline"] = {
                "storage_id": storage_id,
                "format": "application/gzip",
                "filename": "timeline.json.gz",
                "sample_interval_seconds": payload.sample_interval_seconds,
            }
        return result

    except subprocess.TimeoutExpired:
        raise HTTPException(
            504, "Simulation exceeded its execution time limit"
        ) from None
    finally:
        if timeline_path:
            timeline_path.unlink(missing_ok=True)
            timeline_path.with_name(f"{timeline_path.name}.partial").unlink(
                missing_ok=True
            )
        if scratch is not None: scratch.cleanup()
        request.app.state.slots.release()


def upload_timeline(path: Path, convex_site_url: str, api_key: str) -> str:
    with httpx.Client(timeout=120) as client:
        response = client.post(
            f"{convex_site_url}/networks/upload-url",
            headers={"Authorization": f"Bearer {api_key}"},
        )
        response.raise_for_status()
        upload_url = response.json()["uploadUrl"]
        if not isinstance(upload_url, str) or not upload_url:
            raise ValueError("Convex returned an invalid upload URL")
        with path.open("rb") as recording:
            response = client.post(
                upload_url,
                content=recording,
                headers={
                    "Content-Type": "application/gzip",
                    "Content-Length": str(path.stat().st_size),
                },
            )
        response.raise_for_status()
        storage_id = response.json()["storageId"]
        if not isinstance(storage_id, str) or not storage_id:
            raise ValueError("Convex returned an invalid storage ID")
        return storage_id

"""Local development bridge: claim Convex work and call the local worker API."""
import logging
import threading

import httpx

logger = logging.getLogger(__name__)


def consume(site_url: str, api_key: str, stop: threading.Event, local_url: str) -> None:
    headers = {"Authorization": f"Bearer {api_key}"}
    # A single consumer respects this worker's capacity. Convex claims are atomic.
    with httpx.Client(headers=headers, follow_redirects=False, timeout=30) as client:
        while not stop.is_set():
            try:
                response = client.post(f"{site_url}/simulations/claim", json={})
                response.raise_for_status()
                claim = response.json()
                if claim is None:
                    stop.wait(2)
                    continue
                completion = {"runId": claim["runId"], "leaseId": claim["leaseId"]}
                try:
                    result = client.post(f"{local_url}/simulate", json=claim["request"], timeout=420)
                    if result.is_success:
                        completion["result"] = result.json()
                    else:
                        completion["error"] = (
                            "Worker network version does not match this project."
                            if result.status_code == 409 else
                            f"Worker rejected the simulation ({result.status_code})."
                        )
                        completion["retryable"] = result.status_code in (429, 503) or (500 <= result.status_code < 600 and result.status_code != 504)
                except (httpx.HTTPError, ValueError):
                    completion.update(error="Worker connection failed.", retryable=True)
                # Retain the result when delivery fails; never repeat SUMO just to
                # resend a completion. A restarted process can use its receipt.
                while not stop.is_set():
                    try:
                        delivered = client.post(f"{site_url}/simulations/complete", json=completion)
                        delivered.raise_for_status()
                        break
                    except httpx.HTTPError:
                        logger.warning("Could not deliver simulation completion; retrying")
                        stop.wait(3)
            except (httpx.HTTPError, ValueError, KeyError, TypeError):
                logger.warning("Could not claim simulation work; retrying")
                stop.wait(5)

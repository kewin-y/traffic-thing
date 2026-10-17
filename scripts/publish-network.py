"""Publish an existing local SUMO import's map assets to Convex."""

import argparse
import hashlib
import json
import os
import re
import sys
import time
from pathlib import Path
from urllib.parse import urlsplit

import httpx

MAX_GEOJSON_BYTES = 4 * 1024 * 1024
MAX_MANIFEST_BYTES = 64 * 1024


def load_assets(directory: Path):
    manifest_path = directory / "manifest.json"
    geojson_path = directory / "edges.geojson"
    if manifest_path.stat().st_size > MAX_MANIFEST_BYTES:
        raise ValueError("Manifest exceeds the 64 KiB publish limit")
    if geojson_path.stat().st_size > MAX_GEOJSON_BYTES:
        raise ValueError("GeoJSON exceeds the 4 MiB publish limit")
    manifest_bytes = manifest_path.read_bytes()
    geojson_bytes = geojson_path.read_bytes()
    manifest = json.loads(manifest_bytes)
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,79}", manifest["network"]):
        raise ValueError("Invalid network name")
    checksums = manifest["sha256"]
    expected_files = {
        "source.osm.xml",
        "network.net.xml",
        "demand.rou.xml",
        "edges.geojson",
    }
    if set(checksums) != expected_files:
        raise ValueError("Manifest must contain all four import checksums")
    # Check the worker assets too, so the published map describes this local import.
    for name in sorted(expected_files):
        with (directory / name).open("rb") as source:
            actual = hashlib.file_digest(source, "sha256").hexdigest()
        if actual != checksums[name]:
            raise ValueError(f"{name} does not match its manifest checksum")
    version = hashlib.sha256(
        json.dumps(checksums, sort_keys=True).encode()
    ).hexdigest()[:16]
    if version != manifest["network_version"]:
        raise ValueError("Network version does not match its checksums")
    return manifest, manifest_bytes, geojson_bytes


def publish(directory: Path, site_url: str, api_key: str):
    parsed = urlsplit(site_url)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or parsed.path not in ("", "/")
    ):
        raise ValueError(
            "CONVEX_SITE_URL must be an HTTPS origin (use the .convex.site HTTP actions URL)"
        )
    if parsed.hostname.endswith(".convex.cloud"):
        raise ValueError("Use the .convex.site HTTP actions URL, not .convex.cloud")
    if not api_key:
        raise ValueError("WORKER_API_KEY must be configured")
    manifest, manifest_bytes, geojson_bytes = load_assets(directory)
    # Retrying the same version is safe: registration deduplicates atomically.
    with httpx.Client(timeout=120) as client:
        for attempt in range(3):
            if attempt:
                time.sleep(attempt)
            try:
                response = client.post(
                    f"{site_url.rstrip('/')}/networks/publish",
                    headers={"Authorization": f"Bearer {api_key}"},
                    files={
                        "manifest": (
                            "manifest.json",
                            manifest_bytes,
                            "application/json",
                        ),
                        "geojson": (
                            "edges.geojson",
                            geojson_bytes,
                            "application/geo+json",
                        ),
                    },
                )
            except httpx.TransportError:
                if attempt == 2:
                    raise RuntimeError(
                        "Could not reach Convex; local assets are unchanged"
                    ) from None
                continue
            if response.status_code < 500 or attempt == 2:
                break
        if response.status_code not in (200, 201):
            raise RuntimeError(
                f"Convex publish failed (HTTP {response.status_code}); check deployment, credentials, and asset validation. Local assets are unchanged."
            )
        result = response.json()
        if (
            not isinstance(result, dict)
            or not result.get("id")
            or result.get("network") != manifest["network"]
            or result.get("version") != manifest["network_version"]
        ):
            raise ValueError("Convex returned an invalid publish result")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("network", help="Directory name beneath --network-root")
    parser.add_argument("--network-root", type=Path, default=Path("/networks"))
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,79}", args.network):
        parser.error("Network must be a simple directory name")
    root = args.network_root.resolve(strict=True)
    directory = (root / args.network).resolve(strict=True)
    if not directory.is_relative_to(root):
        parser.error("Network directory must stay within the network root")
    result = publish(
        directory,
        os.environ.get("CONVEX_SITE_URL", ""),
        os.environ.get("WORKER_API_KEY", ""),
    )
    print(
        f"Published {result['network']} version {result['version']} (Convex ID: {result['id']})"
    )


if __name__ == "__main__":
    try:
        main()
    except RuntimeError as error:
        # Only our own fixed diagnostic messages, never raw HTTP exceptions.
        print(str(error), file=sys.stderr)
        raise SystemExit(1) from None
    except (OSError, ValueError, KeyError, TypeError):
        # Do not print HTTP exception details, request headers, or credentials.
        print(
            "Network publish failed. Check configuration, local manifest checksums, and Convex logs; local assets are unchanged.",
            file=sys.stderr,
        )
        raise SystemExit(1) from None

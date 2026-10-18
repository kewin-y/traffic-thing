from pathlib import Path


def network_assets(root: Path, network: str) -> tuple[Path, Path]:
    """Resolve operator-provided assets without allowing escapes through symlinks."""
    root = root.resolve(strict=True)
    directory = (root / network).resolve(strict=True)
    if not directory.is_relative_to(root) or not directory.is_dir():
        raise ValueError("Network must be a directory within NETWORK_ROOT")
    paths = tuple((directory / name).resolve(strict=True) for name in (
        "network.net.xml", "demand.rou.xml"
    ))
    for path in paths:
        if not path.is_relative_to(root) or not path.is_file():
            raise ValueError("Network assets must be files within NETWORK_ROOT")
    return paths[0], paths[1]


def verify_network_version(root: Path, network: str, expected: str) -> str:
    """Verify the manifest identity and the actual simulation inputs before running."""
    import hashlib
    import json
    import re

    source, demand = network_assets(root, network)
    manifest_path = (root / network / "manifest.json").resolve(strict=True)
    if not manifest_path.is_relative_to(root.resolve(strict=True)):
        raise ValueError("Manifest must be within NETWORK_ROOT")
    manifest = json.loads(manifest_path.read_text())
    hashes = manifest.get("sha256")
    if not isinstance(hashes, dict) or not hashes or not all(
        isinstance(name, str) and isinstance(value, str)
        and re.fullmatch(r"[a-f0-9]{64}", value)
        for name, value in hashes.items()
    ):
        raise ValueError("Invalid network checksums")
    version = hashlib.sha256(json.dumps(hashes, sort_keys=True).encode()).hexdigest()[:16]
    if manifest.get("network") != network or manifest.get("network_version") != version or version != expected:
        raise ValueError("Worker network version does not match the project")
    for name, path in [("network.net.xml", source), ("demand.rou.xml", demand)]:
        with path.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        if hashes.get(name) != digest:
            raise ValueError("Worker network files do not match their manifest")
    return version

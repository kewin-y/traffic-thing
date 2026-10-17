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

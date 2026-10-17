#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$repo_root/networks"
docker build --target importer -t traffic-thing-importer "$repo_root/worker"
docker run --rm --user "$(id -u):$(id -g)" \
    --volume "$repo_root/networks:/output" \
    --volume "$repo_root/scripts:/scripts:ro" \
    traffic-thing-importer python /scripts/import-toronto.py "$@"

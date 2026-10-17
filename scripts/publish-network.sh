#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
    printf 'Usage: bash %s <network-name>\n' "$0" >&2
    exit 1
fi
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="$repo_root/.env"
if [[ ! -f "$env_file" ]]; then
    env_file="$repo_root/worker/.env"
fi
docker build --target importer -t traffic-thing-importer "$repo_root/worker"
docker run --rm --env-file "$env_file" \
    --volume "$repo_root/networks:/networks:ro" \
    --volume "$repo_root/scripts:/scripts:ro" \
    traffic-thing-importer python /scripts/publish-network.py "$1"

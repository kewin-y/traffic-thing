#!/usr/bin/env bash
set -euo pipefail

force=false
if [[ $# -eq 1 && $1 == --force ]]; then
    force=true
elif [[ $# -ne 0 ]]; then
    printf 'Usage: bash %s [--force]\n' "$0" >&2
    exit 1
fi

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

if [[ -e networks/demo && $force == false ]]; then
    printf 'networks/demo already exists. Use --force to overwrite its demo files.\n' >&2
    exit 1
fi

mkdir -p networks/demo
docker compose build worker
# Match host ownership so Linux users can edit or remove the generated file.
docker compose run --rm --no-deps --user "$(id -u):$(id -g)" \
    --volume "$repo_root/networks:/output" worker netgenerate \
    --grid --grid.number 3 --default.lanenumber 2 \
    --output-file /output/demo/network.net.xml
cat > networks/demo/demand.rou.xml <<'XML'
<routes>
  <route id="main" edges="A0A1 A1A2 A2B2 B2C2"/>
  <vehicle id="car-0" route="main" depart="0"/>
  <vehicle id="car-1" route="main" depart="1"/>
</routes>
XML
printf 'Created networks/demo. Start the worker with: docker compose up -d worker\n'

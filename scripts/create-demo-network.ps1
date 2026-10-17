param(
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot
try {
    if ((Test-Path 'networks/demo') -and -not $Force) {
        throw 'networks/demo already exists. Use -Force to overwrite its demo files.'
    }

    New-Item -ItemType Directory -Force 'networks/demo' | Out-Null
    docker compose build worker
    if ($LASTEXITCODE -ne 0) {
        throw 'Worker image build failed.'
    }

    docker compose run --rm --no-deps --volume "${repoRoot}/networks:/output" worker netgenerate --grid --grid.number 3 --default.lanenumber 2 --output-file /output/demo/network.net.xml
    if ($LASTEXITCODE -ne 0) {
        throw 'Demo network generation failed.'
    }

    @'
<routes>
  <route id="main" edges="A0A1 A1A2 A2B2 B2C2"/>
  <vehicle id="car-0" route="main" depart="0"/>
  <vehicle id="car-1" route="main" depart="1"/>
</routes>
'@ | Set-Content -Encoding ascii 'networks/demo/demand.rou.xml'
    Write-Output 'Created networks/demo. Start the worker with: docker compose up -d worker'
}
finally {
    Pop-Location
}

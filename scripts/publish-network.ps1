param(
    [Parameter(Mandatory = $true)]
    [string]$Network
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$envFile = "$repoRoot/.env"
if (-not (Test-Path $envFile)) { $envFile = "$repoRoot/worker/.env" }
docker build --target importer -t traffic-thing-importer "$repoRoot/worker"
if ($LASTEXITCODE -ne 0) { throw 'Publisher image build failed.' }
docker run --rm --env-file $envFile --volume "${repoRoot}/networks:/networks:ro" --volume "${repoRoot}/scripts:/scripts:ro" traffic-thing-importer python /scripts/publish-network.py $Network
if ($LASTEXITCODE -ne 0) { throw 'Network publish failed; local assets are unchanged.' }

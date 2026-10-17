param(
    [switch]$Force,
    [switch]$Refresh
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
New-Item -ItemType Directory -Force "$repoRoot/networks" | Out-Null
docker build --target importer -t traffic-thing-importer "$repoRoot/worker"
if ($LASTEXITCODE -ne 0) {
    throw 'Importer image build failed.'
}

$importArgs = @()
if ($Force) { $importArgs += '--force' }
if ($Refresh) { $importArgs += '--refresh' }
docker run --rm --volume "${repoRoot}/networks:/output" --volume "${repoRoot}/scripts:/scripts:ro" traffic-thing-importer python /scripts/import-toronto.py @importArgs
if ($LASTEXITCODE -ne 0) {
    throw 'Toronto import failed.'
}

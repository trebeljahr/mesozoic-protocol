param([Parameter(Mandatory)][string]$Path)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/windows-signtool.ps1"
foreach ($required in @($Path, $env:AZURE_CODE_SIGNING_DLIB, $env:AZURE_CODE_SIGNING_METADATA)) {
    if (-not $required -or -not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "Required signing input missing: $required"
    }
}
& $signtool sign /v /fd SHA256 /tr http://timestamp.acs.microsoft.com /td SHA256 `
    /dlib $env:AZURE_CODE_SIGNING_DLIB /dmdf $env:AZURE_CODE_SIGNING_METADATA $Path
if ($LASTEXITCODE -ne 0) { throw "Signing failed: $Path (exit $LASTEXITCODE)" }
# Also verify during bundling, before this executable is embedded in installers.
& $signtool verify /pa /all /v /tw $Path
if ($LASTEXITCODE -ne 0) { throw "Signed file verification failed: $Path (exit $LASTEXITCODE)" }

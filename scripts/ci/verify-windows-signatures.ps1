$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/windows-signtool.ps1"
$root = (Resolve-Path "$PSScriptRoot/../..").Path
$release = Join-Path $root 'src-tauri/target/release'
$app = Join-Path $release 'mesozoic-protocol.exe'
if (-not (Test-Path -LiteralPath $app -PathType Leaf)) { throw "Missing app: $app" }
$msi = @(Get-ChildItem "$release/bundle/msi/*.msi")
$nsis = @(Get-ChildItem "$release/bundle/nsis/*-setup.exe")
if ($msi.Count -eq 0 -or $nsis.Count -eq 0) { throw 'Both MSI and NSIS installers are required' }
$files = @((Get-Item -LiteralPath $app)) + $msi + $nsis
$evidence = foreach ($file in $files) {
    & $signtool verify /pa /all /v /tw $file.FullName | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "Signature verification failed: $file" }
    $signature = Get-AuthenticodeSignature -LiteralPath $file.FullName
    if ($signature.Status -ne 'Valid') { throw "Invalid Authenticode status: $file" }
    $publisher = $signature.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
    if ($publisher -cne 'Ricos Labs LLC') { throw "Unexpected publisher '$publisher': $file" }
    if (-not $signature.TimeStamperCertificate) { throw "Missing trusted timestamp: $file" }
    [ordered]@{
        path = [System.IO.Path]::GetRelativePath($root, $file.FullName)
        sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
        status = $signature.Status.ToString()
        publisher = $publisher
        subject = $signature.SignerCertificate.Subject
        thumbprint = $signature.SignerCertificate.Thumbprint
        timestampSubject = $signature.TimeStamperCertificate.Subject
        commit = $env:GITHUB_SHA
        runId = $env:GITHUB_RUN_ID
    }
}
$evidence | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $root 'windows-signatures.json')
$evidence | ForEach-Object { Write-Host "$($_.path): $($_.status), $($_.publisher), SHA256 $($_.sha256)" }

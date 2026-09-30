$ErrorActionPreference = 'Stop'
$signtool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" |
    Where-Object { [version]$_.Directory.Parent.Name -ge [version]'10.0.22621.0' } |
    Sort-Object { [version]$_.Directory.Parent.Name } -Descending |
    Select-Object -First 1 -ExpandProperty FullName
if (-not $signtool) { throw 'Windows SDK x64 signtool >= 10.0.22621.0 not found' }

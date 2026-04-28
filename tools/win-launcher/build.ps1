#requires -PSEdition Desktop
# Builds MarinaraLauncher.exe using the .NET Framework 4 csc.exe shipped with Windows.
# Output is placed at the repo root so start.bat / shortcuts can find it next to package.json.

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$src = Join-Path $here 'Program.cs'
$repoRoot = Resolve-Path (Join-Path $here '..\..')
$out = Join-Path $repoRoot 'MarinaraLauncher.exe'

$csc = Get-ChildItem 'C:\Windows\Microsoft.NET\Framework64\v*\csc.exe' -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending | Select-Object -First 1
if (-not $csc) {
    throw "csc.exe not found under C:\Windows\Microsoft.NET\Framework64. .NET Framework 4 is required."
}

& $csc.FullName /nologo /target:winexe /platform:x64 /optimize+ /out:$out $src
if ($LASTEXITCODE -ne 0) { throw "Compile failed with exit code $LASTEXITCODE" }

Write-Host "Built: $out ($((Get-Item $out).Length) bytes)"

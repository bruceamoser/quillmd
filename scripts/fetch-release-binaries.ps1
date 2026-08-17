# QuillMD sidecar fetcher (Windows)
# Downloads pinned pandoc and typst release binaries into src-tauri/bin/ with
# the target-triple suffix that Tauri's bundle.externalBin expects.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/fetch-release-binaries.ps1

$ErrorActionPreference = "Stop"

$PandocVersion = "3.10.2"
$TypstVersion  = "v0.15.1"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root      = Split-Path -Parent $ScriptDir
$BinDir    = Join-Path $Root "src-tauri\bin"

# Windows target triples (x86_64 is the default; arm64 if detected).
$Triple = "x86_64-pc-windows-msvc"
if ($env:PROCESSOR_ARCHITECTURE -match "ARM") { $Triple = "aarch64-pc-windows-msvc" }

if ($Triple -eq "aarch64-pc-windows-msvc") {
    $PandocAsset = "pandoc-$PandocVersion-windows-arm64.zip"
    $TypstAsset  = "typst-aarch64-pc-windows-msvc.zip"
} else {
    $PandocAsset = "pandoc-$PandocVersion-windows-x86_64.zip"
    $TypstAsset  = "typst-x86_64-pc-windows-msvc.zip"
}

$PandocUrl = "https://github.com/jgm/pandoc/releases/download/$PandocVersion/$PandocAsset"
$TypstUrl  = "https://github.com/typst/typst/releases/download/$TypstVersion/$TypstAsset"

New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
$Tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("quillmd-sidecars-" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $Tmp | Out-Null

function Fetch-And-Extract {
    param([string]$Url, [string]$ExeName, [string]$Dest)
    $Zip = Join-Path $Tmp ([System.IO.Path]::GetFileName($Url))
    Write-Host "downloading $Url"
    Invoke-WebRequest -Uri $Url -OutFile $Zip -UseBasicParsing
    Expand-Archive -Path $Zip -DestinationPath $Tmp -Force
    $Exe = Get-ChildItem -Path $Tmp -Recurse -Filter $ExeName | Select-Object -First 1
    if (-not $Exe) { throw "did not find $ExeName in $Zip" }
    Copy-Item -Path $Exe.FullName -Destination $Dest -Force
    Write-Host "wrote $Dest"
}

Fetch-And-Extract -Url $PandocUrl -ExeName "pandoc.exe" -Dest (Join-Path $BinDir "pandoc-$Triple.exe")
Fetch-And-Extract -Url $TypstUrl  -ExeName "typst.exe"  -Dest (Join-Path $BinDir "typst-$Triple.exe")

Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue
Write-Host "done. run 'npm run tauri build' to bundle the MSI."

# QuillMD Windows setup + health check
# Run from PowerShell (Admin NOT required) in the repo root:
#   powershell -ExecutionPolicy Bypass -File scripts/setup-windows.ps1
# Checks prerequisites, reports what's missing, and installs what it can.

$ErrorActionPreference = "Continue"
Write-Host "=== QuillMD Windows environment check ===" -ForegroundColor Cyan

# 1. Node.js
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
    $v = & node --version
    Write-Host "[OK]   Node.js $v"
} else {
    Write-Host "[MISS] Node.js not found. Install from https://nodejs.org (LTS), then reopen this terminal." -ForegroundColor Yellow
}

# 2. npm
$npm = Get-Command npm -ErrorAction SilentlyContinue
if ($npm) {
    Write-Host "[OK]   npm $(& npm --version)"
} else {
    Write-Host "[MISS] npm not found (comes with Node.js)." -ForegroundColor Yellow
}

# 3. Rust / cargo
$cargo = Get-Command cargo -ErrorAction SilentlyContinue
if ($cargo) {
    Write-Host "[OK]   cargo $(& cargo --version)"
} else {
    Write-Host "[MISS] cargo not on PATH." -ForegroundColor Yellow
    Write-Host "       Install via rustup-init.exe from https://rustup.rs"
    Write-Host "       IMPORTANT: after install, CLOSE THIS TERMINAL and open a new one"
    Write-Host "       (PATH is not refreshed in the current session)."
}

# 4. MSVC Build Tools - NOT a PATH check. link.exe lives deep in the VS
#    install and is never on PATH by default. rustc discovers MSVC via
#    vswhere automatically, so cargo does NOT need link on PATH.
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$msvcFound = $false
if (Test-Path $vswhere) {
    $vsPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
    if ($vsPath) {
        $msvcFound = $true
        Write-Host "[OK]   MSVC Build Tools detected: $vsPath" -ForegroundColor Green
    }
}
if (-not $msvcFound) {
    # Fallback: check for any installed MSVC toolset directory
    $vcDirs = Get-ChildItem "${env:ProgramFiles}\Microsoft Visual Studio\*\*\VC\Tools\MSVC" -Directory -ErrorAction SilentlyContinue
    if ($vcDirs) {
        $msvcFound = $true
        Write-Host "[OK]   MSVC toolset detected: $($vcDirs[0].FullName)"
    }
}
if (-not $msvcFound) {
    Write-Host "[MISS] MSVC Build Tools not detected." -ForegroundColor Yellow
    Write-Host "       Install Visual Studio 2022 Build Tools (winget):"
    Write-Host "       winget install Microsoft.VisualStudio.2022.BuildTools --override '--add Microsoft.VisualStudio.Workload.VCTools --passive --norestart'"
    Write-Host "       Or VS Installer -> Modify -> 'Desktop development with C++'"
    Write-Host "       NOTE: cargo does NOT need link.exe on PATH; rustc finds MSVC automatically."
}

# 5. Git
$git = Get-Command git -ErrorAction SilentlyContinue
if ($git) {
    Write-Host "[OK]   git $(& git --version)"
} else {
    Write-Host "[MISS] git not found. Install from https://git-scm.com" -ForegroundColor Yellow
}

# 6. WebView2 (preinstalled on Win 10/11; only warn if absent)
$wv = Get-ItemProperty "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" -ErrorAction SilentlyContinue
if ($wv) {
    Write-Host "[OK]   WebView2 Runtime present"
} else {
    Write-Host "[WARN] WebView2 Runtime not detected. Run tauri dev once; it will prompt to install if needed." -ForegroundColor Yellow
}

# 7. Optional: pandoc + typst (import/export only)
$pandoc = Get-Command pandoc -ErrorAction SilentlyContinue
if ($pandoc) {
    Write-Host "[OK]   pandoc $(& pandoc --version | Select-Object -First 1)"
} else {
    Write-Host "[INFO] pandoc not found (only needed for import/export). choco install pandoc or https://pandoc.org" -ForegroundColor DarkGray
}
$typst = Get-Command typst -ErrorAction SilentlyContinue
if ($typst) {
    Write-Host "[OK]   typst $(& typst --version)"
} else {
    Write-Host "[INFO] typst not found (only needed for PDF export). https://github.com/typst/typst/releases" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "=== Summary ===" -ForegroundColor Cyan
$missing = @()
if (-not $node) { $missing += "Node.js" }
if (-not $cargo) { $missing += "Rust/cargo" }
if (-not $git) { $missing += "Git" }
if ($missing.Count -eq 0) {
    Write-Host "Core prerequisites present (Node, Rust, Git)." -ForegroundColor Green
    Write-Host "MSVC: $(if ($msvcFound) { 'detected' } else { 'NOT detected - install Build Tools before cargo build' })"
    Write-Host "Next:"
    Write-Host "   npm install"
    Write-Host "   npm run tauri dev"
} else {
    Write-Host "Missing: $($missing -join ', ')" -ForegroundColor Yellow
    Write-Host "Install the missing items, REOPEN your terminal, then re-run this script."
}

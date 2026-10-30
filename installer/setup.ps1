# Gleaner setup: everything in one run, for this Windows user (no admin rights needed).
#  1. Puts Gleaner in %LOCALAPPDATA%\Gleaner\extension (one fixed place, so updates keep working)
#  2. Installs the tools Gleaner's helper uses (Node.js, Python, yt-dlp, ffmpeg) with winget, if missing
#  3. Installs Scrapling (whole-site crawls, self-healing lists) in its own Python environment,
#     %LOCALAPPDATA%\Gleaner\scrapling
#  4. Sets up Gleaner's helper for that folder
#  5. Opens the browser's extensions page with the folder copied, for the one step a browser
#     only lets a person do: "Load unpacked" (browsers don't allow programs to add extensions).
# Running it again updates Gleaner in place: then just click Reload on the extensions page.
param(
  [switch]$SkipVideoTools,
  [switch]$NoBrowser,
  [switch]$NoHelper,
  [switch]$SkipScrapling,
  [string]$Target = (Join-Path $env:LOCALAPPDATA 'Gleaner\extension')
)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$src = Join-Path $here 'extension'

function Say($text, $color = 'Gray') { Write-Host $text -ForegroundColor $color }
function Step($n, $text) { Write-Host "`n[$n/5] $text" -ForegroundColor Cyan }
# A Python 3.10+ (not the Microsoft Store stub that only opens the Store)
function FindPython {
  foreach ($c in @(@('py', '-3'), @('python'), @('python3'))) {
    if (-not (Has $c[0])) { continue }
    try { $ok = & $c[0] @($c | Select-Object -Skip 1) -c 'import sys; print(sys.version_info >= (3, 10))' 2>$null } catch { continue }
    if ($ok -match 'True') { return ,$c }
  }
  return $null
}
function Has($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function RefreshPath { $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links') }

Say "`n  Gleaner setup" 'Red'
Say "  Everything Gleaner needs, in one run.`n"

if (-not (Test-Path (Join-Path $src 'manifest.json'))) {
  $repo = Split-Path -Parent $here
  if ((Test-Path (Join-Path $repo 'package.json')) -and (Test-Path (Join-Path $repo 'wxt.config.ts'))) {
    # Gleaner's source code (a GitHub download or a clone): build it first, then install that build
    $built = Join-Path $repo '.output\chrome-mv3'
    if (-not (Test-Path (Join-Path $built 'manifest.json'))) {
      Say "  This is Gleaner's source code, so Gleaner is built first (a few minutes, needs internet)." 'Yellow'
      RefreshPath
      if (-not (Has 'node')) {
        if (-not (Has 'winget')) { Say "  Node.js is needed to build Gleaner. Install it from https://nodejs.org, then run Install Gleaner again." 'Red'; exit 1 }
        Say '  Installing Node.js...'
        winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements | Out-Null
        RefreshPath
      }
      Say '  Downloading the parts Gleaner is built from (npm ci)...'
      Push-Location $repo
      cmd /c "npm ci --no-audit --no-fund --loglevel=error"
      if ($LASTEXITCODE -ne 0) { Pop-Location; Say "  The download failed (npm ci). Check the internet connection and run Install Gleaner again." 'Red'; exit 1 }
      Say '  Building Gleaner (npm run build)...'
      cmd /c "npm run build --silent" | Out-Null
      $code = $LASTEXITCODE
      Pop-Location
      if ($code -ne 0 -or -not (Test-Path (Join-Path $built 'manifest.json'))) { Say "  The build failed. Run 'npm run build' in $repo to see why." 'Red'; exit 1 }
      Say '  Built.'
    }
    $src = $built
  } elseif ($here -match '\\Temp\d*_|\\AppData\\Local\\Temp\\') {
    Say "Install Gleaner is running from inside the ZIP. Right-click the ZIP, choose Extract All, then run Install Gleaner from the unzipped folder." 'Red'; exit 1
  } else {
    Say "The 'extension' folder is missing next to this file. Unzip the whole Gleaner-Setup folder first, then run Install Gleaner again." 'Red'; exit 1
  }
}
$version = (Get-Content (Join-Path $src 'manifest.json') -Raw | ConvertFrom-Json).version

# 1. The extension, in one fixed place
Step 1 "Putting Gleaner $version in place"
$updating = Test-Path (Join-Path $Target 'manifest.json')
if ($updating) { Get-ChildItem $Target -Force | Remove-Item -Recurse -Force }
New-Item -ItemType Directory -Force $Target | Out-Null
Copy-Item (Join-Path $src '*') $Target -Recurse -Force
Say "  $Target"

# 2. Tools Gleaner's helper uses (optional): YouTube saving and the Scrapling engine
Step 2 "Tools for YouTube saving and the Site crawler"
$wanted = @()
if (-not $SkipVideoTools) {
  RefreshPath
  if (-not (Has 'node')) { $wanted += @{ id = 'OpenJS.NodeJS.LTS'; name = 'Node.js' } }
  if (-not $SkipScrapling -and -not (FindPython)) { $wanted += @{ id = 'Python.Python.3.12'; name = 'Python' } }
  if (-not (Has 'yt-dlp')) { $wanted += @{ id = 'yt-dlp.yt-dlp'; name = 'yt-dlp' } }
  if (-not (Has 'ffmpeg')) { $wanted += @{ id = 'Gyan.FFmpeg'; name = 'ffmpeg' } }
}
if ($SkipVideoTools) { Say '  Skipped.' }
elseif (-not $wanted.Count) { Say '  Node.js, Python, yt-dlp and ffmpeg are already installed.' }
elseif (-not (Has 'winget')) { Say "  winget isn't available, so these weren't installed: $(($wanted | ForEach-Object { $_.name }) -join ', '). Everything else in Gleaner works without them." 'Yellow' }
else {
  $answer = Read-Host "  Install $(($wanted | ForEach-Object { $_.name }) -join ', ') for YouTube saving and the Site crawler? [Y/n]"
  if ($answer -match '^(n|no)$') { Say '  Skipped. Run Install Gleaner again any time to add them.' }
  else {
    foreach ($w in $wanted) {
      Say "  Installing $($w.name)..."
      winget install --id $w.id -e --silent --accept-package-agreements --accept-source-agreements | Out-Null
      RefreshPath
    }
  }
}

# 3. Scrapling, in its own Python environment (the helper finds it there)
Step 3 'Installing Scrapling for the Site crawler and self-healing lists'
RefreshPath
$venv = Join-Path $env:LOCALAPPDATA 'Gleaner\scrapling'
$py = if ($SkipScrapling) { $null } else { FindPython }
if ($SkipScrapling) { Say '  Skipped.' }
elseif (-not $py) { Say "  Skipped: Python 3.10 or newer isn't installed. Everything else works; the Site crawler can install Scrapling later." 'Yellow' }
else {
  try {
    $vpy = Join-Path $venv 'Scripts\python.exe'
    if (-not (Test-Path $vpy)) { & $py[0] @($py | Select-Object -Skip 1) -m venv $venv | Out-Null }
    & $vpy -m pip install --disable-pip-version-check --quiet --upgrade pip | Out-Null
    & $vpy -m pip install --disable-pip-version-check --quiet --upgrade 'scrapling[fetchers]' | Out-Null
    $v = & $vpy -c 'import scrapling; print(scrapling.__version__)'
    Say "  Scrapling $v is ready."
  } catch { Say "  Scrapling couldn't be installed ($($_.Exception.Message)). The Site crawler can try again later." 'Yellow' }
}

# 4. Gleaner's helper, allowed for this folder
Step 4 "Setting up Gleaner's helper"
RefreshPath
if ($NoHelper) { Say '  Skipped.' }
elseif ((Has 'node') -and (Test-Path (Join-Path $Target 'helper\install.ps1'))) {
  & (Join-Path $Target 'helper\install.ps1') | Out-Null
  Say '  Done.'
} else { Say '  Skipped (Node.js is not installed). YouTube saving and the Site crawler are off; everything else works.' }

# 5. The one step the browser keeps for a person
Step 5 'Adding Gleaner to your browser'
$edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
$chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
$browsers = @()
if ($edge) { $browsers += @{ name = 'Edge'; exe = $edge; page = 'edge://extensions' } }
if ($chrome) { $browsers += @{ name = 'Chrome'; exe = $chrome; page = 'chrome://extensions' } }
if ($browsers.Count -gt 1 -and -not $NoBrowser) {
  $pick = Read-Host '  Add Gleaner to Edge, Chrome, or both? [E/c/b]'
  if ($pick -match '^c') { $browsers = @($browsers | Where-Object { $_.name -eq 'Chrome' }) }
  elseif ($pick -notmatch '^b') { $browsers = @($browsers | Where-Object { $_.name -eq 'Edge' }) }
}
if (-not $NoBrowser) { Set-Clipboard -Value $Target }

if ($updating) {
  Say "  Gleaner was updated. On the extensions page, click Reload on Gleaner." 'Green'
} else {
  Say '  The extensions page opens now. The folder Gleaner lives in is copied, ready to paste:' 'Green'
  Say '    1. Turn on Developer mode.'
  Say '    2. Click Load unpacked.'
  Say '    3. In the folder window, click the address bar at the top, press Ctrl+V, then Enter.'
  Say '    4. Click Select Folder. Gleaner appears in the list.'
  Say '    5. Pin it: click the puzzle piece in the toolbar, then the pin next to Gleaner.'
}
if (-not $NoBrowser) { foreach ($b in $browsers) { Start-Process $b.exe $b.page } }
if (-not $browsers.Count) { Say '  No Edge or Chrome found. Open your browser''s extensions page and load this folder:' 'Yellow'; Say "  $Target" }

Say "`n  Gleaner is ready. Run Install Gleaner again whenever you get a newer version.`n" 'Green'

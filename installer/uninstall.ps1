# Removes Gleaner from this Windows user: its files, its helper, the Scrapling environment and its
# saved crawl data, and the helper's registration with the browsers. Node.js, Python, yt-dlp and
# ffmpeg stay installed (other programs may use them). The extension itself is removed in the
# browser: click Remove on Gleaner on the extensions page.
param(
  [string]$Root = (Join-Path $env:LOCALAPPDATA 'Gleaner'),
  [switch]$NoRegistry,
  [switch]$NoBrowser
)
$ErrorActionPreference = 'Continue'
function Say($text, $color = 'Gray') { Write-Host $text -ForegroundColor $color }

Say "`n  Remove Gleaner`n" 'Red'

# 1. Stop Gleaner's helper and Scrapling engine if they're running (Windows can't delete files in use)
$rootFull = [IO.Path]::GetFullPath($Root)
$running = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
  ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) -or
  ($_.CommandLine -and $_.CommandLine.IndexOf($rootFull, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and $_.CommandLine -match 'gleaner-host\.mjs|scrapling_server\.py')
}
foreach ($p in $running) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
if ($running) { Say "  Stopped Gleaner's helper ($(@($running).Count) process$(if (@($running).Count -ne 1) { 'es' }))."; Start-Sleep -Milliseconds 800 }

# 2. The helper's registration with Chrome, Edge, Chromium and Brave
if (-not $NoRegistry) {
  foreach ($key in @('HKCU:\Software\Google\Chrome', 'HKCU:\Software\Microsoft\Edge', 'HKCU:\Software\Chromium', 'HKCU:\Software\BraveSoftware\Brave-Browser')) {
    Remove-Item -Path "$key\NativeMessagingHosts\com.gleaner.ytdlp" -Recurse -Force -ErrorAction SilentlyContinue
  }
  Say "  Removed the helper's browser registration."
}

# 3. Gleaner's files: the extension, the helper, the Scrapling environment and crawl data
if (Test-Path $Root) {
  Remove-Item -Path $Root -Recurse -Force -ErrorAction SilentlyContinue
  if (Test-Path $Root) { Say "  Some files are still in use. Close the browser, then run Uninstall Gleaner again. Folder: $Root" 'Yellow' }
  else { Say "  Removed $Root" }
} else { Say '  No Gleaner files found (already removed).' }

# 4. The extension itself: only the browser can remove it
Say "`n  Last step: on the extensions page, click Remove on Gleaner." 'Green'
Say '  That also deletes the data Gleaner kept in the browser (datasets, recipes, monitors).'
if (-not $NoBrowser) {
  $edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
  $chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($edge) { Start-Process $edge 'edge://extensions' }
  if ($chrome) { Start-Process $chrome 'chrome://extensions' }
}
Say "`n  Node.js, Python, yt-dlp and ffmpeg stay installed. Remove them in Settings > Apps if you don't need them.`n"

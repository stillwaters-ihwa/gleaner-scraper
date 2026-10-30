# Sets up Gleaner's YouTube helper for this Windows user (no admin rights needed).
#  - copies the helper to %LOCALAPPDATA%\Gleaner\helper (so rebuilding or moving Gleaner doesn't break it)
#  - tells Chrome and Edge that Gleaner may start it (registry, current user only)
# Run it again after moving the Gleaner folder. Undo with uninstall.cmd.
param([string]$ExtensionId = '')
$ErrorActionPreference = 'Stop'
$name = 'com.gleaner.ytdlp'
$src = Split-Path -Parent $MyInvocation.MyCommand.Path
$extDir = (Get-Item (Split-Path -Parent $src)).FullName
$dest = Join-Path $env:LOCALAPPDATA 'Gleaner\helper'

function Say($text, $color = 'Gray') { Write-Host $text -ForegroundColor $color }

# Chrome and Edge give an unpacked extension an ID made from its folder path
function IdForPath([string]$p) {
  $sha = [Security.Cryptography.SHA256]::Create()
  $hex = ($sha.ComputeHash([Text.Encoding]::Unicode.GetBytes($p)) | Select-Object -First 16 | ForEach-Object { $_.ToString('x2') }) -join ''
  -join ($hex.ToCharArray() | ForEach-Object { [char](97 + [Convert]::ToInt32([string]$_, 16)) })
}

Say "`nGleaner YouTube helper setup`n" 'Cyan'

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { Say 'Node.js is needed. Install it with:  winget install OpenJS.NodeJS.LTS   then run this again.' 'Red'; exit 1 }
$ytdlp = (Get-Command yt-dlp -ErrorAction SilentlyContinue).Source
if (-not $ytdlp) { $ytdlp = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\yt-dlp.exe'; if (-not (Test-Path $ytdlp)) { $ytdlp = '' } }
$ffmpeg = (Get-Command ffmpeg -ErrorAction SilentlyContinue).Source
if (-not $ffmpeg) { $ffmpeg = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\ffmpeg.exe'; if (-not (Test-Path $ffmpeg)) { $ffmpeg = '' } }
if (-not $ytdlp) { Say 'yt-dlp is not installed yet. Install it with:  winget install yt-dlp.yt-dlp' 'Yellow' }
if (-not $ffmpeg) { Say 'ffmpeg is not installed yet (needed above 720p). Install it with:  winget install Gyan.FFmpeg' 'Yellow' }

New-Item -ItemType Directory -Force $dest | Out-Null
Copy-Item (Join-Path $src 'gleaner-host.mjs') $dest -Force
Set-Content -Path (Join-Path $dest 'gleaner-host.cmd') -Encoding ascii -Value "@echo off`r`n`"$node`" `"%~dp0gleaner-host.mjs`" %*"
$downloads = (New-Object -ComObject Shell.Application).NameSpace('shell:Downloads').Self.Path
# Written without a byte-order mark: Node and Chrome read these files as plain JSON
function WriteJson($obj, $file) { [IO.File]::WriteAllText($file, ($obj | ConvertTo-Json), (New-Object Text.UTF8Encoding $false)) }
WriteJson @{ 'yt-dlp' = $ytdlp; ffmpeg = $ffmpeg; downloads = $downloads } (Join-Path $dest 'config.json')

# Allowed extensions: this folder's ID, one given on the command line, and any set up before
$manifestPath = Join-Path $dest "$name.json"
# This folder's ID, and the standard installed copy's (the installer puts Gleaner there)
$ids = @((IdForPath $extDir), (IdForPath (Join-Path $env:LOCALAPPDATA 'Gleaner\extension')))
if ($ExtensionId) { $ids += $ExtensionId.Trim() }
if (Test-Path $manifestPath) {
  try { $ids += (Get-Content $manifestPath -Raw | ConvertFrom-Json).allowed_origins | ForEach-Object { $_ -replace '^chrome-extension://|/$', '' } } catch {}
}
$ids = $ids | Where-Object { $_ -match '^[a-p]{32}$' } | Select-Object -Unique
WriteJson ([ordered]@{
  name = $name
  description = 'Gleaner YouTube helper (runs yt-dlp)'
  path = 'gleaner-host.cmd'
  type = 'stdio'
  allowed_origins = @($ids | ForEach-Object { "chrome-extension://$_/" })
}) $manifestPath

foreach ($key in @('HKCU:\Software\Google\Chrome\NativeMessagingHosts', 'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts', 'HKCU:\Software\Chromium\NativeMessagingHosts', 'HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts')) {
  New-Item -Path "$key\$name" -Force | Out-Null
  Set-ItemProperty -Path "$key\$name" -Name '(default)' -Value $manifestPath
}

Say "Done. Gleaner may now use yt-dlp." 'Green'
Say "  Helper:    $dest"
Say "  yt-dlp:    $(if ($ytdlp) { $ytdlp } else { 'not installed' })"
Say "  ffmpeg:    $(if ($ffmpeg) { $ffmpeg } else { 'not installed' })"
Say "  Saves to:  $downloads"
Say "  Gleaner:   $($ids -join ', ')"
Say "`nGo back to Gleaner and click 'Check again'."

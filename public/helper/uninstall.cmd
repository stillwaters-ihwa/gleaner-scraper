@echo off
rem Removes Gleaner's YouTube helper (yt-dlp and ffmpeg stay installed).
for %%K in ("HKCU\Software\Google\Chrome" "HKCU\Software\Microsoft\Edge" "HKCU\Software\Chromium" "HKCU\Software\BraveSoftware\Brave-Browser") do reg delete "%%~K\NativeMessagingHosts\com.gleaner.ytdlp" /f >nul 2>&1
rmdir /s /q "%LOCALAPPDATA%\Gleaner\helper" 2>nul
echo Gleaner's YouTube helper was removed.
pause

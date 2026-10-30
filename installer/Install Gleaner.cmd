@echo off
rem Installs or updates Gleaner. Double-click this file.
title Gleaner setup
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" %*
echo.
pause

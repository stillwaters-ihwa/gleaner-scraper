@echo off
rem Removes Gleaner: its files, helper, Scrapling environment and browser registration. Double-click this file.
title Remove Gleaner
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1" %*
echo.
pause

@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0director-webapp\start-director.ps1"
if errorlevel 1 pause

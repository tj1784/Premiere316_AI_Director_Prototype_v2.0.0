@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0block_resolve_internet.ps1" > "%~dp0block_resolve_internet.log" 2>&1
echo EXIT=%ERRORLEVEL%>> "%~dp0block_resolve_internet.log"

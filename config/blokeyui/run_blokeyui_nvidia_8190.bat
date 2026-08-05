@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start_premiere316_engine.ps1"
echo If you see this and ComfyUI did not start, try updating your Nvidia drivers to the latest.
echo If you get a c10.dll error, install VC Redist from https://aka.ms/vc14/vc_redist.x64.exe
pause

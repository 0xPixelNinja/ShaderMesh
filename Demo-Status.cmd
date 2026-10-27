@echo off
rem Show LAN IP, URLs, health, latest challenges and MetaMask settings.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\demo.ps1" status
pause

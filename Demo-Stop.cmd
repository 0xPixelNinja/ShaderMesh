@echo off
rem Stop both stacks. The local volumes are removed; Sepolia volumes are kept.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\demo.ps1" down
pause

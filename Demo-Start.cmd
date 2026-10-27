@echo off
rem Start the Sepolia and local stacks, then show the status page.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\demo.ps1" up
pause

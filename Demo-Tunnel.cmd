@echo off
rem Keep the reverse SSH tunnel to the public server open (inference and lease SSH).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts	unnel.ps1"
pause

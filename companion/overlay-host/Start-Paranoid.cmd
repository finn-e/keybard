@echo off
rem Keybard Overlay in paranoid mode: serves Keybard Paranoid and accepts no website origins.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Start-Windows.ps1" -Paranoid
if errorlevel 1 pause

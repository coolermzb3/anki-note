@echo off
call C:\Dev\autostart.bat

cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\tailscale-preview.ps1" -Action stop
set "SCRIPT_EXIT_CODE=%ERRORLEVEL%"
pause
exit /b %SCRIPT_EXIT_CODE%

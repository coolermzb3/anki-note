@echo off
call C:\Dev\autostart.bat

cd /d "%~dp0"
set "ANKI_TAILSCALE_EXPOSURE=private"
set "ANKI_TAILSCALE_PUBLIC_CHOICE="
set /p "ANKI_TAILSCALE_PUBLIC_CHOICE=Enable public access? (y/N): "
if /i "%ANKI_TAILSCALE_PUBLIC_CHOICE: =%"=="y" set "ANKI_TAILSCALE_EXPOSURE=public"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\tailscale-preview.ps1" -Action start-and-wait -Exposure "%ANKI_TAILSCALE_EXPOSURE%"
set "PREVIEW_SCRIPT_EXIT_CODE=%ERRORLEVEL%"
if not "%PREVIEW_SCRIPT_EXIT_CODE%"=="0" pause
exit /b %PREVIEW_SCRIPT_EXIT_CODE%

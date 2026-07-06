@echo off
call C:\Dev\autostart.bat

cd /d "%~dp0"
set "APP_URL=http://127.0.0.1:6136/"
set "CHROME_EXE=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME_EXE%" set "CHROME_EXE=chrome.exe"

if not exist node_modules (
  call pnpm install
)

start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process -FilePath '%CHROME_EXE%' -ArgumentList '%APP_URL%'"
call pnpm run dev
pause

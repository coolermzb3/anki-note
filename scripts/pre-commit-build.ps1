$ErrorActionPreference = "Stop"

Set-Location (Split-Path -Parent $PSScriptRoot)
& cmd.exe /d /c "call C:\Dev\autostart.bat && call pnpm run build"
exit $LASTEXITCODE

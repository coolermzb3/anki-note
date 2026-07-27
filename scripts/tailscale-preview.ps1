param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("start", "start-and-wait", "stop")]
  [string]$Action,

  [ValidateSet("private", "public")]
  [string]$Exposure = "private"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$previewPort = 6137
$viteEntry = Join-Path $projectRoot "node_modules\vite\bin\vite.js"

function Get-PreviewListener {
  Get-NetTCPConnection -LocalPort $previewPort -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
}

function Assert-ExpectedPreviewProcess($listener) {
  $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
  if (
    -not $processInfo -or
    $processInfo.Name -ne "node.exe" -or
    $processInfo.CommandLine -notlike "*$projectRoot\node_modules*vite.js*" -or
    $processInfo.CommandLine -notmatch "\bpreview\b"
  ) {
    throw "Port $previewPort is occupied by an unrelated process; refusing to change it."
  }
  return $processInfo
}

function Assert-LastCommandSucceeded([string]$description) {
  if ($LASTEXITCODE -ne 0) {
    throw "$description failed with exit code $LASTEXITCODE."
  }
}

function Get-TailscaleHostname([string]$tailscale) {
  $statusJson = & $tailscale status --json | Out-String
  Assert-LastCommandSucceeded "Tailscale status"
  $status = $statusJson | ConvertFrom-Json
  $hostname = ([string]$status.Self.DNSName).TrimEnd(".")
  if ($hostname -notmatch "\.ts\.net$") {
    throw "Tailscale did not report a valid ts.net hostname."
  }
  return $hostname
}

function Start-TailscalePreview([string]$selectedExposure) {
  $pnpm = (Get-Command pnpm.cmd -ErrorAction Stop).Source
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  $tailscale = (Get-Command tailscale.exe -ErrorAction Stop).Source
  $tailscaleHostname = Get-TailscaleHostname $tailscale
  $env:TAILSCALE_HOSTNAME = $tailscaleHostname
  $publicUrl = "https://$tailscaleHostname/"

  if (-not (Test-Path $viteEntry)) {
    & $pnpm install
    Assert-LastCommandSucceeded "pnpm install"
  }

  Push-Location $projectRoot
  try {
    & $pnpm run build
    Assert-LastCommandSucceeded "pnpm run build"
  } finally {
    Pop-Location
  }

  $listener = Get-PreviewListener
  $startedProcess = $null
  if ($listener) {
    Assert-ExpectedPreviewProcess $listener | Out-Null
  } else {
    $previewProcessOptions = @{
      FilePath = $node
      ArgumentList = @($viteEntry, "preview", "--host", "127.0.0.1", "--port", $previewPort, "--strictPort")
      WorkingDirectory = $projectRoot
      WindowStyle = "Hidden"
      PassThru = $true
    }
    $startedProcess = Start-Process @previewProcessOptions

    for ($attempt = 0; $attempt -lt 50; $attempt++) {
      Start-Sleep -Milliseconds 200
      $listener = Get-PreviewListener
      if ($listener) {
        break
      }
    }
    if (-not $listener) {
      if (-not $startedProcess.HasExited) {
        Stop-Process -Id $startedProcess.Id
      }
      throw "Preview did not start on port $previewPort."
    }
    Assert-ExpectedPreviewProcess $listener | Out-Null
  }

  if ($selectedExposure -eq "public") {
    & $tailscale funnel --bg --yes $previewPort
  } else {
    & $tailscale serve --bg --yes $previewPort
  }
  if ($LASTEXITCODE -ne 0) {
    if ($startedProcess -and -not $startedProcess.HasExited) {
      Stop-Process -Id $startedProcess.Id
    }
    throw "Tailscale HTTPS access failed to start."
  }

  $accessLabel = if ($selectedExposure -eq "public") { "public internet" } else { "tailnet only" }
  Write-Host "Preview URL: $publicUrl"
  Write-Host "Access: $accessLabel"
  Write-Host "Run tailscale-preview-off.bat as soon as testing is complete."
}

function Stop-TailscalePreview {
  $tailscale = (Get-Command tailscale.exe -ErrorAction Stop).Source
  & $tailscale funnel --https=443 off
  Assert-LastCommandSucceeded "Tailscale HTTPS shutdown"

  $listener = Get-PreviewListener
  if ($listener) {
    $processInfo = Assert-ExpectedPreviewProcess $listener
    Stop-Process -Id $processInfo.ProcessId
  }
  Write-Host "Tailscale HTTPS access and port $previewPort preview are off."
}

switch ($Action) {
  "start" {
    Start-TailscalePreview $Exposure
  }
  "start-and-wait" {
    Start-TailscalePreview $Exposure
    Read-Host "Preview is running. Press Enter to turn it off" | Out-Null
    Stop-TailscalePreview
  }
  "stop" {
    Stop-TailscalePreview
  }
}

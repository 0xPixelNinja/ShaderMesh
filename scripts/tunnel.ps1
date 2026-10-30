<#
.SYNOPSIS
  Reverse SSH tunnel from this provider laptop to the public operator server.

.DESCRIPTION
  The public orchestrator calls the provider at the endpoint registered on chain
  (the laptop's LAN address, port 8100). The server answers that address on its
  loopback interface and forwards it here, so inference works from the public
  site without changing the on-chain endpoint. Lease SSH ports 2201 to 2210 are
  published on the server for requesters outside the LAN.

  The server is read from DEMO_TUNNEL_HOST in the root .env (for example
  root@203.0.113.10). The tunnel restarts on its own if the connection drops.
  The local LAN demo does not depend on it.
#>
$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot

$TunnelHost = $env:DEMO_TUNNEL_HOST
if (-not $TunnelHost) {
  $line = Get-Content (Join-Path $Root '.env') -ErrorAction SilentlyContinue | Where-Object { $_ -match '^DEMO_TUNNEL_HOST=' } | Select-Object -First 1
  if ($line) { $TunnelHost = $line.Split('=', 2)[1].Trim().Trim('"') }
}
if (-not $TunnelHost) { throw 'Set DEMO_TUNNEL_HOST in the root .env, for example root@203.0.113.10' }

# Must match the endpoint the Sepolia provider registered on chain.
$EndpointHost = if ($env:DEMO_PROVIDER_ENDPOINT_HOST) { $env:DEMO_PROVIDER_ENDPOINT_HOST } else { '192.168.8.173' }

$forwards = @('-R', "${EndpointHost}:8100:localhost:8100")
foreach ($port in 2201..2210) { $forwards += @('-R', "0.0.0.0:${port}:localhost:${port}") }

Write-Host "Tunnel to $TunnelHost (inference on ${EndpointHost}:8100, lease SSH 2201-2210). Press Ctrl+C to stop."
while ($true) {
  & ssh -N -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes `
    -o StrictHostKeyChecking=accept-new @forwards $TunnelHost
  Write-Host "$(Get-Date -Format HH:mm:ss) tunnel closed (exit $LASTEXITCODE), reconnecting in 5 s"
  Start-Sleep -Seconds 5
}

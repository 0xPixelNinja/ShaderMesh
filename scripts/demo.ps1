<#
.SYNOPSIS
  Start, stop, and drive the ShaderMesh demo (Sepolia stack and local Hardhat stack on one host).

.EXAMPLE
  .\scripts\demo.ps1 up            # both stacks
  .\scripts\demo.ps1 up local      # local Hardhat stack only
  .\scripts\demo.ps1 status
  .\scripts\demo.ps1 cheat on      # local provider fails its next benchmark challenge
  .\scripts\demo.ps1 offline       # local provider stops heartbeating
  .\scripts\demo.ps1 enforce       # terminate local leases with a missed heartbeat
  .\scripts\demo.ps1 firewall      # one time, asks for administrator rights
#>
param(
  [Parameter(Position = 0)]
  [ValidateSet('up', 'down', 'status', 'cheat', 'offline', 'online', 'enforce', 'firewall', 'help')]
  [string]$Command = 'status',
  [Parameter(Position = 1)]
  [string]$Target = ''
)

$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$SepoliaFiles = @('-f', 'docker-compose.sepolia.yml')
$ProviderFiles = @('-f', 'docker-compose.provider.yml', '--env-file', './agent/.env')
$LocalFiles = @('-f', 'docker-compose.yml', '-f', 'docker-compose.local-demo.yml')

# Host ports. The Sepolia stack keeps the defaults; the local stack uses the second set.
$SepoliaWeb = 3000; $SepoliaApi = 4000
$LocalWeb = 3001; $LocalApi = 4001; $LocalRpc = 8545

function Write-Step($text) { Write-Host "==> $text" -ForegroundColor Cyan }
function Write-Warn($text) { Write-Host "warning: $text" -ForegroundColor Yellow }

function Get-LanIp {
  if ($env:DEMO_LAN_IP) { return $env:DEMO_LAN_IP }
  $virtual = 'vEthernet|WSL|Docker|VMware|VirtualBox|Loopback|Bluetooth|Hyper-V|Twingate|Cloudflare|WARP|Tailscale|ZeroTier|TAP|Teredo|isatap'
  $candidates = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.InterfaceAlias -notmatch $virtual -and $_.IPAddress -notlike '169.254.*' -and $_.IPAddress -ne '127.0.0.1' }
  # Prefer the adapter that owns the default route.
  $routes = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue |
    Sort-Object { $_.RouteMetric + $_.InterfaceMetric }
  foreach ($route in $routes) {
    $match = $candidates | Where-Object { $_.InterfaceIndex -eq $route.InterfaceIndex } | Select-Object -First 1
    if ($match) { return $match.IPAddress }
  }
  $first = $candidates | Select-Object -First 1
  if ($first) { return $first.IPAddress }
  return $null
}

function Invoke-Compose([string[]]$Files, [string[]]$ComposeArgs) {
  & docker compose @Files @ComposeArgs
  if ($LASTEXITCODE -ne 0) { throw "docker compose $($ComposeArgs -join ' ') failed (exit $LASTEXITCODE)" }
}

function Test-Ollama {
  try { Invoke-RestMethod -Uri 'http://localhost:11434/api/tags' -TimeoutSec 3 | Out-Null; return $true } catch { return $false }
}

function Get-Json($url) {
  try { return Invoke-RestMethod -Uri $url -TimeoutSec 5 } catch { return $null }
}

function Start-Sepolia {
  if (-not (Test-Path './agent/.env')) { Write-Warn 'agent/.env is missing; the Sepolia provider cannot sign.' }
  # The provider goes first so it is serving when the attester issues its first challenge.
  Write-Step 'Sepolia provider (host port 8100)'
  Invoke-Compose $ProviderFiles @('up', '-d')
  Write-Step 'Sepolia stack: ipfs, postgres, orchestrator, web, attester'
  Invoke-Compose $SepoliaFiles @('up', '-d')
}

function Start-Local {
  Write-Step 'Local Hardhat stack (web 3001, orchestrator 4001, chain 8545, provider 8101)'
  Invoke-Compose $LocalFiles @('up', '-d', '--build', '--wait', '--wait-timeout', '600')
}

function Stop-Sepolia {
  Write-Step 'Stopping Sepolia stack (volumes are kept)'
  Invoke-Compose $SepoliaFiles @('down')
  Invoke-Compose $ProviderFiles @('down')
}

function Stop-Local {
  # The Hardhat chain is in memory, so a restart is a new chain. Drop the volumes
  # so the indexer database and deployment file match the next chain.
  Write-Step 'Stopping local stack (volumes removed; the chain restarts empty)'
  Invoke-Compose $LocalFiles @('down', '-v')
}

function Set-LocalFault([string]$Fault) {
  Write-Step "Recreating only the local provider (BENCHMARK_FAULT='$Fault')"
  if ($Fault) { $env:BENCHMARK_FAULT = $Fault } else { Remove-Item Env:BENCHMARK_FAULT -ErrorAction SilentlyContinue }
  try { Invoke-Compose $LocalFiles @('up', '-d', '--no-deps', '--force-recreate', 'provider') }
  finally { Remove-Item Env:BENCHMARK_FAULT -ErrorAction SilentlyContinue }
}

function Show-LatestChallenge($apiUrl) {
  $list = Get-Json "$apiUrl/challenges"
  if ($null -eq $list) { Write-Host '  latest challenge: unavailable'; return }
  $items = @($list)
  if ($items.Count -eq 0) { Write-Host '  latest challenge: none yet'; return }
  $c = $items | Sort-Object { [int]$_.id } | Select-Object -Last 1
  $age = [Math]::Max(0, [int]([DateTimeOffset]::UtcNow.ToUnixTimeSeconds() - [int64]$c.issuedAt))
  Write-Host ('  latest challenge: #{0} {1}, slashed {2}, issued {3}s ago' -f $c.id, $c.status, $c.slashed, $age)
}

function Show-Health($apiUrl) {
  $h = Get-Json "$apiUrl/health"
  if ($null -ne $h -and $h.status -eq 'ok') {
    Write-Host "  health: ok (offers $($h.offers), jobs $($h.jobs))" -ForegroundColor Green
  } else {
    Write-Host '  health: DOWN or degraded (restart the orchestrator container if it stays degraded)' -ForegroundColor Red
  }
}

function Show-Status {
  $ip = Get-LanIp
  $hostName = if ($ip) { $ip } else { 'localhost' }
  Write-Host ''
  Write-Host "Host LAN IPv4: $(if ($ip) { $ip } else { 'not found (set DEMO_LAN_IP)' })" -ForegroundColor Cyan
  $public = Get-NetConnectionProfile -ErrorAction SilentlyContinue |
    Where-Object { $_.NetworkCategory -eq 'Public' -and $_.IPv4Connectivity -ne 'Disconnected' }
  if ($public) { Write-Warn "network '$($public.Name)' is on the Public profile; set it to Private or the firewall rules will not apply." }
  Write-Host "Ollama (host :11434): $(if (Test-Ollama) { 'running' } else { 'NOT RUNNING, start it with: ollama serve' })"
  Write-Host ''
  Write-Host 'Sepolia stack' -ForegroundColor Cyan
  Write-Host "  app:          http://${hostName}:$SepoliaWeb"
  Write-Host "  orchestrator: http://${hostName}:$SepoliaApi"
  Show-Health "http://localhost:$SepoliaApi"
  Show-LatestChallenge "http://localhost:$SepoliaApi"
  Write-Host ''
  Write-Host 'Local Hardhat stack' -ForegroundColor Cyan
  Write-Host "  app:          http://${hostName}:$LocalWeb"
  Write-Host "  orchestrator: http://${hostName}:$LocalApi"
  Show-Health "http://localhost:$LocalApi"
  Show-LatestChallenge "http://localhost:$LocalApi"
  $fault = & docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' shadermesh-provider-1 2>$null | Select-String '^BENCHMARK_FAULT=(.*)$'
  $faultValue = if ($fault) { $fault.Matches[0].Groups[1].Value } else { '' }
  Write-Host "  local provider fault: $(if ($faultValue) { $faultValue } else { 'off' })"
  Write-Host ''
  Write-Host 'MetaMask networks (add once on each device)' -ForegroundColor Cyan
  Write-Host '  Local chain'
  Write-Host '    Network name:    ShaderMesh Local'
  Write-Host "    RPC URL:         http://${hostName}:$LocalRpc"
  Write-Host '    Chain ID:        31337'
  Write-Host '    Currency symbol: ETH'
  Write-Host '  Sepolia'
  Write-Host '    Use the built-in Sepolia network (chain ID 11155111, symbol SepoliaETH).'
  Write-Host '    The device needs internet access for it.'
  Write-Host ''
}

function Add-FirewallRules {
  $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $admin) {
    Write-Step 'Administrator rights are required; requesting elevation'
    Start-Process powershell -Verb RunAs -Wait -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", 'firewall')
    return
  }
  $rules = @(
    @{ Name = 'ShaderMesh demo web and API'; Ports = '3000,3001,4000,4001,8545' },
    @{ Name = 'ShaderMesh demo lease SSH'; Ports = '2200-2299,2400-2499' }
  )
  foreach ($rule in $rules) {
    Get-NetFirewallRule -DisplayName $rule.Name -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    New-NetFirewallRule -DisplayName $rule.Name -Direction Inbound -Action Allow -Protocol TCP `
      -LocalPort ($rule.Ports -split ',') -Profile Private | Out-Null
    Write-Host "added inbound allow rule '$($rule.Name)' on TCP $($rule.Ports) (Private profile)"
  }
  Read-Host 'Press Enter to close'
}

switch ($Command) {
  'up' {
    switch ($Target) {
      '' { if (-not (Test-Ollama)) { Write-Warn 'Ollama is not running on :11434.' }; Start-Sepolia; Start-Local }
      'sepolia' { Start-Sepolia }
      'local' { if (-not (Test-Ollama)) { Write-Warn 'Ollama is not running on :11434.' }; Start-Local }
      default { throw "unknown target '$Target' (use local or sepolia)" }
    }
    Show-Status
  }
  'down' {
    switch ($Target) {
      '' { Stop-Local; Stop-Sepolia }
      'sepolia' { Stop-Sepolia }
      'local' { Stop-Local }
      default { throw "unknown target '$Target' (use local or sepolia)" }
    }
  }
  'status' { Show-Status }
  'cheat' {
    switch ($Target) {
      'on' { Set-LocalFault 'wrong_hash'; Write-Host 'The next local benchmark challenge will fail and the provider will be slashed.' }
      'off' { Set-LocalFault ''; Write-Host 'Fault cleared. A provider that was already slashed stays slashed until the local stack is reset.' }
      default { throw 'usage: demo.ps1 cheat on|off' }
    }
  }
  'offline' {
    Write-Step 'Stopping only the local provider'
    Invoke-Compose $LocalFiles @('stop', 'provider')
    Write-Host 'Heartbeats stop. After one 60 s interval plus the grace period run: demo.ps1 enforce'
  }
  'online' {
    Write-Step 'Starting only the local provider'
    Invoke-Compose $LocalFiles @('start', 'provider')
  }
  'enforce' {
    # RentalMarket.terminate() is permissionless and nothing calls it automatically.
    # This pipes a small script into the seed container (local chain, same addresses).
    Write-Step 'Terminating local leases that missed a heartbeat'
    Get-Content -Raw 'scripts/enforce_local.py' | & docker compose @LocalFiles run --rm -T --no-deps seed python -
    if ($LASTEXITCODE -ne 0) { throw 'enforce failed' }
  }
  'firewall' { Add-FirewallRules }
  'help' { Get-Help $PSCommandPath -Examples }
}

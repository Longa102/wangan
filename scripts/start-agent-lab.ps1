[CmdletBinding()]
param(
  [switch]$NoBrowser,
  [switch]$NoCode
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Test-LocalPort([int]$Port) {
  try {
    $client = [System.Net.Sockets.TcpClient]::new()
    $task = $client.ConnectAsync('127.0.0.1', $Port)
    if (-not $task.Wait(300)) { $client.Dispose(); return $false }
    $client.Dispose()
    return $true
  } catch { return $false }
}

function Wait-LocalPort([int]$Port, [int]$Seconds = 12) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-LocalPort $Port) { return $true }
    Start-Sleep -Milliseconds 300
  }
  return $false
}

function Test-DemoApi {
  try {
    $allow = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Method Post -Uri 'http://127.0.0.1:3001/api/agent-lab/run/allow'
    $ask = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Method Post -Uri 'http://127.0.0.1:3001/api/agent-lab/run/ask'
    return $allow.StatusCode -eq 200 -and $ask.StatusCode -eq 200
  } catch { return $false }
}

function Stop-OldDemoIfOwned {
  $listener = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $listener) { return }
  $process = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
  if (-not $process -or $process.ProcessName -ne 'node') {
    throw 'Port 3001 is occupied by a non-Node process. Stop it manually, then retry.'
  }
  $processPath = [string]$process.Path
  if ($processPath -notlike "$root*") {
    throw 'Port 3001 is occupied by a Node process outside this project. Stop it manually, then retry.'
  }
  Write-Host '[wangan] Replacing an older local demo process on port 3001...' -ForegroundColor Yellow
  Stop-Process -Id $listener.OwningProcess -Force
  Start-Sleep -Milliseconds 500
}

$node = Join-Path $root '.tools\node22\node.exe'
$tsNode = Join-Path $root 'node_modules\ts-node\dist\bin.js'
$npm = Join-Path $root '.tools\node22\npm.cmd'

if (-not (Test-Path $node)) {
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if (-not $nodeCommand) { throw 'Node.js was not found. Install Node.js 22+ or complete the project setup first.' }
  $node = $nodeCommand.Source
}

if (-not (Test-Path $tsNode)) {
  throw 'Project dependencies were not found. Run npm ci in the project root, then retry.'
}

if (-not (Test-Path (Join-Path $root 'demo\dist\index.html'))) {
  if (-not (Test-Path $npm)) { throw 'The demo is not built and the project-local npm command was not found. Run npm ci in the root and demo folders first.' }
  Write-Host '[wangan] First start: building the demo UI...' -ForegroundColor Yellow
  & $npm run build
  Push-Location (Join-Path $root 'demo')
  try { & $npm run build } finally { Pop-Location }
}

New-Item -ItemType Directory -Force -Path (Join-Path $root 'logs') | Out-Null

if (Test-LocalPort 9100) {
  Write-Host '[wangan] Controlled MCP is already running on port 9100; reusing it.' -ForegroundColor DarkGray
} else {
  Write-Host '[wangan] Starting controlled MCP on port 9100...' -ForegroundColor Cyan
  Start-Process -FilePath $node `
    -ArgumentList @($tsNode, '--transpile-only', (Join-Path $root 'scripts\controlled-mcp-server.ts')) `
    -WorkingDirectory $root -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $root 'logs\controlled-mcp.stdout.log') `
    -RedirectStandardError (Join-Path $root 'logs\controlled-mcp.stderr.log') | Out-Null
  if (-not (Wait-LocalPort 9100)) { throw 'Controlled MCP failed to start. See logs\controlled-mcp.stderr.log.' }
}

if ((Test-LocalPort 3001) -and (Test-DemoApi)) {
  Write-Host '[wangan] Demo console is already running on port 3001; reusing it.' -ForegroundColor DarkGray
} else {
  if (Test-LocalPort 3001) { Stop-OldDemoIfOwned }
  Write-Host '[wangan] Starting demo console on port 3001...' -ForegroundColor Cyan
  Start-Process -FilePath $node `
    -ArgumentList @($tsNode, '--transpile-only', (Join-Path $root 'scripts\demo-server.ts')) `
    -WorkingDirectory $root -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $root 'logs\demo-server.stdout.log') `
    -RedirectStandardError (Join-Path $root 'logs\demo-server.stderr.log') | Out-Null
  if (-not (Wait-LocalPort 3001)) { throw 'Demo console failed to start. See logs\demo-server.stderr.log.' }
}

Write-Host ''
Write-Host '============================================' -ForegroundColor Green
Write-Host ' wangan Agent Lab is ready' -ForegroundColor Green
Write-Host ' Demo console: http://127.0.0.1:3001' -ForegroundColor Green
Write-Host ' Next: use the ALLOW/BLOCK/USER CONFIRM buttons in the web console.' -ForegroundColor Green
Write-Host '============================================' -ForegroundColor Green

if (-not $NoCode) {
  $code = Get-Command code -ErrorAction SilentlyContinue
  if ($code) { Start-Process -FilePath $code.Source -ArgumentList @($root) }
}
if (-not $NoBrowser) { Start-Process 'http://127.0.0.1:3001' }

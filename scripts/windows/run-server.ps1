param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $ProjectRoot).Path
$entry = Join-Path $root 'apps\server\dist\index.js'
$bundledNode = Join-Path $root 'runtime\node.exe'
$node = if (Test-Path -LiteralPath $bundledNode) {
  $bundledNode
} else {
  (Get-Command node.exe -ErrorAction Stop).Source
}

if (-not (Test-Path -LiteralPath $entry)) {
  throw "Server build not found: $entry"
}

$dataDir = Join-Path $root 'data'
New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
$env:LAS_ROOT_DIR = $root
Set-Location -LiteralPath $root
& $node $entry *>> (Join-Path $dataDir 'startup-agent.log')
exit $LASTEXITCODE

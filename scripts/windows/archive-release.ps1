param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Expand', 'Compress')]
  [string]$Mode,

  [Parameter(Mandatory = $true)]
  [string]$Source,

  [Parameter(Mandatory = $true)]
  [string]$Destination
)

$ErrorActionPreference = 'Stop'

if ($Mode -eq 'Expand') {
  Expand-Archive -LiteralPath $Source -DestinationPath $Destination -Force
  exit 0
}

Compress-Archive `
  -LiteralPath $Source `
  -DestinationPath $Destination `
  -CompressionLevel Optimal `
  -Force

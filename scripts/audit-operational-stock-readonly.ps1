$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

$queryPath = Join-Path $root "scripts/stock-operational-readonly-audit.inline.ts"
$outputPath = Join-Path $root "stock-operational-readonly-audit.json"

if (-not (Test-Path $queryPath)) {
  throw "Arquivo de consulta não encontrado: $queryPath"
}

$query = Get-Content -Raw -Encoding UTF8 $queryPath

Write-Host "Executando consulta estritamente somente leitura em first-herring-264..."
Write-Host "Nenhuma publicação, migration ou alteração de dados será executada."

& npx.cmd convex run --deployment first-herring-264 --inline-query $query |
  Tee-Object -FilePath $outputPath

$exitCode = $LASTEXITCODE
if ($exitCode -ne 0) {
  throw "A consulta Convex terminou com código $exitCode. Nenhuma escrita foi executada."
}

Write-Host ""
Write-Host "Relatório salvo localmente em: $outputPath"

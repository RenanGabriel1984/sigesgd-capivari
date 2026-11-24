#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

if ! command -v npx >/dev/null 2>&1; then
  echo "Erro: Node.js/npx não encontrado." >&2
  exit 1
fi

QUERY_FILE="scripts/stock-operational-readonly-audit.inline.ts"
OUTPUT_FILE="${1:-stock-operational-readonly-audit.json}"

if [ ! -f "${QUERY_FILE}" ]; then
  echo "Erro: arquivo de consulta não encontrado: ${QUERY_FILE}" >&2
  exit 1
fi

echo "Executando consulta estritamente somente leitura em first-herring-264..."
echo "Nenhuma publicação, migration ou alteração de dados será executada."

npx convex run \
  --deployment first-herring-264 \
  --inline-query "$(cat "${QUERY_FILE}")" \
  | tee "${OUTPUT_FILE}"

echo
echo "Relatório salvo localmente em: ${OUTPUT_FILE}"

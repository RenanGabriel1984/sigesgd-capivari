/**
 * Gestão de Estoque SGGD — CONSUMO DE LOTES por SAÍDA.
 *
 * Módulo PURO (sem React e sem runtime Convex) para que as regras de
 * rastreabilidade de lote sejam testáveis sem tocar no banco.
 *
 * ─── PROBLEMA QUE ESTE MÓDULO RESOLVE ─────────────────────────────────────────
 *
 * A "saída rápida" consome lotes (FIFO) corretamente, mas registrava o lote
 * consumido APENAS dentro do texto da observation:
 *
 *     observation: "... | Lotes: LOT-2026-000001(1)"
 *     lotId:      undefined        ← fonte estruturada ausente
 *
 * Como `stockMovements.lotId` ficava vazio, a devolução posterior não tinha
 * como saber a qual lote devolver. O resultado era uma devolução que
 * restaurava APENAS o saldo global:
 *
 *     stock:               14 → 15   (restaurado)
 *     lots.quantityAvailable: 14 → 14 (NÃO restaurado)
 *
 * Essa assimetria é exatamente a divergência 3337 x 3338 observada no lote
 * LOT-2026-000001 (Cooler para processador Intel).
 *
 * ─── A REGRA ──────────────────────────────────────────────────────────────────
 *
 * Toda saída que efetivamente consome lote deve gravar o lote de origem no
 * campo estruturado `stockMovements.lotId`, para que a devolução devolva ao
 * MESMO lote. A escolha é determinística e reproduzível — nunca um FIFO
 * silencioso ou "o primeiro lote que aparecer".
 */

export interface LotConsumption {
  lotId: string;
  quantity: number;
}

/**
 * Resolve o lote ao qual a saída se refere, entre os que consumiu.
 *
 * Critério (determinístico e estável):
 *   1. nenhum consumo          → null (nenhum lote foi consumido);
 *   2. um único lote consumido  → esse lote;
 *   3. vários lotes            → o de MAIOR quantidade consumida; empate
 *                               resolvido por `lotId.localeCompare`, o que
 *                               torna o resultado independente da ordem de
 *                               leitura do banco.
 *
 * Devolver `null` apenas no caso (1) é essencial: nos demais casos existe um
 * lote de origem real e a devolução DEVE reconstituir o par
 * saldo global + quantityAvailable do lote.
 */
export function resolveConsumedLotId(
  consumptions: LotConsumption[],
): string | null {
  if (consumptions.length === 0) return null;
  if (consumptions.length === 1) return consumptions[0].lotId;
  return [...consumptions]
    .sort(
      (a, b) => b.quantity - a.quantity || a.lotId.localeCompare(b.lotId),
    )[0].lotId;
}

/**
 * Resumo legível dos lotes consumidos, para a observation da saída.
 *
 * Mantido por compatibilidade com os registros históricos e para leitura
 * humana. NÃO é a fonte de verdade: a fonte principal é o campo estruturado
 * `stockMovements.lotId`.
 */
export function formatConsumedLots(
  consumptions: LotConsumption[],
  lotNumberById: (lotId: string) => string | undefined,
): string {
  return consumptions
    .map((c) => {
      const number = lotNumberById(c.lotId);
      return number ? `${number}(${c.quantity})` : `?(${c.quantity})`;
    })
    .join(", ");
}

/**
 * Gestão de Estoque SGGD — CORREÇÕES HISTÓRICAS PONTUAIS (mutations).
 *
 * Duas correções de dados reais, ambas autorizadas explicitamente e ambas
 * IDEMPOTENTES. As regras (pré-condições, idempotência, textos de auditoria)
 * vivem em `src/lib/data-repairs.ts` e são testadas isoladamente.
 *
 * ─── O QUE ESTAS MUTATIONS NÃO FAZEM ─────────────────────────────────────────
 *
 * • Não criam, estornam nem alteram entradas.
 * • Não criam, removem nem desativam lotes.
 * • Não alteram quantidades físicas de produtos.
 * • Não alteram produtos, fornecedores, categorias ou localizações.
 * • Não alteram o estoque físico global (`stock.physicalQuantity`).
 * • Não criam movimentações de estoque.
 * • Não apagam auditoria existente.
 *
 * SÃO estritamente: `lots.areaId` (8 lotes) e
 * `lots.quantityAvailable` (1 lote) + `auditLogs`.
 */

import { getAuthUserId } from "@convex-dev/auth/server";
import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import {
  decideAreaRepair,
  decideLotAvailabilityRepair,
  isCoolerLotStateUnchanged,
  buildAreaRepairAuditDetail,
  buildLotAvailabilityAuditDetail,
  COOLER_LOT_EXPECTED_AVAILABLE,
} from "../lib/data-repairs";

// ─── Identificadores da correção (conferidos na investigação forense) ─────────

/** Área/Subestoque "Impressoras". */
const AREA_IMPRESSORAS_ID = "q97b7737gv98ajm8qqpmjmzjs18ezb58";

/** Entrada ENT-2026-000002 (NF 372043). */
const ENTRY_NF_372043_ID = "mh72zbyhdnsgnzhytzccc7cm9d8f2yb1";

/** Lote LOT-2026-000001 (Cooler para processador Intel). */
const COOLER_LOT_ID = "n179kw2gk7p08rw1qjh0tygzmm4k480k";

/**
 * Marcador estável da correção de área.
 *
 * A auditoria é gravada uma única vez: se já existir um log com este marcador
 * para a mesma entrada, a nova execução não duplica o registro. Isso mantém a
 * idempotência também no histórico, não apenas no estado dos lotes.
 */
const AREA_REPAIR_MARKER = "Correção histórica de área";

/** Lote a lote da NF 372043 com a área de destino "Impressoras". */
export const repairNf372043Area = internalMutation({
  args: {},
  handler: async (ctx) => {
    const entry: any = await ctx.db.get(ENTRY_NF_372043_ID as any);
    if (!entry) {
      return { applied: false, reason: `Entrada ${ENTRY_NF_372043_ID} não encontrada.`, fixed: [] as string[] };
    }

    const area: any = await ctx.db.get(AREA_IMPRESSORAS_ID as any);
    if (!area) {
      return { applied: false, reason: `Área ${AREA_IMPRESSORAS_ID} não encontrada.`, fixed: [] as string[] };
    }

    const lots: any[] = await ctx.db
      .query("lots")
      .withIndex("by_entry", (q) => q.eq("entryId", ENTRY_NF_372043_ID as any))
      .collect();

    if (lots.length === 0) {
      return { applied: false, reason: "A entrada não possui lotes.", fixed: [] as string[] };
    }

    const { decision, lotIdsToFix } = decideAreaRepair({
      targetAreaId: AREA_IMPRESSORAS_ID,
      lots: lots.map((l) => ({ lotId: l._id, areaId: l.areaId ?? null })),
    });

    if (!decision.shouldApply) {
      return {
        applied: false,
        reason: decision.reason,
        fixed: [] as string[],
        lotCount: lots.length,
        alreadyCorrect: lots.length,
      };
    }

    // Grava a área SOMENTE nos lotes que precisam, preservando os demais campos.
    const fixedLotNumbers: string[] = [];
    for (const lotId of lotIdsToFix) {
      const lot: any = await ctx.db.get(lotId as any);
      if (!lot) continue;
      await ctx.db.patch(lot._id, { areaId: AREA_IMPRESSORAS_ID as any });
      fixedLotNumbers.push(lot.lotNumber);
    }

    // Auditoria uma única vez (idempotente no histórico também).
    const alreadyLogged = await ctx.db.query("auditLogs").collect();
    const hasMarker = alreadyLogged.some(
      (a: any) =>
        a.entityId === ENTRY_NF_372043_ID &&
        (a.details ?? "").startsWith(AREA_REPAIR_MARKER),
    );

    if (!hasMarker) {
      const userId = await getAuthUserId(ctx).catch(() => null);
      await ctx.db.insert("auditLogs", {
        userId: userId ?? undefined,
        action: "update",
        entity: "entries",
        entityId: ENTRY_NF_372043_ID,
        details: buildAreaRepairAuditDetail({
          entryNumber: entry.entryNumber,
          invoiceNumber: entry.invoiceNumber ?? "",
          areaName: area.name,
          lotNumbers: fixedLotNumbers,
          fixedCount: fixedLotNumbers.length,
        }),
        timestamp: Date.now(),
      });
    }

    return {
      applied: true,
      reason: decision.reason,
      fixed: fixedLotNumbers,
      lotCount: lots.length,
      areaId: AREA_IMPRESSORAS_ID,
      areaName: area.name,
    };
  },
});

/**
 * Reconcilia `quantityAvailable` do lote LOT-2026-000001 (Cooler Intel).
 *
 * PRÉ-CONDIÇÃO: só corrige se `quantityAvailable` ainda for exatamente 14.
 * Se já for 15, nada acontece (idempotência). Se for qualquer outro valor, a
 * correção é interrompida e o motivo é reportado — o banco mudou desde o
 * diagnóstico e não deve ser sobrescrito.
 */
export const repairCoolerLotAvailability = internalMutation({
  args: {},
  handler: async (ctx) => {
    const lot: any = await ctx.db.get(COOLER_LOT_ID as any);
    if (!lot) {
      return { applied: false, reason: `Lote ${COOLER_LOT_ID} não encontrado.`, previous: null, current: null };
    }

    const product: any = await ctx.db.get(lot.productId);
    const productName: string = product?.name ?? "item";

    if (!isCoolerLotStateUnchanged(lot.quantityAvailable)) {
      return {
        applied: false,
        reason:
          `Estado mudou inesperadamente: quantityAvailable está ${lot.quantityAvailable}, ` +
          `e a correção histórica só vale para ${COOLER_LOT_INCONSISTENT_AVAILABLE_LABEL()}. ` +
          `Correção interrompida; nenhuma alteração realizada.`,
        previous: lot.quantityAvailable,
        current: lot.quantityAvailable,
      };
    }

    const decision = decideLotAvailabilityRepair({
      currentAvailable: lot.quantityAvailable,
      received: lot.quantityReceived,
      expectedAvailable: COOLER_LOT_EXPECTED_AVAILABLE,
    });

    if (!decision.shouldApply) {
      return { applied: false, reason: decision.reason, previous: lot.quantityAvailable, current: lot.quantityAvailable };
    }

    await ctx.db.patch(lot._id, { quantityAvailable: COOLER_LOT_EXPECTED_AVAILABLE });

    // Auditoria uma única vez (idempotente no histórico também).
    const existingLogs = await ctx.db.query("auditLogs").collect();
    const hasMarker = existingLogs.some(
      (a: any) =>
        a.entityId === COOLER_LOT_ID &&
        (a.details ?? "").startsWith("Correção histórica de consistência de lote"),
    );

    if (!hasMarker) {
      const userId = await getAuthUserId(ctx).catch(() => null);
      await ctx.db.insert("auditLogs", {
        userId: userId ?? undefined,
        action: "update",
        entity: "lots",
        entityId: COOLER_LOT_ID,
        details: buildLotAvailabilityAuditDetail({
          lotNumber: lot.lotNumber,
          productName,
          previousAvailable: 14,
          newAvailable: COOLER_LOT_EXPECTED_AVAILABLE,
          received: lot.quantityReceived,
          exitMovementRef: "kx758yrsbatdw2yc4m09ytfapn8en7mn",
          returnMovementRef: "kx70n82skp2ph9wq5d75020wp58ez5ag",
        }),
        timestamp: Date.now(),
      });
    }

    return {
      applied: true,
      reason: decision.reason,
      previous: 14,
      current: COOLER_LOT_EXPECTED_AVAILABLE,
      lotNumber: lot.lotNumber,
      productName,
    };
  },
});

function COOLER_LOT_INCONSISTENT_AVAILABLE_LABEL(): number {
  return 14;
}

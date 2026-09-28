/**
 * Gestão de Estoque SGGD — CORREÇÕES DE RASTREABILIDADE HISTÓRICA (mutations).
 *
 * ─── O QUE ESTE MÓDULO FAZ (e o que NUNCA faz) ───────────────────────────────
 *
 * Completam a cadeia Entrada → EntryItem → Lote → Movimento gravando SOMENTE
 * campos de referência:
 *
 *   traceEntryArea      → entries.areaId de ENT-2026-000002
 *                          (ausente → Impressoras; os lotes já foram corrigidos
 *                          na rodada anterior — esta mutation NÃO os toca).
 *   traceNf372043Items  → entryItems.lotId dos 8 itens da NF 372043
 *                          (ausente → lote correspondente LOT-2026-000054..61).
 *   traceCoolerMovements → stockMovements.lotId dos 2 movimentos históricos do
 *                          Cooler (saída + devolução; ausente → LOT-2026-000001).
 *
 * NUNCA: alteram quantidade (physicalQuantity, reservedQuantity,
 * quantityAvailable, quantityReceived), criam ou removem entradas, itens,
 * lotes ou movimentos, alteram status, fornecedor, NF, total, localização,
 * produto ou fornecedor, recalculam estoque, apagam auditoria.
 *
 * TODAS são idempotentes: vínculo já correto → no-op, sem auditoria duplicada.
 * As pré-condições vivem em `src/lib/data-repairs.ts` e são testadas isoladamente.
 */

import { getAuthUserId } from "@convex-dev/auth/server";
import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import {
  decideAreaRepair,
  decideLotAvailabilityRepair,
  decideEntryAreaRepair,
  decideEntryItemLotLink,
  decideMovementLotLink,
  buildAreaRepairAuditDetail,
  buildLotAvailabilityAuditDetail,
  buildEntryAreaTraceAuditDetail,
  buildEntryItemLotsTraceAuditDetail,
  buildMovementTraceAuditDetail,
  isCoolerLotStateUnchanged,
  COOLER_LOT_EXPECTED_AVAILABLE,
  COOLER_LOT_INCONSISTENT_AVAILABLE,
  NF372043_EXPECTED_LOTS,
} from "../lib/data-repairs";

// ─── Identificadores conferidos no banco (rodadas de diagnóstico) ─────────────

/** Área/Subestoque "Impressoras". */
const AREA_IMPRESSORAS_ID = "q97b7737gv98ajm8qqpmjmzjs18ezb58";

/** Entrada ENT-2026-000002 (NF 372043). */
const ENTRY_NF_372043_ID = "mh72zbyhdnsgnzhytzccc7cm9d8f2yb1";

/** Lote LOT-2026-000001 (Cooler para processador Intel). */
const COOLER_LOT_ID = "n179kw2gk7p08rw1qjh0tygzmm4k480k";

/** Produto Cooler para processador Intel. */
const COOLER_PRODUCT_ID = "kd765djstdgckchkpk8rgmmntd002gy4";

/** Movimento histórico de SAÍDA do Cooler (kx758yrs…). */
const COOLER_EXIT_MOVEMENT_ID = "kx758yrsbatdw2yc4m09ytfapn8en7mn";

/** Movimento histórico de DEVOLUÇÃO do Cooler (kx70n82s…). */
const COOLER_RETURN_MOVEMENT_ID = "kx70n82skp2ph9wq5d75020wp58ez5ag";

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
    const alreadyLogged = await hasAuditMarker(ctx, entry._id, AREA_REPAIR_MARKER);
    if (!alreadyLogged) {
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
          `e a correção histórica só vale para ${COOLER_LOT_INCONSISTENT_AVAILABLE}. ` +
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
    const alreadyLogged = await hasAuditMarker(
      ctx,
      COOLER_LOT_ID,
      "Correção histórica de consistência de lote",
    );
    if (!alreadyLogged) {
      const userId = await getAuthUserId(ctx).catch(() => null);
      await ctx.db.insert("auditLogs", {
        userId: userId ?? undefined,
        action: "update",
        entity: "lots",
        entityId: COOLER_LOT_ID,
        details: buildLotAvailabilityAuditDetail({
          lotNumber: lot.lotNumber,
          productName,
          previousAvailable: COOLER_LOT_INCONSISTENT_AVAILABLE,
          newAvailable: COOLER_LOT_EXPECTED_AVAILABLE,
          received: lot.quantityReceived,
          exitMovementRef: COOLER_EXIT_MOVEMENT_ID,
          returnMovementRef: COOLER_RETURN_MOVEMENT_ID,
        }),
        timestamp: Date.now(),
      });
    }

    return {
      applied: true,
      reason: decision.reason,
      previous: COOLER_LOT_INCONSISTENT_AVAILABLE,
      current: COOLER_LOT_EXPECTED_AVAILABLE,
      lotNumber: lot.lotNumber,
      productName,
    };
  },
});

/* ─── A) areaId da ENTRADA ENT-2026-000002 ──────────────────────────────────── */

export const traceEntryArea = internalMutation({
  args: {},
  handler: async (ctx) => {
    const entry: any = await ctx.db.get(ENTRY_NF_372043_ID as any);
    if (!entry) return { applied: false, reason: "Entrada não encontrada." };

    const area: any = await ctx.db.get(AREA_IMPRESSORAS_ID as any);
    if (!area) return { applied: false, reason: "Área Impressoras não encontrada." };

    const supplier: any = entry.supplierId ? await ctx.db.get(entry.supplierId) : null;

    const decision = decideEntryAreaRepair({
      entry: {
        entryNumber: entry.entryNumber,
        invoiceNumber: entry.invoiceNumber ?? "",
        supplierLegalName: supplier?.legalName ?? null,
        status: entry.status,
        areaId: entry.areaId ?? null,
      },
      targetAreaId: AREA_IMPRESSORAS_ID,
    });

    if (!decision.shouldApply) return { applied: false, reason: decision.reason };

    // ÚNICA escrita autorizada: o campo de referência areaId da entrada.
    await ctx.db.patch(entry._id, { areaId: AREA_IMPRESSORAS_ID as any });

    // Auditoria: uma única vez (idempotente também no histórico).
    const alreadyLogged = await hasAuditMarker(ctx, entry._id, "areaId da ENTRADA ausente");
    if (!alreadyLogged) {
      const userId = await getAuthUserId(ctx).catch(() => null);
      await ctx.db.insert("auditLogs", {
        userId: userId ?? undefined,
        action: "update",
        entity: "entries",
        entityId: entry._id,
        details: buildEntryAreaTraceAuditDetail({
          entryNumber: entry.entryNumber,
          invoiceNumber: entry.invoiceNumber ?? "",
          areaName: area.name,
        }),
        timestamp: Date.now(),
      });
    }

    return { applied: true, reason: decision.reason, entryNumber: entry.entryNumber, areaId: AREA_IMPRESSORAS_ID };
  },
});

/* ─── B) lotId dos 8 entryItems da NF 372043 ────────────────────────────────── */

export const traceNf372043Items = internalMutation({
  args: {},
  handler: async (ctx) => {
    const entry: any = await ctx.db.get(ENTRY_NF_372043_ID as any);
    if (!entry) return { applied: false, reason: "Entrada não encontrada.", linked: [] };

    const lots: any[] = await ctx.db
      .query("lots")
      .withIndex("by_entry", (q) => q.eq("entryId", ENTRY_NF_372043_ID as any))
      .collect();

    const items: any[] = await ctx.db
      .query("entryItems")
      .withIndex("by_entry", (q) => q.eq("entryId", ENTRY_NF_372043_ID as any))
      .collect();

    // Mapeamento obrigatório: cada entryItem casa com o lote do MESMO produto.
    const lotByProduct = new Map<string, any>();
    for (const spec of NF372043_EXPECTED_LOTS) {
      const lot = lots.find((l) => l.lotNumber === spec.lotNumber && l.productId === spec.productId);
      if (!lot) continue;
      lotByProduct.set(spec.productId, lot);
    }

    const linked: Array<{ entryItemId: string; lotNumber: string; productId: string }> = [];
    const alreadyOk: string[] = [];
    const failures: string[] = [];

    for (const item of items) {
      const lot = lotByProduct.get(item.productId);
      if (!lot) {
        failures.push(`EntryItem ${item._id} (produto ${item.productId}) sem lote esperado correspondente.`);
        continue;
      }

      const { decision, targetLotId } = decideEntryItemLotLink({
        item: {
          entryItemId: item._id,
          entryId: item.entryId,
          productId: item.productId,
          quantity: item.quantity,
          lotId: item.lotId ?? null,
        },
        lot: {
          lotId: lot._id,
          lotNumber: lot.lotNumber,
          entryId: lot.entryId,
          productId: lot.productId,
          quantityReceived: lot.quantityReceived,
        },
        entryId: ENTRY_NF_372043_ID,
      });

      if (!decision.shouldApply) {
        if (targetLotId) alreadyOk.push(item._id);
        else failures.push(`EntryItem ${item._id}: ${decision.reason}`);
        continue;
      }

      // ÚNICA escrita autorizada: lotId do entryItem. Nenhuma outra coluna.
      await ctx.db.patch(item._id, { lotId: targetLotId! as any });
      linked.push({ entryItemId: item._id, lotNumber: lot.lotNumber, productId: item.productId });
    }

    if (linked.length === 0) {
      return {
        applied: false,
        reason:
          failures.length > 0
            ? `Nenhum vínculo aplicado. Falhas: ${failures.join(" | ")}`
            : `Todos os ${alreadyOk.length} entryItem(s) já possuem o lotId correto — nada a fazer (idempotente).`,
        linked,
        alreadyOk,
        failures,
      };
    }

    // Auditoria: uma única vez (idempotente também no histórico).
    const alreadyLogged = await hasAuditMarker(ctx, entry._id, "entryItem(s) receberam lotId");
    if (!alreadyLogged) {
      const userId = await getAuthUserId(ctx).catch(() => null);
      await ctx.db.insert("auditLogs", {
        userId: userId ?? undefined,
        action: "update",
        entity: "entryItems",
        entityId: entry._id,
        details: buildEntryItemLotsTraceAuditDetail({
          entryNumber: entry.entryNumber,
          invoiceNumber: entry.invoiceNumber ?? "",
          links: linked.map((l) => ({ lotNumber: l.lotNumber, entryItemId: l.entryItemId })),
        }),
        timestamp: Date.now(),
      });
    }

    return {
      applied: true,
      reason: `${linked.length} entryItem(s) vinculado(s) ao lote correspondente.`,
      linked,
      alreadyOk,
      failures,
    };
  },
});

/* ─── C/D) lotId dos dois movimentos históricos do Cooler ───────────────────── */

export const traceCoolerMovements = internalMutation({
  args: {},
  handler: async (ctx) => {
    const lot: any = await ctx.db.get(COOLER_LOT_ID as any);
    if (!lot) return { applied: false, reason: "Lote LOT-2026-000001 não encontrado.", fixed: [] };

    const product: any = await ctx.db.get(lot.productId);
    const productName: string = product?.name ?? "item";

    const results: Array<{ movementId: string; type: string; applied: boolean; reason: string }> = [];
    const fixed: string[] = [];

    for (const [movementId, expectedType] of [
      [COOLER_EXIT_MOVEMENT_ID, "exit"],
      [COOLER_RETURN_MOVEMENT_ID, "return"],
    ] as const) {
      const m: any = await ctx.db.get(movementId as any);
      if (!m) {
        results.push({ movementId, type: expectedType, applied: false, reason: "Movimento não encontrado." });
        continue;
      }

      const decision = decideMovementLotLink({
        movement: {
          movementId: m._id,
          type: m.type,
          quantity: m.quantity,
          productId: m.productId,
          lotId: m.lotId ?? null,
        },
        coolerProductId: COOLER_PRODUCT_ID,
        coolerLotId: COOLER_LOT_ID,
        expectedType,
      });

      if (!decision.shouldApply) {
        results.push({ movementId, type: expectedType, applied: false, reason: decision.reason });
        continue;
      }

      // ÚNICA escrita autorizada: lotId do movimento. Quantidade/saldo intactos.
      await ctx.db.patch(m._id, { lotId: COOLER_LOT_ID as any });
      fixed.push(m._id);
      results.push({ movementId, type: expectedType, applied: true, reason: decision.reason });

      const alreadyLogged = await hasAuditMarker(ctx, m._id, `movimento ${m._id} (${m.type}`);
      if (!alreadyLogged) {
        const userId = await getAuthUserId(ctx).catch(() => null);
        await ctx.db.insert("auditLogs", {
          userId: userId ?? undefined,
          action: "update",
          entity: "stockMovements",
          entityId: m._id,
          details: buildMovementTraceAuditDetail({
            productName,
            movementId: m._id,
            movementType: m.type,
            lotNumber: lot.lotNumber,
          }),
          timestamp: Date.now(),
        });
      }
    }

    return {
      applied: fixed.length > 0,
      reason:
        fixed.length > 0
          ? `${fixed.length} movimento(s) vinculado(s) ao lote ${lot.lotNumber}.`
          : "Nenhum movimento precisou de vínculo (idempotente) ou pré-condição falhou — ver detalhes.",
      results,
      fixed,
      lotNumber: lot.lotNumber,
      productName,
    };
  },
});

/* ─── Helpers ───────────────────────────────────────────────────────────────── */

/**
 * Detecta se a auditoria desta correção já existe, para manter a idempotência
 * também no histórico. Compara um trecho estável do details + entityId, sem
 * apagar nada.
 */
async function hasAuditMarker(ctx: any, entityId: string, marker: string): Promise<boolean> {
  const logs = await ctx.db.query("auditLogs").collect();
  return logs.some((a: any) => a.entityId === entityId && (a.details ?? "").includes(marker));
}

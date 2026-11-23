import { internalQuery } from "./_generated/server";
import { LEGACY_GENERAL_AREA_CLASSIFICATION_TARGETS } from "../lib/legacy-general-area-classification";
import { inspectLotLocationBalances } from "../lib/lot-location-balance";

/**
 * Diagnóstico estritamente somente leitura da divergência que bloqueou a
 * classificação legada de TI Geral. Não altera estoque, lotes ou auditoria.
 */
export const legacyGeneralAreaClassificationDiagnostic = internalQuery({
  args: {},
  handler: async (ctx) => {
    const target = LEGACY_GENERAL_AREA_CLASSIFICATION_TARGETS.find(
      (item) => item.productName === "Cooler para processador Intel"
    );
    if (!target) {
      return { readOnly: true, found: false, reason: "Produto não está no manifesto fechado." };
    }

    const entryMatches: any[] = await ctx.db
      .query("entries")
      .withIndex("by_number", (q: any) => q.eq("entryNumber", "ENT-2026-000001"))
      .collect();

    if (entryMatches.length !== 1) {
      return {
        readOnly: true,
        found: false,
        reason: entryMatches.length === 0
          ? "Entrada ENT-2026-000001 não encontrada."
          : `Entrada ENT-2026-000001 ambígua: ${entryMatches.length} registros encontrados.`,
        candidateIds: entryMatches.map((candidate) => String(candidate._id)),
        expected: target,
      };
    }
    const entry: any = entryMatches[0];

    const [product, location, lot, localRow, entryItems, productMovements, allMovementLinks]: any[] =
      await Promise.all([
        ctx.db.get(target.productId as any),
        ctx.db.get(target.locationId as any),
        ctx.db.get(target.lotId as any),
        ctx.db.get(target.rowId as any),
        ctx.db.query("entryItems")
          .withIndex("by_entry", (q: any) => q.eq("entryId", entry._id))
          .collect(),
        ctx.db.query("stockMovements")
          .withIndex("by_product", (q: any) => q.eq("productId", target.productId))
          .collect(),
        ctx.db.query("stockMovementLots").collect(),
      ]);

    const itemCandidates = (entryItems as any[])
      .filter((item) => String(item.productId) === target.productId)
      .map((item) => ({
        id: String(item._id),
        productId: String(item.productId),
        lotId: item.lotId == null ? null : String(item.lotId),
        locationId: item.locationId == null ? null : String(item.locationId),
        areaId: item.areaId == null ? null : String(item.areaId),
        quantity: Number(item.quantity),
        brand: item.brand ?? null,
      }));

    const entryProductMovements = (productMovements as any[])
      .filter((movement) => String(movement.entryId ?? "") === String(entry._id));

    const movementDetails = entryProductMovements.map((movement) => {
      const movementId = String(movement._id);
      const links = (allMovementLinks as any[])
        .filter((link) => String(link.movementId) === movementId)
        .map((link) => ({
          id: String(link._id),
          lotId: link.lotId == null ? null : String(link.lotId),
          locationId: link.locationId == null ? null : String(link.locationId),
          areaId: link.areaId == null ? null : String(link.areaId),
          quantity: Number(link.quantity),
        }));
      return {
        id: movementId,
        type: movement.type,
        quantity: Number(movement.quantity),
        previousPhysical: Number(movement.previousPhysical),
        newPhysical: Number(movement.newPhysical),
        previousReserved: Number(movement.previousReserved),
        newReserved: Number(movement.newReserved),
        entryId: movement.entryId == null ? null : String(movement.entryId),
        lotId: movement.lotId == null ? null : String(movement.lotId),
        locationId: movement.locationId == null ? null : String(movement.locationId),
        areaId: movement.areaId == null ? null : String(movement.areaId),
        canceled: movement.canceled ?? false,
        documentNumber: movement.documentNumber ?? null,
        observation: movement.observation ?? null,
        timestamp: movement.timestamp,
        timestampIso: Number.isFinite(movement.timestamp)
          ? new Date(movement.timestamp).toISOString()
          : null,
        links,
      };
    });

    return {
      readOnly: true,
      found: true,
      expected: target,
      entry: {
        id: String(entry._id),
        entryNumber: entry.entryNumber,
        status: entry.status,
        originType: entry.originType,
        areaId: entry.areaId == null ? null : String(entry.areaId),
      },
      product: product ? { id: String(product._id), name: product.name } : null,
      location: location ? { id: String(location._id), name: location.name, active: location.active } : null,
      lot: lot ? {
        id: String(lot._id),
        lotNumber: lot.lotNumber,
        productId: String(lot.productId),
        entryId: lot.entryId == null ? null : String(lot.entryId),
        quantityReceived: Number(lot.quantityReceived),
        quantityAvailable: Number(lot.quantityAvailable),
        locationId: lot.locationId == null ? null : String(lot.locationId),
        areaId: lot.areaId == null ? null : String(lot.areaId),
        brand: lot.brand ?? null,
        active: lot.active,
      } : null,
      stockByLocation: localRow ? {
        id: String(localRow._id),
        productId: String(localRow.productId),
        locationId: String(localRow.locationId),
        areaId: localRow.areaId == null ? null : String(localRow.areaId),
        quantity: Number(localRow.quantity),
      } : null,
      entryItemCandidates: itemCandidates,
      entryProductMovements: movementDetails,
      comparison: {
        movementCountForProductInEntry: movementDetails.length,
        expectedMovementType: "adjustment",
        expectedQuantity: target.quantity,
        expectedLocationId: target.locationId,
        movementChecks: movementDetails.map((movement) => ({
          movementId: movement.id,
          typeMatches: movement.type === "adjustment",
          quantityMatches: Number.isFinite(movement.quantity) &&
            Math.abs(movement.quantity - target.quantity) <= 1e-9,
          locationMatches: movement.locationId === target.locationId,
          entryMatches: movement.entryId === String(entry._id),
          lotMatches: movement.lotId === target.lotId,
          canceled: movement.canceled,
        })),
      },
    };
  },
});

/**
 * Diagnóstico read-only do livro derivado lote × localização.
 * Não tenta corrigir ou inferir locais para lotes legados sem vínculo explícito.
 */
export const lotLocationBalanceIntegrityDiagnostic = internalQuery({
  args: {},
  handler: async (ctx) => {
    const [lots, balances] = await Promise.all([
      ctx.db.query("lots").collect(),
      ctx.db.query("lotLocationBalances").collect(),
    ]);

    const result = inspectLotLocationBalances(
      lots.map((lot) => ({
        _id: String(lot._id),
        productId: String(lot.productId),
        lotNumber: lot.lotNumber,
        quantityAvailable: lot.quantityAvailable,
        locationId: lot.locationId == null ? null : String(lot.locationId),
        active: lot.active,
      })),
      balances.map((balance) => ({
        _id: String(balance._id),
        lotId: String(balance.lotId),
        productId: String(balance.productId),
        locationId: String(balance.locationId),
        quantityAvailable: balance.quantityAvailable,
      })),
    );

    return {
      readOnly: true,
      ...result,
      issueCount: result.issues.length,
      limitationCount: result.limitations.length,
      issues: result.issues.slice(0, 100),
      limitations: result.limitations.slice(0, 100),
      issuesTruncated: result.issues.length > 100,
      limitationsTruncated: result.limitations.length > 100,
    };
  },
});

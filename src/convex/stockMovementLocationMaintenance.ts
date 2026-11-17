/**
 * Manutenção interna e atômica para preencher locationId em movimentos históricos.
 *
 * Escopo deliberadamente restrito:
 * - somente movimentos entry/adjustment, não cancelados e sem locationId;
 * - correspondência documental única entre movimento, lote e item de entrada;
 * - quantidade do movimento igual à quantidade documental;
 * - exatamente uma posição atual do lote, coincidente com o local documental;
 * - nenhuma alocação histórica vinculada ao movimento;
 * - conjunto fixo de 61 IDs e 63 movimentos sem localização, revalidados
 *   integralmente antes da primeira gravação.
 *
 * Esta função não altera saldos, lotes, entradas, produtos ou outras propriedades
 * do movimento. Para cada locationId preenchido, cria um auditLog individual.
 */
import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

export const applyHistoricalLocationCorrectionsInternal = internalMutation({
  args: {
    expectedMovementIds: v.array(v.string()),
    confirmation: v.string(),
  },
  handler: async (ctx, args) => {
    const EXPECTED_COUNT = 61;
    const EXPECTED_UNLOCATED_COUNT = 63;
    const REQUIRED_CONFIRMATION = "APLICAR-61-CORRECOES-LOCALIZACAO";

    if (args.confirmation !== REQUIRED_CONFIRMATION) {
      throw new Error("Confirmação inválida. Nenhuma alteração foi aplicada.");
    }
    if (args.expectedMovementIds.length !== EXPECTED_COUNT) {
      throw new Error(
        `Esperados exatamente ${EXPECTED_COUNT} IDs aprovados; recebidos ${args.expectedMovementIds.length}. Abortado.`,
      );
    }

    const expectedIds = [...args.expectedMovementIds].sort();
    if (new Set(expectedIds).size !== EXPECTED_COUNT) {
      throw new Error("A lista contém IDs duplicados. Nenhuma alteração foi aplicada.");
    }

    const [
      movements,
      products,
      entries,
      entryItems,
      lots,
      locations,
      balances,
      allocationRows,
    ] = await Promise.all([
      ctx.db.query("stockMovements").collect(),
      ctx.db.query("products").collect(),
      ctx.db.query("entries").collect(),
      ctx.db.query("entryItems").collect(),
      ctx.db.query("lots").collect(),
      ctx.db.query("storageLocations").collect(),
      ctx.db.query("lotLocationBalances").collect(),
      // A tabela existe no deployment atual, mas ainda não faz parte do schema
      // versionado desta base. A leitura dinâmica evita ampliar o schema.
      (ctx.db as any).query("stockMovementLotAllocations").collect() as Promise<
        Array<{ movementId: string }>
      >,
    ]);

    const unlocatedMovements = movements.filter((movement) => !movement.locationId);
    if (unlocatedMovements.length !== EXPECTED_UNLOCATED_COUNT) {
      throw new Error(
        `Quantidade de movimentos sem local mudou: esperado ${EXPECTED_UNLOCATED_COUNT}, atual ${unlocatedMovements.length}. Nenhuma alteração foi aplicada.`,
      );
    }

    const byId = <T extends { _id: unknown }>(rows: T[]) =>
      new Map<string, T>(rows.map((row) => [String(row._id), row]));
    const productById = byId(products);
    const entryById = byId(entries);
    const locationById = byId(locations);
    const lotById = byId(lots);

    const lotsByNumber = new Map<string, typeof lots>();
    const itemsByEntry = new Map<string, typeof entryItems>();
    const balancesByLot = new Map<string, typeof balances>();
    const allocationsByMovement = new Map<string, Array<{ movementId: string }>>();

    for (const lot of lots) {
      const key = String(lot.lotNumber);
      lotsByNumber.set(key, [...(lotsByNumber.get(key) ?? []), lot]);
    }
    for (const item of entryItems) {
      const key = String(item.entryId);
      itemsByEntry.set(key, [...(itemsByEntry.get(key) ?? []), item]);
    }
    for (const balance of balances) {
      const key = String(balance.lotId);
      balancesByLot.set(key, [...(balancesByLot.get(key) ?? []), balance]);
    }
    for (const allocation of allocationRows) {
      const key = String(allocation.movementId);
      allocationsByMovement.set(key, [
        ...(allocationsByMovement.get(key) ?? []),
        allocation,
      ]);
    }

    const resolveLot = (reference?: string) => {
      if (!reference) return undefined;
      const direct = lotById.get(String(reference));
      if (direct) return direct;
      const matches = lotsByNumber.get(String(reference)) ?? [];
      return matches.length === 1 ? matches[0] : undefined;
    };

    const candidates: Array<{
      movement: (typeof movements)[number];
      locationId: (typeof locations)[number]["_id"];
      entryNumber: string | null;
      entryItemId: string;
      lotId: string;
      lotNumber: string;
    }> = [];

    for (const movement of unlocatedMovements) {
      if (movement.type !== "entry" && movement.type !== "adjustment") continue;
      if (movement.canceled) continue;

      const product = productById.get(String(movement.productId));
      const lot = resolveLot(movement.lotId);
      if (!product || !lot || String(lot.productId) !== String(movement.productId)) {
        continue;
      }

      const sourceEntryId = movement.entryId
        ? String(movement.entryId)
        : lot.entryId
          ? String(lot.entryId)
          : "";
      if (!sourceEntryId || !entryById.has(sourceEntryId)) continue;
      if (movement.entryId && String(movement.entryId) !== String(lot.entryId)) {
        continue;
      }

      const matchingItems = (itemsByEntry.get(sourceEntryId) ?? []).filter(
        (item) =>
          String(item.productId) === String(movement.productId) &&
          String(item.lotId) === String(lot._id),
      );
      if (matchingItems.length !== 1) continue;

      const item = matchingItems[0];
      if (!item.locationId || !locationById.has(String(item.locationId))) continue;
      if (Number(item.quantity) !== Number(movement.quantity)) continue;

      const lotBalances = balancesByLot.get(String(lot._id)) ?? [];
      const uniqueLocationIds = [
        ...new Set(lotBalances.map((balance) => String(balance.locationId))),
      ];
      if (uniqueLocationIds.length !== 1 || lotBalances.length !== 1) continue;
      if (uniqueLocationIds[0] !== String(item.locationId)) continue;
      if (!locationById.has(uniqueLocationIds[0])) continue;

      // Não inferir o local de um movimento que possua alocação histórica.
      if ((allocationsByMovement.get(String(movement._id)) ?? []).length > 0) {
        continue;
      }

      candidates.push({
        movement,
        locationId: item.locationId,
        entryNumber: entryById.get(sourceEntryId)?.entryNumber ?? null,
        entryItemId: String(item._id),
        lotId: String(lot._id),
        lotNumber: String(lot.lotNumber),
      });
    }

    const actualIds = candidates
      .map(({ movement }) => String(movement._id))
      .sort();

    if (
      candidates.length !== EXPECTED_COUNT ||
      actualIds.length !== expectedIds.length ||
      actualIds.some((id, index) => id !== expectedIds[index])
    ) {
      throw new Error(
        `Conjunto elegível mudou: esperado ${EXPECTED_COUNT}, atual ${candidates.length}. Nenhuma alteração foi aplicada. Gere novo dry-run e revise.`,
      );
    }

    // Todas as validações terminam antes do primeiro patch. Uma falha nesta
    // mutation aborta a transação Convex inteira, inclusive auditLogs.
    const correctedAt = Date.now();
    for (const candidate of candidates) {
      const movementId = String(candidate.movement._id);
      const location = locationById.get(String(candidate.locationId));
      if (!location) {
        throw new Error(
          `Localização deixou de existir para ${movementId}. Transação abortada.`,
        );
      }

      await ctx.db.patch(candidate.movement._id, {
        locationId: candidate.locationId,
      });

      await ctx.db.insert("auditLogs", {
        action: "update",
        entity: "stockMovement",
        entityId: movementId,
        details: JSON.stringify({
          operation: "historical_location_backfill",
          actor: "automated_maintenance_internal",
          actorUserId: null,
          correctedAt,
          before: { locationId: null },
          after: {
            locationId: String(candidate.locationId),
            locationName: location.name,
          },
          evidence: {
            entryNumber: candidate.entryNumber,
            entryItemId: candidate.entryItemId,
            lotId: candidate.lotId,
            lotNumber: candidate.lotNumber,
            quantity: candidate.movement.quantity,
            type: candidate.movement.type,
            timestamp: candidate.movement.timestamp,
            source:
              "entryItems.locationId + unique current lotLocationBalances location",
          },
        }),
        timestamp: correctedAt,
      });
    }

    const correctedByLocation = candidates.reduce(
      (counts, candidate) => {
        const name =
          locationById.get(String(candidate.locationId))?.name ?? "unknown";
        counts[name] = (counts[name] ?? 0) + 1;
        return counts;
      },
      {} as Record<string, number>,
    );

    return {
      applied: true,
      mode: "CONTROLLED_ATOMIC_CORRECTION",
      corrected: candidates.length,
      auditLogsCreated: candidates.length,
      movementsPatched: candidates.length,
      correctedMovementIds: actualIds,
      fieldsChanged: ["stockMovements.locationId"],
      otherMovementFieldsChanged: 0,
      actorAttribution:
        "automated_maintenance_internal; no authenticated user attribution",
      correctedByLocation,
      excludedTypes: ["exit", "return", "transfer"],
      excludedUnmatchedCount: EXPECTED_UNLOCATED_COUNT - candidates.length,
      note:
        "Transação atômica. Os 61 IDs e os 63 movimentos sem local foram revalidados antes do primeiro patch.",
    };
  },
});

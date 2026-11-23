/**
 * Classificação estritamente controlada de dois movimentos históricos de teste.
 * Preserva saída e devolução, associa o local confirmado pelo usuário e marca
 * os registros como teste. Não altera quantidades, saldos, lotes ou vínculos.
 */
import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

const APPROVED = [
  {
    id: "kx70n82skp2ph9wq5d75020wp58ez5ag",
    type: "return",
    timestamp: 1790163288506,
  },
  {
    id: "kx758yrsbatdw2yc4m09ytfapn8en7mn",
    type: "exit",
    timestamp: 1789761423585,
  },
] as const;

const REQUIRED_CONFIRMATION = "CLASSIFICAR-2-MOVIMENTOS-DE-TESTE";
const TEST_REASON =
  "Movimentação de teste: saída e devolução de um cooler para validação do sistema, confirmadas pelo responsável.";

export const classifyHistoricalTestMovementsInternal = internalMutation({
  args: {
    expectedMovementIds: v.array(v.string()),
    confirmation: v.string(),
  },
  handler: async (ctx, args) => {
    if (args.confirmation !== REQUIRED_CONFIRMATION) {
      throw new Error("Confirmação inválida. Nenhuma alteração aplicada.");
    }
    if (
      args.expectedMovementIds.length !== 2 ||
      new Set(args.expectedMovementIds).size !== 2 ||
      [...args.expectedMovementIds].sort().join("|") !==
        APPROVED.map((row) => row.id).sort().join("|")
    ) {
      throw new Error("A operação exige exatamente os dois IDs aprovados.");
    }

    const movements = await Promise.all(
      APPROVED.map(async (expected) => {
        const movement: any = await ctx.db.get(expected.id as any);
        if (!movement) throw new Error(`Movimento ausente: ${expected.id}`);
        if (movement.type !== expected.type) {
          throw new Error(`Tipo divergente no movimento ${expected.id}`);
        }
        if (movement.quantity !== 1) {
          throw new Error(`Quantidade divergente no movimento ${expected.id}`);
        }
        if (movement.timestamp !== expected.timestamp) {
          throw new Error(`Data/hora divergente no movimento ${expected.id}`);
        }
        if (movement.locationId || movement.isTest === true) {
          throw new Error(`Movimento já localizado ou classificado: ${expected.id}`);
        }
        if (movement.lotId !== "n179kw2gk7p08rw1qjh0tygzmm4k480k") {
          throw new Error(`Lote divergente no movimento ${expected.id}`);
        }
        const product: any = await ctx.db.get(movement.productId);
        if (!product?.name?.toLowerCase().includes("cooler")) {
          throw new Error(`Produto não corresponde ao cooler: ${expected.id}`);
        }
        const lot: any = await ctx.db.get(movement.lotId as any);
        if (!lot || String(lot._id) !== "n179kw2gk7p08rw1qjh0tygzmm4k480k") {
          throw new Error(`Lote não corresponde ao cooler: ${expected.id}`);
        }
        if (String(lot.productId) !== String(movement.productId)) {
          throw new Error(`Produto do lote diverge: ${expected.id}`);
        }
        if (movement.entryId && String(movement.entryId) !== String(lot.entryId)) {
          throw new Error(`Entrada vinculada diverge do lote: ${expected.id}`);
        }
        const entry: any = lot.entryId ? await ctx.db.get(lot.entryId) : null;
        if (entry?.entryNumber !== "ENT-2026-000001") {
          throw new Error(`Entrada documental não é ENT-2026-000001: ${expected.id}`);
        }
        return { expected, movement, lot };
      }),
    );

    const locations = await ctx.db.query("storageLocations").collect();
    const location = locations.find((row) => row.name === "Armário TI 01");
    if (!location) throw new Error("Armário TI 01 não encontrado.");
    const balances = await ctx.db.query("lotLocationBalances").collect();
    for (const { movement, lot } of movements) {
      const lotBalances = balances.filter((row) => String(row.lotId) === String(lot._id));
      if (
        lotBalances.length !== 1 ||
        String(lotBalances[0].locationId) !== String(location._id)
      ) {
        throw new Error(
          `A posição atual do lote não confirma Armário TI 01 para ${String(movement._id)}.`,
        );
      }
    }

    const now = Date.now();
    for (const { expected, movement } of movements) {
      await (ctx.db as any).patch(movement._id, {
        locationId: location._id,
        isTest: true,
        testReason: TEST_REASON,
      });
      await ctx.db.insert("auditLogs", {
        action: "update",
        entity: "stockMovement",
        entityId: String(movement._id),
        details: JSON.stringify({
          operation: "historical_test_movement_classification",
          actor: "automated_maintenance_internal",
          actorUserId: null,
          source: "explicit_user_confirmation",
          confirmedAt: now,
          movementType: expected.type,
          before: { locationId: null, isTest: false },
          after: {
            locationId: String(location._id),
            locationName: location.name,
            isTest: true,
            testReason: TEST_REASON,
          },
          preserved: [
            "quantity",
            "physical balances",
            "reserved balances",
            "lot",
            "entry",
            "original timestamp",
            "movement history",
          ],
        }),
        timestamp: now,
      });
    }

    return {
      applied: true,
      classified: movements.length,
      movementIds: movements.map(({ movement }) => String(movement._id)).sort(),
      location: location.name,
      auditLogsCreated: movements.length,
      quantitiesChanged: 0,
      balancesChanged: 0,
      recordsDeleted: 0,
    };
  },
});

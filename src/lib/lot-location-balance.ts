/**
 * Mantém o saldo derivado lote × armário sincronizado com o lote.
 *
 * A área continua sendo propriedade do lote (lots.areaId); a tabela de saldo
 * guarda apenas lote/produto/local físico, evitando duplicar a classificação.
 */
export type LotLocationBalanceRow = {
  lotId: string;
  productId: string;
  locationId: string;
  quantityAvailable: number;
};

export type LotLocationBalancePlan =
  | { kind: "skip" }
  | { kind: "insert"; quantityAvailable: number }
  | { kind: "patch"; rowId: string; quantityAvailable: number };

export function planLotLocationBalanceChange(input: {
  rows: Array<LotLocationBalanceRow & { _id: string }>;
  lotId: string;
  productId: string;
  locationId?: string | null;
  delta: number;
  allowCreate?: boolean;
}): LotLocationBalancePlan {
  const { rows, lotId, productId, locationId, delta } = input;
  if (!locationId || delta === 0) return { kind: "skip" };
  if (!Number.isFinite(delta)) throw new Error("A variação do saldo lote × armário deve ser finita.");

  const matching = rows.filter((row) => String(row.lotId) === lotId);
  if (matching.length > 1) {
    throw new Error("Há saldos lote × armário duplicados para este lote. Operação bloqueada.");
  }
  const current = matching[0];
  if (!current) {
    if (delta < 0) {
      throw new Error("O lote possui localização, mas não tem saldo lote × armário correspondente. Operação bloqueada.");
    }
    if (!input.allowCreate) {
      throw new Error("O saldo lote × armário não existe; não é seguro recriá-lo implicitamente.");
    }
    return { kind: "insert", quantityAvailable: delta };
  }

  if (String(current.productId) !== productId || String(current.locationId) !== locationId) {
    throw new Error("O saldo lote × armário não corresponde ao produto/localização do lote.");
  }
  if (!Number.isFinite(current.quantityAvailable) || current.quantityAvailable < 0) {
    throw new Error("O saldo lote × armário atual é inválido.");
  }
  const next = current.quantityAvailable + delta;
  if (!Number.isFinite(next) || next < -1e-9) {
    throw new Error("A operação deixaria o saldo do lote × armário negativo ou inválido.");
  }
  return { kind: "patch", rowId: current._id, quantityAvailable: Math.max(0, next) };
}

/** Aplica a variação dentro da mesma mutation Convex da movimentação de estoque. */
export async function adjustLotLocationBalance(
  ctx: any,
  input: {
    lotId: any;
    productId: any;
    locationId?: any;
    delta: number;
    allowCreate?: boolean;
  },
): Promise<void> {
  if (!input.locationId || input.delta === 0) return;
  const rows = await ctx.db
    .query("lotLocationBalances")
    .withIndex("by_lot", (q: any) => q.eq("lotId", input.lotId))
    .collect();
  const plan = planLotLocationBalanceChange({
    rows: rows as Array<LotLocationBalanceRow & { _id: string }>,
    lotId: String(input.lotId),
    productId: String(input.productId),
    locationId: String(input.locationId),
    delta: input.delta,
    allowCreate: input.allowCreate,
  });
  if (plan.kind === "insert") {
    await ctx.db.insert("lotLocationBalances", {
      lotId: input.lotId,
      productId: input.productId,
      locationId: input.locationId,
      quantityAvailable: plan.quantityAvailable,
      updatedAt: Date.now(),
    });
  } else if (plan.kind === "patch") {
    await ctx.db.patch(plan.rowId as any, {
      quantityAvailable: plan.quantityAvailable,
      updatedAt: Date.now(),
    });
  }
}

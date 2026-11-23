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
  if (!Number.isFinite(delta)) throw new Error("A variação do saldo lote × armário deve ser finita.");
  if (delta === 0 || !locationId) return { kind: "skip" };

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
  if (!Number.isFinite(input.delta)) throw new Error("A variação do saldo lote × armário deve ser finita.");
  if (input.delta === 0) return;
  const rows = await ctx.db
    .query("lotLocationBalances")
    .withIndex("by_lot", (q: any) => q.eq("lotId", input.lotId))
    .collect();
  if (rows.length > 1) {
    throw new Error("Há saldos lote × armário duplicados para este lote. Operação bloqueada.");
  }
  // Lotes legados podem ainda não ter locationId no documento, embora já
  // possuam o vínculo conciliado na tabela nova. Nesse caso, usa-se o vínculo.
  const locationId = input.locationId ?? rows[0]?.locationId;
  if (!locationId) return;
  const plan = planLotLocationBalanceChange({
    rows: rows as Array<LotLocationBalanceRow & { _id: string }>,
    lotId: String(input.lotId),
    productId: String(input.productId),
    locationId: String(locationId),
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


export type LotLocationBalanceLocationPlan =
  | { kind: "insert"; quantityAvailable: number; locationId: string }
  | { kind: "patch"; rowId: string; quantityAvailable: number; locationId: string };

export function planLotLocationBalanceLocationChange(input: {
  rows: Array<LotLocationBalanceRow & { _id: string }>;
  lotId: string;
  productId: string;
  locationId: string;
  quantityAvailable: number;
  allowCreate?: boolean;
}): LotLocationBalanceLocationPlan {
  if (!Number.isFinite(input.quantityAvailable) || input.quantityAvailable < 0) {
    throw new Error("A quantidade do lote para classificar o armário é inválida.");
  }
  const matching = input.rows.filter((row) => String(row.lotId) === input.lotId);
  if (matching.length > 1) {
    throw new Error("Há saldos lote × armário duplicados para este lote. Classificação bloqueada.");
  }
  const current = matching[0];
  if (!current) {
    if (!input.allowCreate) {
      throw new Error("O saldo lote × armário não existe; classificação bloqueada.");
    }
    return {
      kind: "insert",
      quantityAvailable: input.quantityAvailable,
      locationId: input.locationId,
    };
  }
  if (String(current.productId) !== input.productId ||
      !Number.isFinite(current.quantityAvailable) ||
      Math.abs(current.quantityAvailable - input.quantityAvailable) > 1e-9) {
    throw new Error("O saldo lote × armário diverge do produto ou da quantidade do lote.");
  }
  return {
    kind: "patch",
    rowId: current._id,
    quantityAvailable: input.quantityAvailable,
    locationId: input.locationId,
  };
}

export async function setLotLocationBalanceLocation(
  ctx: any,
  input: {
    lotId: any;
    productId: any;
    locationId: any;
    quantityAvailable: number;
    allowCreate?: boolean;
  },
): Promise<void> {
  const rows = await ctx.db
    .query("lotLocationBalances")
    .withIndex("by_lot", (q: any) => q.eq("lotId", input.lotId))
    .collect();
  const plan = planLotLocationBalanceLocationChange({
    rows: rows as Array<LotLocationBalanceRow & { _id: string }>,
    lotId: String(input.lotId),
    productId: String(input.productId),
    locationId: String(input.locationId),
    quantityAvailable: input.quantityAvailable,
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
  } else {
    await ctx.db.patch(plan.rowId as any, {
      locationId: input.locationId,
      quantityAvailable: plan.quantityAvailable,
      updatedAt: Date.now(),
    });
  }
}

export type LotLocationIntegrityLot = {
  _id: string;
  productId: string;
  quantityAvailable: number;
  locationId?: string | null;
  lotNumber?: string;
  active?: boolean;
};

export type LotLocationIntegrityRow = LotLocationBalanceRow & {
  _id: string;
};

export type LotLocationBalanceIntegrity = {
  consistent: boolean;
  fullyReconciled: boolean;
  checkedLots: number;
  checkedRows: number;
  matchedLots: number;
  issues: string[];
  limitations: string[];
};

/**
 * Concilia o saldo atual de cada lote com seu vínculo derivado lote × local.
 * Não infere localização: um lote positivo sem locationId e sem vínculo
 * explícito permanece como limitação a ser regularizada.
 */
export function inspectLotLocationBalances(
  lots: readonly LotLocationIntegrityLot[],
  rows: readonly LotLocationIntegrityRow[],
): LotLocationBalanceIntegrity {
  const issues: string[] = [];
  const limitations: string[] = [];
  const lotsById = new Map<string, LotLocationIntegrityLot>();
  for (const lot of lots) {
    lotsById.set(String(lot._id), lot);
  }

  const rowsByLot = new Map<string, LotLocationIntegrityRow[]>();
  for (const row of rows) {
    const lotId = String(row.lotId);
    const group = rowsByLot.get(lotId) ?? [];
    group.push(row);
    rowsByLot.set(lotId, group);

    if (!Number.isFinite(row.quantityAvailable) || row.quantityAvailable < 0) {
      issues.push(`O saldo lote × local do registro ${row._id} é inválido.`);
    }
    if (!row.locationId) {
      issues.push(`O saldo lote × local do registro ${row._id} não possui localização.`);
    }
    if (!lotsById.has(lotId)) {
      issues.push(`O vínculo lote × local ${row._id} aponta para lote inexistente (${lotId}).`);
    }
  }

  let matchedLots = 0;
  for (const lot of lots) {
    const lotId = String(lot._id);
    const lotNumber = lot.lotNumber ?? lotId;
    const quantity = lot.quantityAvailable;
    const matchingRows = rowsByLot.get(lotId) ?? [];

    if (!Number.isFinite(quantity) || quantity < 0) {
      issues.push(`O lote ${lotNumber} possui saldo inválido.`);
      continue;
    }
    if (lot.active === false && quantity > 1e-9) {
      issues.push(`O lote ${lotNumber} está inativo com saldo positivo.`);
    }
    if (matchingRows.length > 1) {
      issues.push(`O lote ${lotNumber} possui vínculos lote × local duplicados.`);
      continue;
    }

    const balance = matchingRows[0];
    if (!balance) {
      if (quantity > 1e-9) {
        if (lot.locationId) {
          issues.push(`O lote ${lotNumber} possui saldo positivo, mas não possui vínculo lote × local.`);
        } else {
          limitations.push(`O lote ${lotNumber} possui saldo positivo sem localização atual explícita nem vínculo lote × local.`);
        }
      }
      continue;
    }

    if (String(balance.productId) !== String(lot.productId)) {
      issues.push(`O vínculo lote × local do lote ${lotNumber} aponta para outro produto.`);
    }
    if (lot.locationId && String(balance.locationId) !== String(lot.locationId)) {
      issues.push(`A localização do vínculo lote × local diverge da localização registrada no lote ${lotNumber}.`);
    }
    if (
      Number.isFinite(balance.quantityAvailable) &&
      Math.abs(balance.quantityAvailable - quantity) > 1e-9
    ) {
      issues.push(`O saldo lote × local diverge do saldo atual do lote ${lotNumber}.`);
    }
    matchedLots += 1;
  }

  const uniqueIssues = [...new Set(issues)];
  const uniqueLimitations = [...new Set(limitations)];
  return {
    consistent: uniqueIssues.length === 0,
    fullyReconciled: uniqueIssues.length === 0 && uniqueLimitations.length === 0 &&
      matchedLots === lots.filter((lot) => Number.isFinite(lot.quantityAvailable) && lot.quantityAvailable > 1e-9).length,
    checkedLots: lots.length,
    checkedRows: rows.length,
    matchedLots,
    issues: uniqueIssues,
    limitations: uniqueLimitations,
  };
}

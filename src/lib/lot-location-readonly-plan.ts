/**
 * Pure planner for read-only legacy lot × cabinet reconciliation.
 * Never writes to Convex. A candidate must be supported by a read-only audit
 * and the resulting plan is still a proposal, not an instruction to mutate.
 */
export type LotLocationReadinessReport = {
  readOnly: true;
  migrationApplied: false;
  products: Array<{
    productId: string;
    productName: string;
    globalPhysical: number;
    globalReserved: number;
    globalError: string | null;
    localPhysicalTotal: number;
    lotsAvailableTotal: number;
    candidateTotalsAlign: boolean;
    invalidLotCount: number;
    invalidBalanceCount: number;
    duplicateBalanceScopeCount: number;
    orphanBalanceCount: number;
    localComparison: Array<{
      locationId: string;
      physicalQuantity: number;
      mappedLotQuantity: number;
      candidateLotQuantity: number;
      duplicatePhysicalRows: number;
    }>;
    lots: Array<{
      lotId: string;
      lotNumber: string;
      quantityAvailable: number;
      status: "mapped" | "candidate" | "divergent" | "ambiguous" | "unmapped";
      candidateLocationId: string | null;
      mappedLocations: Array<{ locationId: string; quantity: number }>;
    }>;
  }>;
  locations: Array<{ locationId: string; name: string; active: boolean }>;
};

export type ProposedLotLocationRow = {
  lotId: string;
  productId: string;
  locationId: string;
  quantityAvailable: number;
  lotNumber: string;
};

export type ReadonlyMigrationPlan = {
  insertions: ProposedLotLocationRow[];
  alreadyMapped: number;
  totalLotsToTrace: number;
  totalQuantityToTrace: number;
  blockedProducts: Array<{ productId: string; productName: string; reasons: string[] }>;
  safeToApply: false;
};

const EPSILON = 1e-9;

export function buildReadonlyLotLocationPlan(
  report: LotLocationReadinessReport,
): ReadonlyMigrationPlan {
  if (report?.readOnly !== true || report?.migrationApplied !== false) {
    throw new Error("Plano recusado: origem deve ser diagnóstico somente leitura e sem migração aplicada.");
  }
  const activeLocationIds = new Set(
    report.locations.filter((location) => location.active).map((location) => location.locationId),
  );
  const insertions: ProposedLotLocationRow[] = [];
  const blockedProducts: ReadonlyMigrationPlan["blockedProducts"] = [];
  let alreadyMapped = 0;
  let totalLotsToTrace = 0;
  let totalQuantityToTrace = 0;

  for (const product of report.products) {
    const reasons: string[] = [];
    if (product.globalError) reasons.push(product.globalError);
    if (product.invalidLotCount !== 0) reasons.push("lote(s) inválido(s)");
    if (product.invalidBalanceCount !== 0) reasons.push("saldo lote/armário inválido");
    if (product.duplicateBalanceScopeCount !== 0) reasons.push("escopo lote/armário duplicado");
    if (product.orphanBalanceCount !== 0) reasons.push("saldo lote/armário órfão");
    if (!product.candidateTotalsAlign) reasons.push("totais candidatos não reconciliam");
    if (Math.abs(product.globalPhysical - product.localPhysicalTotal) > EPSILON) reasons.push("saldo global diverge dos armários");
    if (Math.abs(product.globalPhysical - product.lotsAvailableTotal) > EPSILON) reasons.push("saldo global diverge dos lotes disponíveis");
    if (product.globalReserved < 0 || product.globalReserved > product.globalPhysical) reasons.push("reserva global inválida");
    for (const local of product.localComparison) {
      if (local.duplicatePhysicalRows !== 0) reasons.push(`saldo físico duplicado no armário ${local.locationId}`);
      if (Math.abs(local.physicalQuantity - local.mappedLotQuantity - local.candidateLotQuantity) > EPSILON) {
        reasons.push(`saldo não conciliado no armário ${local.locationId}`);
      }
    }

    const productInsertions: ProposedLotLocationRow[] = [];
    let productMapped = 0;
    let productLotCount = 0;
    let productQuantity = 0;
    const seenLotIds = new Set<string>();
    for (const lot of product.lots) {
      if (!Number.isFinite(lot.quantityAvailable) || lot.quantityAvailable < 0) {
        reasons.push(`quantidade inválida no lote ${lot.lotNumber}`);
        continue;
      }
      // Zero-balance lots need no artificial location rows.
      if (lot.quantityAvailable <= EPSILON) continue;
      productLotCount += 1;
      productQuantity += lot.quantityAvailable;
      if (seenLotIds.has(lot.lotId)) reasons.push(`lote duplicado no diagnóstico: ${lot.lotNumber}`);
      seenLotIds.add(lot.lotId);
      if (lot.status === "candidate") {
        if (!lot.candidateLocationId) {
          reasons.push(`lote ${lot.lotNumber} sem local candidato`);
        } else if (!activeLocationIds.has(lot.candidateLocationId)) {
          reasons.push(`lote ${lot.lotNumber} candidato a local inexistente/inativo`);
        } else {
          productInsertions.push({
            lotId: lot.lotId,
            productId: product.productId,
            locationId: lot.candidateLocationId,
            quantityAvailable: lot.quantityAvailable,
            lotNumber: lot.lotNumber,
          });
        }
      } else if (lot.status === "mapped") {
        if (lot.mappedLocations.length === 0) {
          reasons.push(`lote ${lot.lotNumber} sem vínculo persistido`);
        } else {
          const mappedTotal = lot.mappedLocations.reduce((sum, mapped) => sum + mapped.quantity, 0);
          if (lot.mappedLocations.some((mapped) => !activeLocationIds.has(mapped.locationId))) {
            reasons.push(`lote ${lot.lotNumber} mapeado a local inexistente/inativo`);
          }
          if (lot.mappedLocations.some((mapped) => !Number.isFinite(mapped.quantity) || mapped.quantity < 0)) {
            reasons.push(`lote ${lot.lotNumber} com saldo mapeado inválido`);
          }
          if (Math.abs(mappedTotal - lot.quantityAvailable) > EPSILON) {
            reasons.push(`lote ${lot.lotNumber} com saldo mapeado divergente`);
          } else {
            productMapped += lot.quantityAvailable;
          }
        }
      } else {
        reasons.push(`lote ${lot.lotNumber} está ${lot.status} e requer conferência`);
      }
    }

    if (Math.abs(productQuantity - product.globalPhysical) > EPSILON) reasons.push("total dos lotes positivos difere do saldo global");
    if (Math.abs(productMapped + productInsertions.reduce((sum, row) => sum + row.quantityAvailable, 0) - productQuantity) > EPSILON) {
      reasons.push("proposta lote/armário não cobre o saldo completo");
    }

    if (reasons.length) {
      blockedProducts.push({ productId: product.productId, productName: product.productName, reasons: [...new Set(reasons)] });
    } else {
      insertions.push(...productInsertions);
      alreadyMapped += productMapped > EPSILON
        ? product.lots.filter((lot) => lot.status === "mapped" && lot.quantityAvailable > EPSILON).length
        : 0;
      totalLotsToTrace += productLotCount;
      totalQuantityToTrace += productQuantity;
    }
  }

  return {
    insertions,
    alreadyMapped,
    totalLotsToTrace,
    totalQuantityToTrace,
    blockedProducts,
    safeToApply: false,
  };
}


/**
 * A historical exit may still support the original cabinet only when the
 * complete movement chain proves an unused, full return to that same cabinet.
 * Any extra movement, partial return, transfer, cancellation, lot mismatch,
 * or location mismatch keeps the lot out of automatic candidate classification.
 */
export function isClosedUnusedReturnAtSource(input: {
  lotId: string;
  sourceLocationId: string;
  movements: Array<{
    id: string;
    type: string;
    lotId?: string | null;
    quantity: number;
    exitMovementId?: string | null;
    locationId?: string | null;
    canceled?: boolean;
  }>;
  returns: Array<{
    lotId?: string | null;
    exitMovementId?: string | null;
    quantity: number;
    locationId?: string | null;
    condition?: string | null;
  }>;
}): boolean {
  if (!input.lotId || !input.sourceLocationId) return false;
  if (input.movements.length !== 2 || input.returns.length !== 1) return false;

  const exit = input.movements.find((movement) => movement.type === "exit");
  const returnedMovement = input.movements.find((movement) => movement.type === "return");
  const returnRecord = input.returns[0];
  if (!exit || !returnedMovement || exit.id === returnedMovement.id) return false;
  if (exit.canceled === true || returnedMovement.canceled === true) return false;

  const validQuantity = Number.isFinite(exit.quantity) && exit.quantity > 0 &&
    Number.isFinite(returnedMovement.quantity) &&
    Number.isFinite(returnRecord.quantity) &&
    Math.abs(returnedMovement.quantity - exit.quantity) <= EPSILON &&
    Math.abs(returnRecord.quantity - exit.quantity) <= EPSILON;

  return (
    validQuantity &&
    exit.lotId === input.lotId &&
    returnedMovement.lotId === input.lotId &&
    returnedMovement.exitMovementId === exit.id &&
    returnRecord.exitMovementId === exit.id &&
    (returnRecord.lotId == null || returnRecord.lotId === input.lotId) &&
    returnRecord.condition === "unused" &&
    returnRecord.locationId === input.sourceLocationId &&
    (exit.locationId == null || exit.locationId === input.sourceLocationId) &&
    (returnedMovement.locationId == null || returnedMovement.locationId === input.sourceLocationId)
  );
}

// Executado por `convex run --inline-query`.
// A consulta inline do Convex é isolada em modo somente leitura.
// Não importar mutations nem chamar APIs externas.

const [movements, products, users, entries, entryItems, lots, locations, lotLocationBalances] =
  await Promise.all([
    ctx.db.query("stockMovements").collect(),
    ctx.db.query("products").collect(),
    ctx.db.query("users").collect(),
    ctx.db.query("entries").collect(),
    ctx.db.query("entryItems").collect(),
    ctx.db.query("lots").collect(),
    ctx.db.query("storageLocations").collect(),
    ctx.db.query("lotLocationBalances").collect(),
  ]);

let allocations = [];
let allocationsAvailable = true;
try {
  allocations = await ctx.db.query("stockMovementLotAllocations").collect();
} catch (_error) {
  allocationsAvailable = false;
}

const historicalBackfillAuditLogs = await ctx.db
  .query("auditLogs")
  .withIndex("by_entity", (q) => q.eq("entity", "stockMovement"))
  .collect();
const historicalBackfillAudit = historicalBackfillAuditLogs
  .filter((row) => {
    try {
      return JSON.parse(row.details ?? "{}").operation === "historical_location_backfill";
    } catch {
      return false;
    }
  })
  .map((row) => {
    let details = {};
    try {
      details = JSON.parse(row.details ?? "{}");
    } catch {
      details = {};
    }
    const movement = movements.find(
      (candidate) => String(candidate._id) === String(row.entityId),
    );
    const afterLocationId = details.after?.locationId ?? null;
    const currentLocationId = movement?.locationId
      ? String(movement.locationId)
      : null;
    return {
      movementId: String(row.entityId ?? ""),
      timestamp: row.timestamp,
      actor: details.actor ?? null,
      userIdPresent: Boolean(row.userId),
      afterLocationId,
      afterLocationName: details.after?.locationName ?? null,
      currentLocationId,
      movementLocationMatchesAudit: Boolean(
        afterLocationId && currentLocationId === afterLocationId,
      ),
    };
  })
  .sort((a, b) => a.movementId.localeCompare(b.movementId));
const historicalBackfillByLocation = historicalBackfillAudit.reduce(
  (counts, row) => {
    const name = row.afterLocationName ?? "unknown";
    counts[name] = (counts[name] ?? 0) + 1;
    return counts;
  },
  {},
);
const historicalBackfillMismatches = historicalBackfillAudit.filter(
  (row) => !row.movementLocationMatchesAudit,
);

const productById = new Map(products.map((row) => [String(row._id), row]));
const userById = new Map(users.map((row) => [String(row._id), row]));
const entryById = new Map(entries.map((row) => [String(row._id), row]));
const locationById = new Map(locations.map((row) => [String(row._id), row]));
const lotById = new Map(lots.map((row) => [String(row._id), row]));
const lotsByNumber = new Map();
for (const lot of lots) {
  const list = lotsByNumber.get(lot.lotNumber) ?? [];
  list.push(lot);
  lotsByNumber.set(lot.lotNumber, list);
}
const entryItemsByEntry = new Map();
for (const item of entryItems) {
  const key = String(item.entryId);
  const list = entryItemsByEntry.get(key) ?? [];
  list.push(item);
  entryItemsByEntry.set(key, list);
}
const allocationsByMovement = new Map();
for (const allocation of allocations) {
  const key = String(allocation.movementId);
  const list = allocationsByMovement.get(key) ?? [];
  list.push(allocation);
  allocationsByMovement.set(key, list);
}
const movementById = new Map(movements.map((row) => [String(row._id), row]));

const resolveLot = (reference) => {
  if (!reference) return { lot: undefined, ambiguous: false };
  const byId = lotById.get(String(reference));
  if (byId) return { lot: byId, ambiguous: false };
  const candidates = lotsByNumber.get(String(reference)) ?? [];
  return {
    lot: candidates.length === 1 ? candidates[0] : undefined,
    ambiguous: candidates.length > 1,
  };
};

const summarizeMovement = (movement) => {
  const product = productById.get(String(movement.productId));
  const user = userById.get(String(movement.userId));
  const entry = movement.entryId ? entryById.get(String(movement.entryId)) : undefined;
  const lotResolution = resolveLot(movement.lotId);
  const lot = lotResolution.lot;
  const evidenceEntryIds = [...new Set(
    [movement.entryId, lot?.entryId].filter(Boolean).map((id) => String(id))
  )];
  const entryItemLocationEvidence = evidenceEntryIds.flatMap((entryId) =>
    (entryItemsByEntry.get(entryId) ?? [])
      .filter((item) =>
        item.productId === movement.productId &&
        (!movement.lotId || item.lotId === movement.lotId || item.lotId === String(lot?._id ?? ""))
      )
      .filter((item) => item.locationId)
      .map((item) => {
        const locationId = String(item.locationId);
        const location = locationById.get(locationId);
        return {
          entryId,
          entryNumber: entryById.get(entryId)?.entryNumber ?? null,
          entryItemId: String(item._id),
          lotReference: item.lotId ?? null,
          locationId,
          locationName: location?.name ?? null,
          locationReferenceValid: Boolean(location),
        };
      })
  );
  const allocationRows = allocationsByMovement.get(String(movement._id)) ?? [];
  const allocationLocationEvidence = allocationRows.map((allocation) => {
    const location = locationById.get(String(allocation.locationId));
    return {
      lotId: String(allocation.lotId),
      locationId: String(allocation.locationId),
      locationName: location?.name ?? null,
      quantity: allocation.quantity,
      allocationType: allocation.allocationType,
      locationReferenceValid: Boolean(location),
    };
  });
  const currentLotLocationSnapshot = lot
    ? lotLocationBalances
        .filter((balance) => balance.lotId === lot._id)
        .map((balance) => {
          const location = locationById.get(String(balance.locationId));
          return {
            locationId: String(balance.locationId),
            locationName: location?.name ?? null,
            quantityAvailableNow: balance.quantityAvailable,
            locationReferenceValid: Boolean(location),
          };
        })
    : [];

  return {
    movementId: String(movement._id),
    timestamp: movement.timestamp,
    type: movement.type,
    quantity: movement.quantity,
    canceled: movement.canceled ?? false,
    productId: String(movement.productId),
    productName: product?.name ?? null,
    productExists: Boolean(product),
    userId: String(movement.userId),
    userExists: Boolean(user),
    entryId: movement.entryId ? String(movement.entryId) : null,
    entryNumber: entry?.entryNumber ?? null,
    entryReferenceValid: movement.entryId ? Boolean(entry) : null,
    lotEntryId: lot?.entryId ? String(lot.entryId) : null,
    lotEntryNumber: lot ? entryById.get(String(lot.entryId))?.entryNumber ?? null : null,
    entryLotMismatch: Boolean(lot && movement.entryId && lot.entryId !== movement.entryId),
    lotReference: movement.lotId ?? null,
    lotResolution: !movement.lotId
      ? "not_provided"
      : lotResolution.ambiguous
        ? "ambiguous_requires_review"
        : lot
          ? "resolved"
          : "unresolved",
    resolvedLotId: lot ? String(lot._id) : null,
    lotNumber: lot?.lotNumber ?? null,
    lotProductMatchesMovement: lot ? lot.productId === movement.productId : null,
    lotAreaId: lot?.areaId ? String(lot.areaId) : null,
    recordedLocationId: movement.locationId ? String(movement.locationId) : null,
    recordedLocationName: movement.locationId
      ? locationById.get(String(movement.locationId))?.name ?? null
      : null,
    recordedLocationReferenceValid: movement.locationId
      ? locationById.has(String(movement.locationId))
      : null,
    entryItemLocationEvidence,
    allocationLocationEvidence,
    allocationQuantityTotal: allocationRows.reduce((sum, row) => sum + row.quantity, 0),
    allocationQuantityMatchesMovement: allocationRows.length > 0
      ? Math.abs(allocationRows.reduce((sum, row) => sum + row.quantity, 0) - movement.quantity) < 0.000001
      : null,
    currentLotLocationSnapshot,
  };
};

const missingLocation = movements.filter((row) => !row.locationId);
const invalidLocation = movements.filter((row) =>
  row.locationId && !locationById.has(String(row.locationId))
);
const unresolvedLot = movements.filter((row) =>
  row.lotId && !resolveLot(row.lotId).lot && !resolveLot(row.lotId).ambiguous
);
const ambiguousLot = movements.filter((row) =>
  row.lotId && resolveLot(row.lotId).ambiguous
);
const productLotMismatch = movements.filter((row) => {
  const lot = resolveLot(row.lotId).lot;
  return Boolean(lot && lot.productId !== row.productId);
});
const entryLotMismatch = movements.filter((row) => {
  const lot = resolveLot(row.lotId).lot;
  return Boolean(lot && row.entryId && lot.entryId !== row.entryId);
});
const missingUser = movements.filter((row) => !userById.has(String(row.userId)));
const missingProduct = movements.filter((row) => !productById.has(String(row.productId)));
const invalidEntry = movements.filter((row) => row.entryId && !entryById.has(String(row.entryId)));
const allocationQuantityMismatch = movements.filter((movement) => {
  const rows = allocationsByMovement.get(String(movement._id)) ?? [];
  return rows.length > 0 &&
    Math.abs(rows.reduce((sum, row) => sum + row.quantity, 0) - movement.quantity) >= 0.000001;
});
const invalidAllocationReferences = allocations.filter((allocation) => {
  const movement = movementById.get(String(allocation.movementId));
  const product = productById.get(String(allocation.productId));
  const lot = lotById.get(String(allocation.lotId));
  const location = locationById.get(String(allocation.locationId));
  return !movement || !product || !lot || !location ||
    lot.productId !== allocation.productId ||
    movement.productId !== allocation.productId;
}).map((allocation) => {
  const movement = movementById.get(String(allocation.movementId));
  const product = productById.get(String(allocation.productId));
  const lot = lotById.get(String(allocation.lotId));
  const location = locationById.get(String(allocation.locationId));
  return {
    allocationId: String(allocation._id),
    movementId: String(allocation.movementId),
    movementExists: Boolean(movement),
    productId: String(allocation.productId),
    productExists: Boolean(product),
    lotId: String(allocation.lotId),
    lotExists: Boolean(lot),
    lotProductMatchesAllocation: lot ? lot.productId === allocation.productId : null,
    movementProductMatchesAllocation: movement ? movement.productId === allocation.productId : null,
    locationId: String(allocation.locationId),
    locationExists: Boolean(location),
    quantity: allocation.quantity,
  };
});

const missingLocationByType = {};
for (const movement of missingLocation) {
  const key = movement.type ?? "unknown";
  missingLocationByType[key] = (missingLocationByType[key] ?? 0) + 1;
}

return {
  generatedAt: Date.now(),
  readOnly: true,
  deploymentRequested: "first-herring-264",
  totals: {
    movements: movements.length,
    withRecordedLocation: movements.length - missingLocation.length - invalidLocation.length,
    missingLocation: missingLocation.length,
    invalidLocationReference: invalidLocation.length,
    unresolvedLotReference: unresolvedLot.length,
    ambiguousLotReference: ambiguousLot.length,
    productLotMismatch: productLotMismatch.length,
    entryLotMismatch: entryLotMismatch.length,
    missingUserReference: missingUser.length,
    missingProductReference: missingProduct.length,
    invalidEntryReference: invalidEntry.length,
    allocationTableAvailable: allocationsAvailable,
    allocationRows: allocations.length,
    invalidAllocationReferences: invalidAllocationReferences.length,
    allocationQuantityMismatch: allocationQuantityMismatch.length,
  },
  missingLocationByType,
  historicalBackfillAudit: { count: historicalBackfillAudit.length, rows: historicalBackfillAudit },
  historicalBackfillByLocation,
  historicalBackfillLocationMismatches: historicalBackfillMismatches.length,
  missingLocationMovements: missingLocation
    .sort((a, b) => b.timestamp - a.timestamp)
    .map(summarizeMovement),
  invalidLocationMovements: invalidLocation.map(summarizeMovement),
  unresolvedLotMovements: unresolvedLot.map(summarizeMovement),
  ambiguousLotMovements: ambiguousLot.map(summarizeMovement),
  productLotMismatchMovements: productLotMismatch.map(summarizeMovement),
  entryLotMismatchMovements: entryLotMismatch.map(summarizeMovement),
  missingUserMovements: missingUser.map(summarizeMovement),
  missingProductMovements: missingProduct.map(summarizeMovement),
  invalidEntryMovements: invalidEntry.map(summarizeMovement),
  invalidAllocationReferences,
  allocationQuantityMismatchMovements: allocationQuantityMismatch.map(summarizeMovement),
  interpretation: {
    entryItemLocationEvidence: "Local no item de entrada: evidência documental, não correção automática.",
    allocationLocationEvidence: "Local registrado nas alocações históricas do movimento.",
    currentLotLocationSnapshot: "Posição atual do lote; não representa necessariamente o local histórico do movimento.",
    action: "Apenas relatório. Nenhuma alteração será aplicada.",
  },
};

// Read-only post-correction verification trigger.

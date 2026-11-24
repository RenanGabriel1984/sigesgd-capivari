// Consulta Convex INLINE somente leitura. Não usa mutations, actions ou rede.
const [
  products,
  globalStocks,
  localStocks,
  lots,
  areas,
  locations,
  requests,
  requestItems,
  movements,
  transfers,
  returns,
  entries,
  entryItems,
] = await Promise.all([
  ctx.db.query("products").collect(),
  ctx.db.query("stock").collect(),
  ctx.db.query("stockByLocation").collect(),
  ctx.db.query("lots").collect(),
  ctx.db.query("stockAreas").collect(),
  ctx.db.query("storageLocations").collect(),
  ctx.db.query("requests").collect(),
  ctx.db.query("requestItems").collect(),
  ctx.db.query("stockMovements").collect(),
  ctx.db.query("stockTransfers").collect(),
  ctx.db.query("returns").collect(),
  ctx.db.query("entries").collect(),
  ctx.db.query("entryItems").collect(),
]);

// Tabelas introduzidas pelo livro-razão novo podem ainda não existir no
// deployment consultado. A ausência é reportada; nunca é criada ou migrada.
let lotLocationBalances = [];
let lotLocationBalancesAvailable = true;
try {
  lotLocationBalances = await ctx.db.query("lotLocationBalances").collect();
} catch {
  lotLocationBalancesAvailable = false;
}
let movementLotAllocations = [];
let movementLotAllocationsAvailable = true;
try {
  movementLotAllocations = await ctx.db.query("stockMovementLotAllocations").collect();
} catch {
  movementLotAllocationsAvailable = false;
}
let returnLotAllocations = [];
let returnLotAllocationsAvailable = true;
try {
  returnLotAllocations = await ctx.db.query("returnLotAllocations").collect();
} catch {
  returnLotAllocationsAvailable = false;
}

const EPSILON = 1e-9;
const sum = (rows, field) => rows.reduce((total, row) => total + Number(row[field] ?? 0), 0);
const areaById = new Map(areas.map((row) => [String(row._id), row]));
const locationById = new Map(locations.map((row) => [String(row._id), row]));
const lotById = new Map(lots.map((row) => [String(row._id), row]));
const lotByNumber = new Map(lots.map((row) => [String(row.lotNumber), row]));
const requestById = new Map(requests.map((row) => [String(row._id), row]));
const approvedRequestIds = new Set(requests.filter((row) => row.status === "approved").map((row) => String(row._id)));

const productsReport = products.map((product) => {
  const productId = String(product._id);
  const globalRows = globalStocks.filter((row) => String(row.productId) === productId);
  const localRows = localStocks.filter((row) => String(row.productId) === productId);
  const productLots = lots.filter((row) => String(row.productId) === productId);
  const lotBalances = lotLocationBalances.filter((row) => String(row.productId) === productId);
  const allocations = movementLotAllocations.filter((row) => String(row.productId) === productId);
  const approvedItems = requestItems.filter((item) =>
    String(item.productId) === productId && approvedRequestIds.has(String(item.requestId)),
  );

  const global = globalRows.length === 1 ? globalRows[0] : null;
  const globalPhysical = global ? Number(global.physicalQuantity) : null;
  const globalReserved = global ? Number(global.reservedQuantity) : null;
  const localPhysical = sum(localRows, "quantity");
  const lotPhysical = sum(productLots, "quantityAvailable");
  const allocatedLotPhysical = sum(lotBalances, "quantityAvailable");
  const expectedReserved = approvedItems.reduce((total, item) => total + Number(item.quantityApproved ?? 0), 0);
  const actualReserved = globalReserved ?? 0;
  const flags = [];

  if (globalRows.length === 0 && (localPhysical > EPSILON || lotPhysical > EPSILON || expectedReserved > EPSILON)) {
    flags.push("saldo_sem_registro_global");
  }
  if (globalRows.length > 1) flags.push("registros_globais_duplicados");
  if (global && (!Number.isFinite(globalPhysical) || !Number.isFinite(globalReserved) ||
      globalPhysical < 0 || globalReserved < 0 || globalReserved > globalPhysical)) {
    flags.push("saldo_global_invalido");
  }
  if (global && Math.abs(globalPhysical - localPhysical) > EPSILON) flags.push("global_diverge_dos_armarios");
  if (global && productLots.length > 0 && Math.abs(globalPhysical - lotPhysical) > EPSILON) {
    flags.push("global_diverge_dos_lotes");
  }
  if (globalReserved !== null && Math.abs(actualReserved - expectedReserved) > EPSILON) {
    flags.push("reserva_diverge_das_solicitacoes_aprovadas");
  }
  if (globalRows.length === 0 && expectedReserved > EPSILON) {
    flags.push("solicitacao_aprovada_sem_registro_global_de_estoque");
  }
  if (approvedItems.some((item) => !Number.isFinite(item.quantityApproved) || Number(item.quantityApproved) < 0)) {
    flags.push("quantidade_aprovada_invalida");
  }

  const localKeys = new Set();
  for (const row of localRows) {
    const key = String(row.locationId);
    if (localKeys.has(key)) flags.push("saldo_duplicado_no_mesmo_armario");
    localKeys.add(key);
    const location = locationById.get(key);
    if (!location || location.active === false) flags.push("saldo_em_armario_inexistente_ou_inativo");
    if (!Number.isFinite(row.quantity) || row.quantity < 0) flags.push("saldo_de_armario_invalido");
  }

  const lotBalanceKeys = new Set();
  const lotByBalanceTotal = new Map();
  const balanceByLocationTotal = new Map();
  for (const balance of lotBalances) {
    const lotId = String(balance.lotId);
    const locationId = String(balance.locationId);
    const key = lotId + "::" + locationId;
    if (lotBalanceKeys.has(key)) flags.push("saldo_lote_armario_duplicado");
    lotBalanceKeys.add(key);
    const lot = lotById.get(lotId);
    if (!lot || String(lot.productId) !== productId) flags.push("saldo_de_lote_orfao_ou_de_outro_produto");
    if (!Number.isFinite(balance.quantityAvailable) || balance.quantityAvailable < 0) {
      flags.push("saldo_lote_armario_invalido");
    }
    lotByBalanceTotal.set(lotId, (lotByBalanceTotal.get(lotId) ?? 0) + Number(balance.quantityAvailable ?? 0));
    balanceByLocationTotal.set(locationId, (balanceByLocationTotal.get(locationId) ?? 0) + Number(balance.quantityAvailable ?? 0));
    const location = locationById.get(locationId);
    if (!location || location.active === false) flags.push("saldo_lote_em_armario_inexistente_ou_inativo");
  }

  if (lotLocationBalancesAvailable && productLots.length > 0) {
    if (lotBalances.length === 0 && lotPhysical > EPSILON) flags.push("lotes_sem_distribuicao_por_armario");
    for (const lot of productLots) {
      const allocated = lotByBalanceTotal.get(String(lot._id)) ?? 0;
      if (Math.abs(Number(lot.quantityAvailable ?? 0) - allocated) > EPSILON) {
        flags.push("lote_diverge_da_soma_dos_armarios");
      }
      if (lot.active === false && Number(lot.quantityAvailable ?? 0) > EPSILON) {
        flags.push("lote_inativo_com_saldo_positivo");
      }
      if (Number(lot.quantityAvailable ?? 0) > EPSILON) {
        const area = lot.areaId ? areaById.get(String(lot.areaId)) : null;
        if (!lot.areaId || !area || area.active === false) flags.push("lote_disponivel_sem_area_ativa");
      }
    }
    const allLocationIds = new Set([
      ...localRows.map((row) => String(row.locationId)),
      ...balanceByLocationTotal.keys(),
    ]);
    for (const locationId of allLocationIds) {
      const local = localRows.filter((row) => String(row.locationId) === locationId).reduce((n, row) => n + Number(row.quantity ?? 0), 0);
      const allocated = balanceByLocationTotal.get(locationId) ?? 0;
      if (Math.abs(local - allocated) > EPSILON) flags.push("lote_diverge_do_saldo_do_armario");
    }
  }

  const movementRows = movements.filter((row) => String(row.productId) === productId);
  const unresolvedMovementLotReferences = movementRows.filter((row) => {
    if (!row.lotId) return false;
    return !lotById.has(String(row.lotId)) && !lotByNumber.has(String(row.lotId));
  }).length;
  const unclassifiedLotQuantity = productLots
    .filter((lot) => !lot.areaId || !areaById.has(String(lot.areaId)))
    .reduce((total, lot) => total + Number(lot.quantityAvailable ?? 0), 0);

  return {
    product: product.name,
    active: product.active === true,
    globalRows: globalRows.length,
    globalPhysical,
    localPhysical,
    globalVsLocationDifference: globalPhysical === null ? null : globalPhysical - localPhysical,
    globalVsLotsDifference: globalPhysical === null || productLots.length === 0 ? null : globalPhysical - lotPhysical,
    globalReserved,
    expectedReservedFromApprovedRequests: expectedReserved,
    reservationDifference: globalReserved === null ? null : actualReserved - expectedReserved,
    lotCount: productLots.length,
    lotPhysical,
    lotLocationPhysical: lotLocationBalancesAvailable ? allocatedLotPhysical : null,
    unclassifiedLotQuantity,
    localRows: localRows.map((row) => ({
      location: locationById.get(String(row.locationId))?.name ?? "Local inexistente",
      quantity: row.quantity,
    })),
    movements: movementRows.length,
    unresolvedMovementLotReferences,
    flags: [...new Set(flags)],
  };
}).filter((row) =>
  (row.globalPhysical !== null && row.globalPhysical !== 0) ||
  row.localPhysical !== 0 ||
  (row.globalReserved !== null && row.globalReserved !== 0) ||
  row.lotPhysical !== 0 ||
  row.flags.length > 0,
).sort((a, b) => String(a.product).localeCompare(String(b.product), "pt-BR"));

const movementTypeCounts = {};
for (const movement of movements) {
  const key = String(movement.type ?? "sem_tipo");
  movementTypeCounts[key] = (movementTypeCounts[key] ?? 0) + 1;
}
const allocationCountByMovementId = new Map();
for (const allocation of movementLotAllocations) {
  const key = String(allocation.movementId);
  allocationCountByMovementId.set(key, (allocationCountByMovementId.get(key) ?? 0) + 1);
}
const movementAllocationCoverageByType = {};
for (const movement of movements) {
  const type = String(movement.type ?? "sem_tipo");
  const stat = movementAllocationCoverageByType[type] ?? { total: 0, withStructuredLots: 0, withoutStructuredLots: 0 };
  stat.total++;
  if ((allocationCountByMovementId.get(String(movement._id)) ?? 0) > 0) stat.withStructuredLots++;
  else stat.withoutStructuredLots++;
  movementAllocationCoverageByType[type] = stat;
}
const productsById = new Map(products.map((product) => [String(product._id), product]));
const locationsById = new Map(locations.map((location) => [String(location._id), location]));
const entriesWithoutAreaDetails = entries
  .filter((entry) => !entry.areaId)
  .map((entry) => ({
    entryNumber: entry.entryNumber,
    status: entry.status,
    originType: entry.originType,
    materialType: entry.materialType ?? null,
    invoiceNumber: entry.invoiceNumber ?? null,
    receivedAt: entry.receivedAt,
    itemCount: entryItems.filter((item) => String(item.entryId) === String(entry._id)).length,
  }));
const returnsDetails = returns.map((returned) => ({
  productName: productsById.get(String(returned.productId))?.name ?? "Produto inexistente",
  quantity: returned.quantity,
  condition: returned.condition ?? "legada_sem_condicao",
  stockDisposition: returned.stockDisposition ?? "legado_sem_destinacao_registrada",
  locationName: returned.locationId ? locationsById.get(String(returned.locationId))?.name ?? "Local inexistente" : null,
  exitMovementLinked: Boolean(returned.exitMovementId),
  lotAllocationCount: returnLotAllocations.filter((allocation) => String(allocation.returnId) === String(returned._id)).length,
  createdAt: returned.createdAt,
  inspectedAt: returned.inspectedAt ?? null,
}));
const lotReferenceCounts = { byId: 0, byNumber: 0, unresolved: 0, empty: 0 };
for (const movement of movements) {
  if (!movement.lotId) lotReferenceCounts.empty++;
  else if (lotById.has(String(movement.lotId))) lotReferenceCounts.byId++;
  else if (lotByNumber.has(String(movement.lotId))) lotReferenceCounts.byNumber++;
  else lotReferenceCounts.unresolved++;
}

const areaRows = areas.map((area) => ({ name: area.name, active: area.active }));
const locationRows = locations.map((location) => ({ name: location.name, active: location.active }));
const approvedItemsWithoutQuantity = requestItems.filter((item) =>
  approvedRequestIds.has(String(item.requestId)) &&
  (!Number.isFinite(item.quantityApproved) || Number(item.quantityApproved) < 0),
).length;

return {
  generatedAt: Date.now(),
  readOnly: true,
  deploymentRequested: "first-herring-264",
  scope: "all_products_and_stock_records",
  schemaAvailability: {
    lotLocationBalances: lotLocationBalancesAvailable,
    stockMovementLotAllocations: movementLotAllocationsAvailable,
  },
  totals: {
    products: products.length,
    activeProducts: products.filter((row) => row.active).length,
    globalStockRows: globalStocks.length,
    globalPhysical: sum(globalStocks, "physicalQuantity"),
    globalReserved: sum(globalStocks, "reservedQuantity"),
    stockByLocationRows: localStocks.length,
    stockByLocationPhysical: sum(localStocks, "quantity"),
    lots: lots.length,
    lotAvailable: sum(lots, "quantityAvailable"),
    lotLocationBalanceRows: lotLocationBalances.length,
    lotLocationBalancePhysical: sum(lotLocationBalances, "quantityAvailable"),
    approvedRequests: requests.filter((row) => row.status === "approved").length,
    approvedRequestItems: requestItems.filter((row) => approvedRequestIds.has(String(row.requestId))).length,
    approvedItemsWithoutQuantity,
    movements: movements.length,
    movementsWithoutOperator: movements.filter((row) => !row.userId).length,
    movementsWithoutLocation: movements.filter((row) => !row.locationId).length,
    transfers: transfers.length,
    transfersWithoutLot: transfers.filter((row) => !row.lotId).length,
    returns: returns.length,
    returnsInQuarantine: returns.filter((row) => row.stockDisposition === "quarantine").length,
    returnsDiscarded: returns.filter((row) => row.stockDisposition === "disposed").length,
    entries: entries.length,
    entriesWithoutArea: entries.filter((row) => !row.areaId).length,
    entryItems: entryItems.length,
    entryItemsWithoutLot: entryItems.filter((row) => !row.lotId).length,
    movementLotAllocations: movementLotAllocations.length,
    movementsWithStructuredLotAllocations: allocationCountByMovementId.size,
    movementsWithoutStructuredLotAllocations: movements.length - allocationCountByMovementId.size,
    returnLotAllocations: returnLotAllocations.length,
    entriesWithoutArea: entriesWithoutAreaDetails.length,
  },
  movementAllocationCoverageByType,
  entriesWithoutAreaDetails,
  returnsDetails,
  schemaAvailability: {
    lotLocationBalances: lotLocationBalancesAvailable,
    stockMovementLotAllocations: movementLotAllocationsAvailable,
    returnLotAllocations: returnLotAllocationsAvailable,
  },
  areas: areaRows,
  locations: locationRows,
  movementTypeCounts,
  movementLotReferenceCounts: lotReferenceCounts,
  productsRequiringReview: productsReport.length,
  products: productsReport,
  warnings: [
    "Consulta inline somente leitura; nenhuma mutation, migration ou gravação foi executada.",
    lotLocationBalancesAvailable
      ? "A tabela lote × armário está disponível no deployment consultado."
      : "A tabela lotLocationBalances não existe ou não está disponível neste deployment; não é possível comprovar distribuição atual por lote × armário.",
    movementLotAllocationsAvailable
      ? "Alocações estruturadas de lotes por movimentação estão disponíveis."
      : "A tabela stockMovementLotAllocations não existe ou não está disponível neste deployment.",
    returnLotAllocationsAvailable
      ? "Alocações de lotes por devolução estão disponíveis."
      : "A tabela returnLotAllocations não existe ou não está disponível neste deployment.",
    "A ausência de área em entrada precisa ser interpretada junto ao status e aos itens: rascunhos não equivalem a entrada confirmada sem classificação.",
    "A ausência de alocações estruturadas em movimentos históricos não prova divergência de saldo; requer avaliação de cobertura conforme tipo e data do movimento.",
    "Produtos sem lote podem ser legados válidos; suas quantidades continuam sendo conciliadas por armário.",
  ],
};
// Auditoria dimensional do estoque — SOMENTE LEITURA.
// Executar via convex run --inline-query. Não chama mutations nem APIs externas.
const [products, stock, stockByLocation, lots, balances, areas, locations] = await Promise.all([
  ctx.db.query("products").collect(),
  ctx.db.query("stock").collect(),
  ctx.db.query("stockByLocation").collect(),
  ctx.db.query("lots").collect(),
  ctx.db.query("lotLocationBalances").collect(),
  ctx.db.query("stockAreas").collect(),
  ctx.db.query("storageLocations").collect(),
]);
const sumBy = (rows, key, value) => {
  const map = new Map();
  for (const row of rows) map.set(String(row[key]), (map.get(String(row[key])) ?? 0) + Number(row[value] ?? 0));
  return map;
};
const productById = new Map(products.map(x => [String(x._id), x]));
const lotById = new Map(lots.map(x => [String(x._id), x]));
const areaIds = new Set(areas.map(x => String(x._id)));
const locationIds = new Set(locations.map(x => String(x._id)));
const stockByProduct = sumBy(stock, "productId", "physicalQuantity");
const locationByProduct = sumBy(stockByLocation, "productId", "quantity");
const activeLots = lots.filter(x => x.active);
const lotsByProduct = sumBy(activeLots, "productId", "quantityAvailable");
const balancesByProduct = sumBy(balances, "productId", "quantityAvailable");
const balancesByLot = sumBy(balances, "lotId", "quantityAvailable");
const byProductLocation = (rows, productKey, locationKey, valueKey) => {
  const map = new Map();
  for (const row of rows) {
    const key = String(row[productKey]) + "|" + String(row[locationKey]);
    map.set(key, (map.get(key) ?? 0) + Number(row[valueKey] ?? 0));
  }
  return map;
};
const legacyByProductLocation = byProductLocation(stockByLocation, "productId", "locationId", "quantity");
const lotByProductLocation = byProductLocation(balances, "productId", "locationId", "quantityAvailable");
const keys = new Set([...legacyByProductLocation.keys(), ...lotByProductLocation.keys()]);
const close = (a,b) => Math.abs(a-b) < 0.000001;
const globalMismatches = [];
for (const product of products) {
  const id = String(product._id);
  const physical = stockByProduct.get(id) ?? 0;
  const byLocation = locationByProduct.get(id) ?? 0;
  const lotsTotal = lotsByProduct.get(id) ?? 0;
  const balanceTotal = balancesByProduct.get(id) ?? 0;
  if (!close(physical, byLocation) || !close(byLocation, lotsTotal) || !close(lotsTotal, balanceTotal)) {
    globalMismatches.push({ productId:id, name:product.name, stock:physical, stockByLocation:byLocation, activeLots:lotsTotal, lotLocationBalances:balanceTotal });
  }
}
const locationMismatches = [];
for (const key of keys) {
  const a = legacyByProductLocation.get(key) ?? 0;
  const b = lotByProductLocation.get(key) ?? 0;
  if (!close(a,b)) {
    const [productId, locationId] = key.split("|");
    locationMismatches.push({ productId, productName:productById.get(productId)?.name ?? null, locationId, locationName:locations.find(x=>String(x._id)===locationId)?.name ?? null, stockByLocation:a, lotLocationBalances:b });
  }
}
const duplicateLotLocation = [];
const seen = new Set();
for (const row of balances) {
  const key = String(row.lotId)+"|"+String(row.locationId);
  if (seen.has(key)) duplicateLotLocation.push({ lotId:String(row.lotId), locationId:String(row.locationId) });
  seen.add(key);
}
const invalidBalances = balances.filter(row =>
  !lotById.has(String(row.lotId)) ||
  !productById.has(String(row.productId)) ||
  !locationIds.has(String(row.locationId)) ||
  (lotById.has(String(row.lotId)) && String(lotById.get(String(row.lotId)).productId)!==String(row.productId)) ||
  Number(row.quantityAvailable)<0
).map(row=>({ id:String(row._id), lotId:String(row.lotId), productId:String(row.productId), locationId:String(row.locationId), quantityAvailable:row.quantityAvailable }));
const invalidStockByLocation = stockByLocation.filter(row =>
  !productById.has(String(row.productId)) || !locationIds.has(String(row.locationId)) || Number(row.quantity)<0
).map(row=>({ id:String(row._id), productId:String(row.productId), locationId:String(row.locationId), quantity:row.quantity, areaId:row.areaId ? String(row.areaId) : null, areaReferenceValid:row.areaId ? areaIds.has(String(row.areaId)) : null }));
const invalidLots = lots.filter(row =>
  !productById.has(String(row.productId)) ||
  !ctx.db.normalizeId("entries", String(row.entryId)) ||
  (row.areaId && !areaIds.has(String(row.areaId))) ||
  (row.locationId && !locationIds.has(String(row.locationId))) ||
  Number(row.quantityAvailable)<0
).map(row=>({ id:String(row._id), lotNumber:row.lotNumber, productId:String(row.productId), entryId:String(row.entryId), areaId:row.areaId ? String(row.areaId) : null, locationId:row.locationId ? String(row.locationId) : null, quantityAvailable:row.quantityAvailable }));
const lotQuantityMismatches = activeLots.filter(row => !close(Number(row.quantityAvailable), balancesByLot.get(String(row._id)) ?? 0))
  .map(row=>({ lotId:String(row._id), lotNumber:row.lotNumber, productName:productById.get(String(row.productId))?.name ?? null, lotQuantity:Number(row.quantityAvailable), locationsQuantity:balancesByLot.get(String(row._id)) ?? 0 }));
return {
  readOnly:true,
  deploymentRequested:"first-herring-264",
  generatedAt:Date.now(),
  totals:{ products:products.length, stockRows:stock.length, stockByLocationRows:stockByLocation.length, activeLots:activeLots.length, lotLocationBalanceRows:balances.length, areas:areas.length, locations:locations.length },
  integrity:{ globalProductMismatches:globalMismatches.length, productLocationMismatches:locationMismatches.length, lotQuantityMismatches:lotQuantityMismatches.length, duplicateLotLocationRows:duplicateLotLocation.length, invalidLotLocationBalances:invalidBalances.length, invalidStockByLocationRows:invalidStockByLocation.length, invalidLots:invalidLots.length },
  globalMismatches, locationMismatches, lotQuantityMismatches, duplicateLotLocation, invalidBalances, invalidStockByLocation, invalidLots
};

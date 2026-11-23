// Auditoria dimensional do estoque — somente leitura.
const products = await ctx.db.query("products").collect();
const stock = await ctx.db.query("stock").collect();
const stockByLocation = await ctx.db.query("stockByLocation").collect();
const lots = await ctx.db.query("lots").collect();
const balances = await ctx.db.query("lotLocationBalances").collect();
const areas = await ctx.db.query("stockAreas").collect();
const locations = await ctx.db.query("storageLocations").collect();
const entries = await ctx.db.query("entries").collect();

const productIds = [];
const lotIds = [];
const areaIds = [];
const locationIds = [];
const entryIds = [];
for (const row of products) productIds.push(String(row._id));
for (const row of lots) lotIds.push(String(row._id));
for (const row of areas) areaIds.push(String(row._id));
for (const row of locations) locationIds.push(String(row._id));
for (const row of entries) entryIds.push(String(row._id));

const activeLots = [];
for (const lot of lots) if (lot.active) activeLots.push(lot);

const globalMismatches = [];
for (const product of products) {
  const id = String(product._id);
  let stockTotal = 0;
  let locationTotal = 0;
  let lotTotal = 0;
  let balanceTotal = 0;
  for (const row of stock) if (String(row.productId) === id) stockTotal += Number(row.physicalQuantity || 0);
  for (const row of stockByLocation) if (String(row.productId) === id) locationTotal += Number(row.quantity || 0);
  for (const row of activeLots) if (String(row.productId) === id) lotTotal += Number(row.quantityAvailable || 0);
  for (const row of balances) if (String(row.productId) === id) balanceTotal += Number(row.quantityAvailable || 0);
  if (Math.abs(stockTotal-locationTotal)>0.000001 || Math.abs(locationTotal-lotTotal)>0.000001 || Math.abs(lotTotal-balanceTotal)>0.000001) {
    globalMismatches.push({productId:id,productName:product.name,stock:stockTotal,stockByLocation:locationTotal,activeLots:lotTotal,lotLocationBalances:balanceTotal});
  }
}

const locationMismatches = [];
for (const product of products) {
  for (const location of locations) {
    const productId = String(product._id);
    const locationId = String(location._id);
    let legacyTotal = 0;
    let lotBalanceTotal = 0;
    for (const row of stockByLocation) {
      if (String(row.productId)===productId && String(row.locationId)===locationId) legacyTotal += Number(row.quantity || 0);
    }
    for (const row of balances) {
      if (String(row.productId)===productId && String(row.locationId)===locationId) lotBalanceTotal += Number(row.quantityAvailable || 0);
    }
    if (Math.abs(legacyTotal-lotBalanceTotal)>0.000001) {
      locationMismatches.push({productId,productName:product.name,locationId,locationName:location.name,stockByLocation:legacyTotal,lotLocationBalances:lotBalanceTotal});
    }
  }
}

const lotQuantityMismatches = [];
for (const lot of activeLots) {
  let balanceTotal = 0;
  for (const row of balances) if (String(row.lotId)===String(lot._id)) balanceTotal += Number(row.quantityAvailable || 0);
  if (Math.abs(Number(lot.quantityAvailable || 0)-balanceTotal)>0.000001) {
    lotQuantityMismatches.push({lotId:String(lot._id),lotNumber:lot.lotNumber,productId:String(lot.productId),quantityAvailable:lot.quantityAvailable,locationBalanceTotal:balanceTotal});
  }
}

const duplicateLotLocation = [];
const seenPairs = [];
for (const row of balances) {
  const key = String(row.lotId)+"|"+String(row.locationId);
  if (seenPairs.includes(key)) duplicateLotLocation.push({lotId:String(row.lotId),locationId:String(row.locationId)});
  else seenPairs.push(key);
}

const invalidBalances = [];
for (const row of balances) {
  if (!lotIds.includes(String(row.lotId)) || !productIds.includes(String(row.productId)) ||
      !locationIds.includes(String(row.locationId)) || Number(row.quantityAvailable)<0) {
    invalidBalances.push({id:String(row._id),lotId:String(row.lotId),productId:String(row.productId),locationId:String(row.locationId),quantityAvailable:row.quantityAvailable});
  }
}
const invalidStockByLocation = [];
for (const row of stockByLocation) {
  if (!productIds.includes(String(row.productId)) || !locationIds.includes(String(row.locationId)) ||
      (row.areaId && !areaIds.includes(String(row.areaId))) || Number(row.quantity)<0) {
    invalidStockByLocation.push({id:String(row._id),productId:String(row.productId),locationId:String(row.locationId),quantity:row.quantity,areaId:row.areaId ? String(row.areaId) : null});
  }
}
const invalidLots = [];
for (const row of lots) {
  if (!productIds.includes(String(row.productId)) || !entryIds.includes(String(row.entryId)) ||
      (row.areaId && !areaIds.includes(String(row.areaId))) ||
      (row.locationId && !locationIds.includes(String(row.locationId))) ||
      Number(row.quantityAvailable)<0) {
    invalidLots.push({id:String(row._id),lotNumber:row.lotNumber,productId:String(row.productId),entryId:String(row.entryId),areaId:row.areaId ? String(row.areaId) : null,locationId:row.locationId ? String(row.locationId) : null,quantityAvailable:row.quantityAvailable});
  }
}

const areaDistribution = [];
for (const area of areas) {
  let lotCount = 0;
  let lotUnits = 0;
  let balanceRows = 0;
  let balanceUnits = 0;
  for (const lot of activeLots) {
    if (String(lot.areaId || "") === String(area._id)) {
      lotCount += 1;
      lotUnits += Number(lot.quantityAvailable || 0);
    }
  }
  for (const balance of balances) {
    const lot = lots.find((item) => String(item._id) === String(balance.lotId));
    if (lot && String(lot.areaId || "") === String(area._id)) {
      balanceRows += 1;
      balanceUnits += Number(balance.quantityAvailable || 0);
    }
  }
  areaDistribution.push({areaId:String(area._id),areaName:area.name,active:area.active,activeLotCount:lotCount,lotUnits:lotUnits,balanceRows:balanceRows,balanceUnits:balanceUnits});
}
let unclassifiedActiveLotCount = 0;
let unclassifiedActiveLotUnits = 0;
for (const lot of activeLots) {
  if (!lot.areaId) {
    unclassifiedActiveLotCount += 1;
    unclassifiedActiveLotUnits += Number(lot.quantityAvailable || 0);
  }
}
const locationDistribution = [];
for (const location of locations) {
  let balanceRows = 0;
  let units = 0;
  for (const balance of balances) {
    if (String(balance.locationId) === String(location._id)) {
      balanceRows += 1;
      units += Number(balance.quantityAvailable || 0);
    }
  }
  locationDistribution.push({locationId:String(location._id),locationName:location.name,active:location.active,balanceRows:balanceRows,units:units});
}
let totalPhysicalUnits = 0;
let totalLocationUnits = 0;
let totalActiveLotUnits = 0;
let totalLotLocationUnits = 0;
for (const row of stock) totalPhysicalUnits += Number(row.physicalQuantity || 0);
for (const row of stockByLocation) totalLocationUnits += Number(row.quantity || 0);
for (const row of activeLots) totalActiveLotUnits += Number(row.quantityAvailable || 0);
for (const row of balances) totalLotLocationUnits += Number(row.quantityAvailable || 0);

return {
  readOnly:true,
  deploymentRequested:"first-herring-264",
  generatedAt:Date.now(),
  totals:{products:products.length,stockRows:stock.length,stockByLocationRows:stockByLocation.length,lots:lots.length,activeLots:activeLots.length,lotLocationBalanceRows:balances.length,areas:areas.length,locations:locations.length,entries:entries.length},
  unitTotals:{physicalStock:totalPhysicalUnits,stockByLocation:totalLocationUnits,activeLots:totalActiveLotUnits,lotLocationBalances:totalLotLocationUnits},
  areaDistribution:areaDistribution,
  unclassifiedActiveLots:{count:unclassifiedActiveLotCount,units:unclassifiedActiveLotUnits},
  locationDistribution:locationDistribution,
  integrity:{globalProductMismatches:globalMismatches.length,productLocationMismatches:locationMismatches.length,lotQuantityMismatches:lotQuantityMismatches.length,duplicateLotLocationRows:duplicateLotLocation.length,invalidLotLocationBalances:invalidBalances.length,invalidStockByLocationRows:invalidStockByLocation.length,invalidLots:invalidLots.length},
  globalMismatches:globalMismatches,
  locationMismatches:locationMismatches,
  lotQuantityMismatches:lotQuantityMismatches,
  duplicateLotLocation:duplicateLotLocation,
  invalidBalances:invalidBalances,
  invalidStockByLocation:invalidStockByLocation,
  invalidLots:invalidLots
};

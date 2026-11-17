const [movements, products, entries, entryItems, lots, locations, balances] = await Promise.all([
  ctx.db.query("stockMovements").collect(),
  ctx.db.query("products").collect(),
  ctx.db.query("entries").collect(),
  ctx.db.query("entryItems").collect(),
  ctx.db.query("lots").collect(),
  ctx.db.query("storageLocations").collect(),
  ctx.db.query("lotLocationBalances").collect(),
]);
const byId = (rows) => new Map(rows.map((row) => [String(row._id), row]));
const productById = byId(products), entryById = byId(entries), locationById = byId(locations), lotById = byId(lots);
const lotsByNumber = new Map(), itemsByEntry = new Map(), balancesByLot = new Map();
for (const lot of lots) { const k=String(lot.lotNumber), a=lotsByNumber.get(k)??[]; a.push(lot); lotsByNumber.set(k,a); }
for (const item of entryItems) { const k=String(item.entryId), a=itemsByEntry.get(k)??[]; a.push(item); itemsByEntry.set(k,a); }
for (const row of balances) { const k=String(row.lotId), a=balancesByLot.get(k)??[]; a.push(row); balancesByLot.set(k,a); }
const resolveLot = (ref) => {
  if (!ref) return undefined;
  const direct=lotById.get(String(ref)); if(direct) return direct;
  const found=lotsByNumber.get(String(ref))??[]; return found.length===1?found[0]:undefined;
};
const proposed=[], excluded=[];
for (const movement of movements) {
  if (movement.locationId) continue;
  const reasons=[], type=String(movement.type??""), product=productById.get(String(movement.productId));
  if(type!=="entry"&&type!=="adjustment") reasons.push("tipo exige revisão histórica");
  if(movement.canceled) reasons.push("movimento cancelado");
  if(!product) reasons.push("produto inexistente");
  const lot=resolveLot(movement.lotId);
  if(!lot) reasons.push("lote ausente, não resolvido ou ambíguo");
  if(lot&&String(lot.productId)!==String(movement.productId)) reasons.push("produto do lote diverge");
  const sourceEntryId=movement.entryId?String(movement.entryId):(lot?.entryId?String(lot.entryId):null);
  if(!sourceEntryId||!entryById.has(sourceEntryId)) reasons.push("entrada de origem não resolvida");
  if(movement.entryId&&lot&&String(movement.entryId)!==String(lot.entryId)) reasons.push("entrada do movimento diverge da entrada do lote");
  const matches=sourceEntryId?(itemsByEntry.get(sourceEntryId)??[]).filter(item=>String(item.productId)===String(movement.productId)&&lot&&String(item.lotId)===String(lot._id)):[];
  if(matches.length!==1) reasons.push(`item de entrada correspondente não é único (${matches.length})`);
  const item=matches.length===1?matches[0]:undefined;
  const locationId=item?.locationId?String(item.locationId):null;
  if(!locationId) reasons.push("item de entrada sem localização");
  if(locationId&&!locationById.has(locationId)) reasons.push("local documental inexistente");
  if(item&&Number(item.quantity)!==Number(movement.quantity)) reasons.push("quantidade diverge do item de entrada");
  const current=lot?(balancesByLot.get(String(lot._id))??[]):[];
  const currentIds=[...new Set(current.map(row=>String(row.locationId)))];
  if(currentIds.length!==1) reasons.push(`posição atual do lote não é única (${currentIds.length})`);
  if(currentIds.length===1&&currentIds[0]!==locationId) reasons.push("posição atual diverge do local documental");
  if(currentIds.length===1&&!locationById.has(currentIds[0])) reasons.push("referência do local atual inválida");
  if(reasons.length===0&&item&&lot&&locationId) proposed.push({
    movementId:String(movement._id),type,productId:String(movement.productId),productName:product.name,
    quantity:movement.quantity,timestamp:movement.timestamp,entryId:sourceEntryId,
    entryNumber:entryById.get(sourceEntryId)?.entryNumber??null,entryItemId:String(item._id),
    lotId:String(lot._id),lotNumber:lot.lotNumber,before:{locationId:null},
    proposed:{locationId,locationName:locationById.get(locationId).name},
    corroboration:{source:"entryItems.locationId",currentLotLocationId:currentIds[0],currentLotLocationMatches:true,itemQuantityMatchesMovement:true}
  });
  else excluded.push({movementId:String(movement._id),type,productName:product?.name??null,quantity:movement.quantity,reasons});
}
const byType={},byLocation={};
for(const row of proposed){byType[row.type]=(byType[row.type]??0)+1;byLocation[row.proposed.locationName]=(byLocation[row.proposed.locationName]??0)+1;}
return {
  generatedAt:Date.now(),mode:"DRY_RUN_ONLY",readOnly:true,deploymentRequested:"first-herring-264",
  writesPerformed:0,mutationsImported:false,
  totals:{movementsWithoutLocation:movements.filter(row=>!row.locationId).length,proposed:proposed.length,excludedForReview:excluded.length,totalMovements:movements.length},
  proposedByType:byType,proposedByLocation:byLocation,
  proposedChanges:proposed.sort((a,b)=>a.timestamp-b.timestamp),excludedForReview:excluded,
  safeguards:["Nenhum insert, patch, replace ou delete executado.","Somente entry e adjustment elegíveis.",
    "Produto, lote, entrada e item de entrada resolvidos sem ambiguidade.",
    "Um único item de entrada correspondente, com local válido.",
    "Quantidade do movimento igual à quantidade do item de entrada.",
    "Posição atual única do lote e coincidente com o local documental.",
    "Saídas, devoluções, cancelados e divergências excluídos para revisão."]
};
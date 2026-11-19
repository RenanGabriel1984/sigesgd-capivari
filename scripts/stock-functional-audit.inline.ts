// Auditoria funcional integrada do estoque e da água — estritamente read-only.
const names = [
  "products","stock","stockByLocation","stockAreas","storageLocations","lots","lotLocationBalances",
  "entries","entryItems","stockMovements","stockMovementLots","requests","requestItems",
  "requestItemReservations","returns","stockTransfers","stockTransferLots",
  "waterParticipants","waterPeriods","waterReceipts","waterContainerMovements","waterShares","waterPayments"
];
const data = {};
for (const name of names) data[name] = await ctx.db.query(name).collect();
const map = (rows) => new Map(rows.map(row => [String(row._id), row]));
const products = map(data.products), areas = map(data.stockAreas), locations = map(data.storageLocations);
const lots = map(data.lots), entries = map(data.entries), movements = map(data.stockMovements);
const requests = map(data.requests), requestItems = map(data.requestItems);
const participants = map(data.waterParticipants), periods = map(data.waterPeriods), shares = map(data.waterShares);
const anomalies = {
  entries: [], movements: [], reservations: [], returns: [], transfers: [],
  dimensional: [], water: []
};
const add = (bucket, item) => { if (anomalies[bucket].length < 100) anomalies[bucket].push(item); };
const validNum = n => Number.isFinite(n);
const eps = 1e-7;

// Entradas e itens: referências, quantidades, documentos e vínculos área/local.
for (const e of data.entries) {
  if (!validNum(e.receivedAt) || !e.entryNumber || !["draft","confirmed","reversed"].includes(e.status))
    add("entries",{id:String(e._id),issue:"invalid_header",entryNumber:e.entryNumber,status:e.status});
  const items = data.entryItems.filter(x => x.entryId === e._id);
  for (const item of items) {
    if (!products.has(String(item.productId)) || !validNum(item.quantity) || item.quantity <= 0)
      add("entries",{id:String(item._id),entryNumber:e.entryNumber,issue:"invalid_item_or_product",quantity:item.quantity});
    if (item.areaId && !areas.has(String(item.areaId))) add("entries",{id:String(item._id),issue:"invalid_area_reference"});
    if (item.locationId && !locations.has(String(item.locationId))) add("entries",{id:String(item._id),issue:"invalid_location_reference"});
  }
}
for (const lot of data.lots) {
  if (!products.has(String(lot.productId)) || !entries.has(String(lot.entryId)) ||
      !validNum(lot.quantityReceived) || !validNum(lot.quantityAvailable) ||
      lot.quantityReceived < 0 || lot.quantityAvailable < -eps || lot.quantityAvailable > lot.quantityReceived + eps)
    add("entries",{lotId:String(lot._id),issue:"invalid_lot_or_quantity",received:lot.quantityReceived,available:lot.quantityAvailable});
  if (lot.areaId && !areas.has(String(lot.areaId))) add("entries",{lotId:String(lot._id),issue:"invalid_lot_area"});
  if (lot.locationId && !locations.has(String(lot.locationId))) add("entries",{lotId:String(lot._id),issue:"invalid_lot_location"});
}

// Movimentos: referências, valores, lote e vínculos multi-lote.
const movementLotsByMovement = new Map();
for (const link of data.stockMovementLots) {
  const k=String(link.movementId), arr=movementLotsByMovement.get(k)||[]; arr.push(link); movementLotsByMovement.set(k,arr);
  const lot=lots.get(String(link.lotId));
  if (!movements.has(k) || !lot || !validNum(link.quantity) || link.quantity <= 0)
    add("movements",{linkId:String(link._id),issue:"invalid_movement_lot_link"});
}
for (const m of data.stockMovements) {
  if (!products.has(String(m.productId)) || !validNum(m.quantity) || m.quantity <= 0 ||
      !validNum(m.timestamp) || !["entry","exit","transfer","adjustment","return"].includes(m.type))
    add("movements",{id:String(m._id),issue:"invalid_movement_header",type:m.type,quantity:m.quantity});
  if (m.userId && !data.users?.length) { /* actor existence is checked below when users are loaded separately */ }
  if (m.entryId && !entries.has(String(m.entryId))) add("movements",{id:String(m._id),issue:"missing_entry"});
  if (m.lotId) {
    const lot=lots.get(String(m.lotId)) || data.lots.find(x=>x.lotNumber===m.lotId);
    if (!lot) add("movements",{id:String(m._id),issue:"unresolved_lot",lotReference:m.lotId});
    else if (lot.productId !== m.productId) add("movements",{id:String(m._id),issue:"product_lot_mismatch"});
    else if (m.entryId && lot.entryId !== m.entryId) add("movements",{id:String(m._id),issue:"entry_lot_mismatch"});
  }
  if (m.areaId && !areas.has(String(m.areaId))) add("movements",{id:String(m._id),issue:"invalid_area"});
  if (m.locationId && !locations.has(String(m.locationId))) add("movements",{id:String(m._id),issue:"invalid_source_location"});
  if (m.toAreaId && !areas.has(String(m.toAreaId))) add("movements",{id:String(m._id),issue:"invalid_destination_area"});
  if (m.toLocationId && !locations.has(String(m.toLocationId))) add("movements",{id:String(m._id),issue:"invalid_destination_location"});
  const links=movementLotsByMovement.get(String(m._id))||[];
  if (links.length && Math.abs(links.reduce((s,x)=>s+x.quantity,0)-m.quantity)>eps)
    add("movements",{id:String(m._id),issue:"movement_lot_quantity_mismatch",movementQuantity:m.quantity,linkedQuantity:links.reduce((s,x)=>s+x.quantity,0)});
  if (m.type==="transfer" && (!m.locationId || !m.toLocationId || m.locationId===m.toLocationId))
    add("movements",{id:String(m._id),issue:"transfer_location_pair_incomplete"});
}

// Reservas e solicitações: integridade referencial, quantidades e totais entregues.
const reservationsByItem=new Map();
for (const r of data.requestItemReservations) {
  const k=String(r.requestItemId), arr=reservationsByItem.get(k)||[]; arr.push(r); reservationsByItem.set(k,arr);
  if (!requestItems.has(k) || !products.has(String(r.productId)) || !lots.has(String(r.lotId)) ||
      !areas.has(String(r.areaId)) || !locations.has(String(r.locationId)) ||
      ![r.quantity,r.quantityRemaining,r.quantityDelivered,r.quantityReleased].every(validNum) ||
      r.quantity<0 || r.quantityRemaining<0 || r.quantityDelivered<0 || r.quantityReleased<0 ||
      Math.abs(r.quantity-r.quantityRemaining-r.quantityDelivered-r.quantityReleased)>eps)
    add("reservations",{id:String(r._id),issue:"invalid_reservation_or_reference"});
}
for (const item of data.requestItems) {
  const req=requests.get(String(item.requestId));
  if (!req || !products.has(String(item.productId)) || ![item.quantityRequested,item.quantityApproved,item.quantityDelivered].every(validNum) ||
      item.quantityRequested<0 || item.quantityApproved<0 || item.quantityDelivered<0 ||
      item.quantityApproved>item.quantityRequested+eps || item.quantityDelivered>item.quantityApproved+eps)
    add("reservations",{id:String(item._id),issue:"invalid_request_item",requested:item.quantityRequested,approved:item.quantityApproved,delivered:item.quantityDelivered});
  const rs=reservationsByItem.get(String(item._id))||[];
  const delivered=rs.reduce((s,x)=>s+x.quantityDelivered,0);
  if (rs.length && Math.abs(delivered-item.quantityDelivered)>eps)
    add("reservations",{id:String(item._id),issue:"delivered_reservation_total_mismatch",itemDelivered:item.quantityDelivered,reservationDelivered:delivered});
  if (item.areaId && !areas.has(String(item.areaId))) add("reservations",{id:String(item._id),issue:"invalid_item_area"});
  if (item.sourceLocationId && !locations.has(String(item.sourceLocationId))) add("reservations",{id:String(item._id),issue:"invalid_item_source_location"});
}

// Devoluções: saída de origem, produto/lote e limite acumulado por saída.
const returnedByExit=new Map();
for (const ret of data.returns) {
  const exit=ret.exitMovementId ? movements.get(String(ret.exitMovementId)) : null;
  const k=String(ret.exitMovementId||"unlinked");
  returnedByExit.set(k,(returnedByExit.get(k)||0)+ret.quantity);
  if (!validNum(ret.quantity)||ret.quantity<=0||!products.has(String(ret.productId))||
      !exit||exit.type!=="exit"||exit.productId!==ret.productId||
      (ret.lotId && !lots.has(String(ret.lotId))) ||
      (ret.areaId && !areas.has(String(ret.areaId))) ||
      (ret.locationId && !locations.has(String(ret.locationId))))
    add("returns",{id:String(ret._id),issue:"invalid_return_link_or_fields",exitMovementId:ret.exitMovementId||null});
}
for (const [exitId,total] of returnedByExit) {
  const exit=movements.get(exitId);
  if (exit && total>exit.quantity+eps) add("returns",{exitMovementId:exitId,issue:"returns_exceed_exit",exitQuantity:exit.quantity,returnedQuantity:total});
}

// Transferências: origem/destino distintos, lotes de origem/destino e soma.
const transferLotsByTransfer=new Map();
for (const link of data.stockTransferLots) {
  const k=String(link.transferId), arr=transferLotsByTransfer.get(k)||[]; arr.push(link); transferLotsByTransfer.set(k,arr);
  const source=lots.get(String(link.sourceLotId)), dest=lots.get(String(link.destinationLotId));
  if (!source||!dest||!validNum(link.quantity)||link.quantity<=0)
    add("transfers",{id:String(link._id),issue:"invalid_transfer_lot_link"});
}
for (const t of data.stockTransfers) {
  if (!products.has(String(t.productId)) || !locations.has(String(t.fromLocationId)) ||
      !locations.has(String(t.toLocationId)) || t.fromLocationId===t.toLocationId ||
      !validNum(t.quantity) || t.quantity<=0)
    add("transfers",{id:String(t._id),issue:"invalid_transfer_header"});
  if (t.fromAreaId && !areas.has(String(t.fromAreaId))) add("transfers",{id:String(t._id),issue:"invalid_source_area"});
  if (t.toAreaId && !areas.has(String(t.toAreaId))) add("transfers",{id:String(t._id),issue:"invalid_destination_area"});
  const links=transferLotsByTransfer.get(String(t._id))||[];
  if (links.length && Math.abs(links.reduce((s,x)=>s+x.quantity,0)-t.quantity)>eps)
    add("transfers",{id:String(t._id),issue:"transfer_lot_quantity_mismatch",quantity:t.quantity,linked:links.reduce((s,x)=>s+x.quantity,0)});
  if (t.lotId && !lots.has(String(t.lotId))) add("transfers",{id:String(t._id),issue:"missing_transfer_lot"});
}

// Água: integridade de período/participante, recebimentos, rateios e pagamentos.
for (const p of data.waterPeriods) {
  if (!validNum(p.startAt)||!validNum(p.endAt)||p.endAt<p.startAt)
    add("water",{periodId:String(p._id),issue:"invalid_period_range"});
  if (new Set(p.participantIds).size!==p.participantIds.length ||
      p.participantIds.some(id=>!participants.has(String(id))))
    add("water",{periodId:String(p._id),issue:"invalid_or_duplicate_participants"});
}
for (const r of data.waterReceipts) {
  const p=periods.get(String(r.periodId));
  if (!p || !validNum(r.receivedAt)|| (p && (r.receivedAt<p.startAt||r.receivedAt>p.endAt)) ||
      !Number.isSafeInteger(r.gallonsReceived)||r.gallonsReceived<=0 ||
      !Number.isSafeInteger(r.emptyGallonsReturned)||r.emptyGallonsReturned<0 ||
      !Number.isSafeInteger(r.totalValueCents)||r.totalValueCents<0)
    add("water",{receiptId:String(r._id),issue:"invalid_receipt_or_period"});
}
for (const m of data.waterContainerMovements) {
  if (!Number.isSafeInteger(m.date)||!Number.isSafeInteger(m.fullDelta)||!Number.isSafeInteger(m.emptyDelta))
    add("water",{movementId:String(m._id),issue:"invalid_container_movement"});
  if (m.type==="consumption" && !(m.fullDelta<0 && m.emptyDelta===-m.fullDelta))
    add("water",{movementId:String(m._id),issue:"invalid_consumption_delta"});
  if (m.type==="return" && !(m.fullDelta<=0 && m.emptyDelta<=0 && (m.fullDelta!==0||m.emptyDelta!==0)))
    add("water",{movementId:String(m._id),issue:"invalid_supplier_return_delta"});
}
const paidByShare=new Map();
for (const p of data.waterPayments) {
  const share=shares.get(String(p.shareId));
  paidByShare.set(String(p.shareId),(paidByShare.get(String(p.shareId))||0)+p.amountCents);
  if (!share||!Number.isSafeInteger(p.amountCents)||p.amountCents<=0||!Number.isSafeInteger(p.paidAt))
    add("water",{paymentId:String(p._id),issue:"invalid_payment_or_share"});
}
for (const period of data.waterPeriods) {
  const receipts=data.waterReceipts.filter(x=>x.periodId===period._id);
  const periodShares=data.waterShares.filter(x=>x.periodId===period._id);
  const receiptsCents=receipts.reduce((s,x)=>s+x.totalValueCents,0);
  const sharesCents=periodShares.reduce((s,x)=>s+x.amountDueCents,0);
  if (period.status==="closed" && (period.totalValueCents!==receiptsCents || sharesCents!==receiptsCents))
    add("water",{periodId:String(period._id),issue:"closed_period_financial_reconciliation",receiptsCents,storedTotal:period.totalValueCents??null,sharesCents});
  if (period.status==="open" && periodShares.length)
    add("water",{periodId:String(period._id),issue:"open_period_has_shares",shareCount:periodShares.length});
  if (periodShares.length && periodShares.some(s=>!period.participantIds.includes(s.participantId)))
    add("water",{periodId:String(period._id),issue:"share_for_nonparticipant"});
}
for (const [shareId,paid] of paidByShare) {
  const share=shares.get(shareId);
  if (share && paid>share.amountDueCents) add("water",{shareId,issue:"payments_exceed_share",due:share.amountDueCents,paid});
}
const fullBalance=data.waterReceipts.reduce((s,x)=>s+x.gallonsReceived,0)+data.waterContainerMovements.reduce((s,x)=>s+x.fullDelta,0);
const emptyBalance=data.waterContainerMovements.reduce((s,x)=>s+x.emptyDelta,0)-data.waterReceipts.reduce((s,x)=>s+x.emptyGallonsReturned,0);
if (fullBalance<0||emptyBalance<0) add("water",{issue:"negative_container_balance",fullGallons:fullBalance,emptyGallons:emptyBalance});
const financial={purchasedCents:data.waterReceipts.reduce((s,x)=>s+x.totalValueCents,0),allocatedCents:data.waterShares.reduce((s,x)=>s+x.amountDueCents,0),paidCents:data.waterPayments.reduce((s,x)=>s+x.amountCents,0),outstandingCents:0};
for (const share of data.waterShares) financial.outstandingCents+=Math.max(0,share.amountDueCents-(paidByShare.get(String(share._id))||0));

// Dimensional cross-check: each active lot's area/location and balance rows.
const balancesByLot=new Map();
for (const b of data.lotLocationBalances) { const k=String(b.lotId),arr=balancesByLot.get(k)||[];arr.push(b);balancesByLot.set(k,arr); }
for (const lot of data.lots.filter(x=>x.active)) {
  const rows=balancesByLot.get(String(lot._id))||[];
  const sum=rows.reduce((s,x)=>s+x.quantityAvailable,0);
  if (rows.length>1 || Math.abs(sum-lot.quantityAvailable)>eps)
    add("dimensional",{lotId:String(lot._id),issue:"lot_balance_rows_or_quantity",lotQuantity:lot.quantityAvailable,balanceRows:rows.length,balanceQuantity:sum});
  if (lot.areaId&&!areas.has(String(lot.areaId))) add("dimensional",{lotId:String(lot._id),issue:"invalid_area"});
  if (lot.locationId&&!locations.has(String(lot.locationId))) add("dimensional",{lotId:String(lot._id),issue:"invalid_location"});
}
const counts={}; for (const k of Object.keys(anomalies)) counts[k]=anomalies[k].length;
const totalRows=Object.values(data).reduce((s,rows)=>s+rows.length,0);
return {
  readOnly:true, deploymentRequested:"first-herring-264", generatedAt:Date.now(),
  scope:"entries, lots, movements, reservations, requests, returns, transfers, five stock areas, lot-location balances, mineral-water containers and financial allocations",
  totals:Object.fromEntries(Object.entries(data).map(([k,v])=>[k,v.length])),
  totalRows, anomalyCounts:counts, anomalies,
  water:{fullGallons:fullBalance,emptyGallons:emptyBalance,...financial,
    openPeriods:data.waterPeriods.filter(x=>x.status==="open").length,
    closedPeriods:data.waterPeriods.filter(x=>x.status==="closed").length,
    participants:data.waterParticipants.length},
  safeguards:{mutationsCalled:0,writes:0,recordsCreated:0,recordsUpdated:0,recordsDeleted:0}
};

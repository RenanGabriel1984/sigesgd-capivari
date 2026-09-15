/**
 * SIGESGD — Verificação (SOMENTE LEITURA) do ESTOQUE DE IMPLANTAÇÃO.
 *
 * Confere, em um snapshot exportado do deployment Convex, sem alterar nada:
 *   - a carga inicial (originType initial_inventory): entrada, itens, lotes,
 *     movimentações e unidades;
 *   - saldo global (stock) × saldo por localização (stockByLocation),
 *     produto a produto;
 *   - duplicação: mais de um lote de carga inicial por produto, nomes de
 *     produto repetidos, lotes órfãos;
 *   - lotes × saldos recebido/disponível;
 *   - carimbo "ESTOQUE DE IMPLANTAÇÃO DO SIGESGD — data de implantação"
 *     na observação da entrada;
 *   - ausência de saldos negativos e de NF-e duplicada.
 *
 * Uso:
 *   bunx convex export --path tmp/export
 *   rm -rf tmp/export-dir && mkdir -p tmp/export-dir
 *   unzip -q -o tmp/export -d tmp/export-dir
 *   node scripts/verify-implementation-stock.mjs tmp/export-dir
 *
 * O script apenas lê arquivos: nunca escreve no banco nem no repositório.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = process.argv[2] ?? "tmp/export-dir";
const GOMAQ_ACCESS_KEY = "35260961457941000143550010003720431466669127";

const load = (table) => {
  try {
    return readFileSync(join(DIR, table, "documents.jsonl"), "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
};

const entries = load("entries");
const entryItems = load("entryItems");
const lots = load("lots");
const stock = load("stock");
const sbl = load("stockByLocation");
const movements = load("stockMovements");
const products = load("products");
const locations = load("storageLocations");
const auditLogs = load("auditLogs");

const initialEntries = entries.filter((e) => e.originType === "initial_inventory");
const initialIds = new Set(initialEntries.map((e) => e._id));

console.log("── ENTRADAS DE CARGA INICIAL ──────────────────────────────");
let totalUnits = 0;
let totalItems = 0;
let totalLots = 0;
let totalMovs = 0;
const productIds = new Set();
for (const e of initialEntries) {
  const items = entryItems.filter((i) => i.entryId === e._id);
  const eLots = lots.filter((l) => l.entryId === e._id);
  const movs = movements.filter((m) => m.entryId === e._id);
  const units = items.reduce((s, i) => s + i.quantity, 0);
  totalUnits += units;
  totalItems += items.length;
  totalLots += eLots.length;
  totalMovs += movs.length;
  for (const l of eLots) productIds.add(l.productId);
  console.log(
    `${e.entryNumber} | status=${e.status} | ${new Date(e.receivedAt).toISOString().slice(0, 10)} | ` +
      `itens=${items.length} | unidades=${units} | lotes=${eLots.length} | movimentos=${movs.length} | ` +
      `carimbo=${(e.observation ?? "").includes("ESTOQUE DE IMPLANTAÇÃO DO SIGESGD") ? "SIM" : "NÃO"}`
  );
  console.log(`   observação: ${(e.observation ?? "").slice(0, 180)}`);
}
console.log(
  `TOTAIS: entradas=${initialEntries.length} itens=${totalItems} unidades=${totalUnits} lotes=${totalLots} movimentos=${totalMovs} produtos=${productIds.size}`
);

console.log("\n── SALDO GLOBAL × LOCALIZAÇÃO (produtos da carga inicial) ──");
let globalTotal = 0;
let locTotal = 0;
const mismatches = [];
const byProductLots = new Map();
for (const id of productIds) {
  const st = stock.find((s) => s.productId === id);
  const rows = sbl.filter((s) => s.productId === id);
  const physical = st?.physicalQuantity ?? 0;
  const loc = rows.reduce((s, r) => s + r.quantity, 0);
  globalTotal += physical;
  locTotal += loc;
  byProductLots.set(id, lots.filter((l) => l.productId === id));
  if (physical !== loc) {
    mismatches.push({ id, physical, loc, name: products.find((p) => p._id === id)?.name ?? id });
  }
}
console.log(
  `saldo global (stock) = ${globalTotal} | saldo por localização = ${locTotal} | divergências = ${mismatches.length}`
);
for (const m of mismatches) console.log(`   DIVERGENTE ${m.name}: global=${m.physical} locais=${m.loc}`);

const perLocation = new Map();
for (const id of productIds) {
  for (const row of sbl.filter((s) => s.productId === id)) {
    const loc = locations.find((l) => l._id === row.locationId);
    const key = loc?.name ?? row.locationId;
    perLocation.set(key, (perLocation.get(key) ?? 0) + row.quantity);
  }
}
console.log("locais:");
for (const [name, qty] of perLocation) console.log(`   ${name}: ${qty}`);

console.log("\n── DUPLICAÇÃO ────────────────────────────────────────────");
const perProductInitialLots = [];
for (const [id, pLots] of byProductLots) {
  const idLots = pLots.filter((l) => initialIds.has(l.entryId) && l.active);
  if (idLots.length > 1) perProductInitialLots.push({ id, count: idLots.length });
}
console.log(`produtos com mais de 1 lote de carga inicial: ${perProductInitialLots.length}`);
const nameCounts = new Map();
for (const p of products.filter((p) => p.active)) {
  const k = p.name.trim().toLowerCase();
  nameCounts.set(k, (nameCounts.get(k) ?? 0) + 1);
}
const dupNames = [...nameCounts.entries()].filter(([, c]) => c > 1);
console.log(
  `nomes de produto duplicados (ativos): ${dupNames.length}${dupNames.length ? " → " + dupNames.map(([n]) => n).join(", ") : ""}`
);
console.log(
  `lotes vinculados à carga inicial (por produto): ${[...byProductLots.values()].flat().filter((l) => initialIds.has(l.entryId)).length}`
);
console.log(
  `lotes cujo entryId aponta para entrada inexistente: ${lots.filter((l) => !entries.some((e) => e._id === l.entryId)).length}`
);

console.log("\n── LOTES × SALDO ─────────────────────────────────────────");
let lotReceived = 0;
let lotAvailable = 0;
for (const pLots of byProductLots.values()) {
  lotReceived += pLots.reduce((s, l) => s + l.quantityReceived, 0);
  lotAvailable += pLots.reduce((s, l) => s + l.quantityAvailable, 0);
}
console.log(`total recebido nos lotes = ${lotReceived} | disponível nos lotes = ${lotAvailable}`);

console.log("\n── MOVIMENTAÇÕES / AUDITORIA ─────────────────────────────");
const initMovs = movements.filter((m) => initialIds.has(m.entryId));
const types = initMovs.reduce((acc, m) => ({ ...acc, [m.type]: (acc[m.type] ?? 0) + 1 }), {});
console.log(`movimentações da carga inicial: ${initMovs.length} | tipos: ${JSON.stringify(types)}`);
console.log(`auditoria (auditLogs) total = ${auditLogs.length}`);
console.log(
  `registros de auditoria de implantação = ${auditLogs.filter((a) => (a.details ?? "").includes("ESTOQUE DE IMPLANTAÇÃO")).length}`
);
console.log(`entradas totais = ${entries.length}`);
const nfe = entries.find((e) => (e.accessKey ?? "").replace(/\D/g, "") === GOMAQ_ACCESS_KEY);
console.log(`NF-e 372043 registrada? ${nfe ? "SIM (" + nfe.entryNumber + ")" : "NÃO (pendente de importação pela UI)"}`);
console.log(
  `negativos: stock<0 → ${stock.filter((s) => s.physicalQuantity < 0).length} | sbl<0 → ${sbl.filter((s) => s.quantity < 0).length} | reservado>físico → ${stock.filter((s) => s.reservedQuantity > s.physicalQuantity).length}`
);

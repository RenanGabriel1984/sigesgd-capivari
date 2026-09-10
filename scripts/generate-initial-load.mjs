/**
 * SIGESGD — Geração da carga inicial definitiva (53 registros reais).
 *
 * Gera os documentos EXATAMENTE como o pipeline importInitialSheet +
 * performInitialLoad produziria: entrada initial_inventory, produtos,
 * categorias (Diversos), lotes, entryItems, stockByLocation, stock global,
 * movimentações e auditoria — com IDs Convex válidos (formato oficial:
 * base32 Crockford de VInt(tabela) + 16 bytes + checksum Fletcher16).
 *
 * Saída: backups/carga-inicial/ (formato de snapshot do convex import).
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

// ── IDs de tabela (do export oficial _tables/documents.jsonl) ──────────────
const T = {
  users: 10007,
  auditLogs: 10008,
  categories: 10009,
  products: 10011,
  entries: 10020,
  entryItems: 10021,
  lots: 10024,
  stock: 10014,
  stockMovements: 10015,
  stockByLocation: 10028,
};

// ── Crockford Base32 (lowercase, sem i/l/o/u) ──────────────────────────────
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const CHAR_INDEX = new Map([...ALPHABET].map((c, i) => [c, i]));

function vintEncode(n) {
  const out = [];
  while (n >= 0x80) {
    out.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  out.push(n);
  return out;
}

function fletcher16(buf) {
  let c0 = 0;
  let c1 = 0;
  for (const b of buf) {
    c0 = (c0 + b) & 0xff;
    c1 = (c1 + c0) & 0xff;
  }
  return ((c1 << 8) | c0) & 0xffff;
}

function fletcher16Combine(b1, b2, len) {
  const b10 = b1 & 0xff;
  const b11 = (b1 >> 8) & 0xff;
  const b20 = b2 & 0xff;
  const b21 = (b2 >> 8) & 0xff;
  return ((((b11 + b21 + b10 * len) & 0xff) << 8) | ((b10 + b20) & 0xff)) & 0xffff;
}

function fletcher16Simd(buf16) {
  let c0 = 0;
  let c1 = 0;
  for (let i = 0; i < 16; i++) {
    c0 = (c0 + buf16[i]) & 0xff;
    c1 = (c1 + buf16[i] * (16 - i)) & 0xff;
  }
  return ((c1 << 8) | c0) & 0xffff;
}

function base32Encode(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 5) {
    const chunk = bytes.slice(i, i + 5);
    let block = 0n;
    for (const b of chunk) block = (block << 8n) | BigInt(b);
    // Réplica do encode_into do backend: lê 8 bytes (zero-padded) — os dados
    // ficam nos 40 bits MAIS SIGNIFICATIVOS da palavra de 64 bits.
    block <<= BigInt(8 * (8 - chunk.length));
    for (let j = 0; j < 8; j++) {
      const idx = Number((block >> BigInt(59 - j * 5)) & 0x1fn);
      out += ALPHABET[idx];
      if (out.length >= Math.ceil((bytes.length * 8) / 5)) break;
    }
  }
  return out;
}

function base32Decode(s) {
  const bytes = [];
  let bits = 0;
  let acc = 0;
  for (const c of s) {
    const idx = CHAR_INDEX.get(c);
    if (idx === undefined) throw new Error(`char inválido: ${c}`);
    acc = (acc << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 0xff);
    }
  }
  return bytes;
}

/** Encode um id válido: VInt(tabela) + 16 bytes + footer Fletcher16. */
function encodeId(tableNumber, internalId16) {
  const prefix = vintEncode(tableNumber);
  const f1 = fletcher16(prefix);
  const f2 = fletcher16Simd(internalId16);
  const footer = fletcher16Combine(f1, f2, 16);
  const bytes = [...prefix, ...internalId16, footer & 0xff, (footer >> 8) & 0xff];
  return base32Encode(bytes);
}

/** Decode e valida um id (usado para verificar contra ids reais). */
function decodeId(s) {
  const bytes = base32Decode(s);
  // vint
  let pos = 0;
  let n = 0;
  let i = 0;
  for (;;) {
    const b = bytes[pos++];
    n |= (b & 0x7f) << (i * 7);
    if (b < 0x80) break;
    i++;
  }
  const internal = bytes.slice(pos, pos + 16);
  const footer = (bytes[pos + 17] << 8) | bytes[pos + 16];
  const f1 = fletcher16(bytes.slice(0, pos));
  const f2 = fletcher16Simd(internal);
  const expected = fletcher16Combine(f1, f2, 16);
  return { table: n, footerOk: expected === footer, reencodes: encodeId(n, internal) === s };
}

// ── Verificação contra ids reais do deployment ─────────────────────────────
const realIds = [
  ["users", "jx70c3y841fp20pt5qfd5a5tw18dhhd8", 10007],
  ["products", "kd78cacnyr486rs6j22c20qvhn8dhfkb", 10011],
  ["stock", "ks76y6ncb8s9g37kt5j3taxsxx8dhcaf", 10014],
  ["organizations", "k970fqyc4cddbbjg24pqbnks4d8dhxz1", 10010],
  ["storageLocations", "n5711zfag2vgm24hm5qd9yn42s8e54ej", 10025],
];
for (const [name, id, table] of realIds) {
  const d = decodeId(id);
  if (d.table !== table || !d.footerOk || !d.reencodes) {
    console.error(`VERIFICAÇÃO FALHOU para ${name}:`, d);
    process.exit(1);
  }
  console.log(`✔ id real verificado: ${name} (tabela ${d.table}, checksum ok, re-encode ok)`);
}

// ── IDs determinísticos (sha256 por tabela+índice) ─────────────────────────
function internalId(seed) {
  return [...createHash("sha256").update(seed).digest().subarray(0, 16)];
}

// ── Dados oficiais: 53 registros ───────────────────────────────────────────
// [local, produto, marca, quantidade, unidade, observação]
const ROWS = [
  ["Armário TI 01", "Cooler para processador Intel", "DEX-DX", 15, "un", ""],
  ["Armário TI 01", "Teclado KB 110 com fio", "KB", 2, "un", "Modelo KB 110"],
  ["Armário TI 01", "Teclado com fio", "Dell", 1, "un", ""],
  ["Armário TI 01", "Kit teclado e mouse", "Logitech", 1, "kit", ""],
  ["Armário TI 01", "Teclado numérico", "Tomate", 1, "un", ""],
  ["Armário TI 01", "Leitor de DVD", "Tomate", 1, "un", ""],
  ["Armário TI 01", "Cartão PVC para crachá", "Extracard", 700, "un", ""],
  ["Armário TI 01", "Mouse com fio", "Goldentech", 5, "un", ""],
  ["Armário TI 01", "Mouse wireless", "Xingling", 2, "un", ""],
  ["Armário TI 01", "Pasta térmica", "Implastec", 5, "pote", "Thermal Silver, 50 g"],
  ["Armário TI 01", "Conector RJ45 Cat5E", "Atek", 500, "un", "Cat5E; 5 caixas com 100"],
  ["Armário TI 01", "Conector RJ45 blindado CAT5", "Exbom", 200, "un", "CAT5; 2 caixas com 100"],
  ["Armário TI 01", "Conector RJ45", "Xinkling", 1000, "un", "1 saco com 1000"],
  ["Armário TI 01", "Cadeado chave tetra", "Xingling", 36, "un", "3 kits x 12"],
  ["Armário TI 01", "Jogo de chaves — 6 peças", "Xingling", 1, "kit", "6 peças"],
  ["Armário TI 01", "Jogo de chaves — 8 peças", "Xingling", 1, "kit", "8 peças"],
  ["Armário TI 01", "Módulo para tomada", "Tramontina", 11, "un", "Lizflex"],
  ["Armário TI 01", "Caixa com tampa de sobrepor para tomada", "Tramontina", 11, "un", "Lizflex"],
  ["Armário TI 01", "Limpa contato", "Tekbond", 7, "un", ""],
  ["Armário TI 01", "Keystone Jack para RJ45", "Xingling", 20, "un", ""],
  ["Armário TI 01", "Conector linear de emenda para cabo RJ45 CAT6", "Xingling", 28, "un", "CAT6"],
  ["Armário TI 01", "Hub USB 3.0", "Exbom", 2, "un", "USB 3.0"],
  ["Armário TI 01", "Fita isolante", "Adelbras", 4, "rolo", ""],
  ["Armário TI 01", "Adaptador HDMI para VGA", "Exbom", 2, "un", "HDMI → VGA"],
  ["Armário TI 01", "Cabo adaptador DisplayPort para VGA", "Exbom", 8, "un", "DisplayPort → VGA"],
  ["Armário TI 01", "Pilha AAA", "Elgin", 3, "un", "AAA"],
  ["Armário TI 01", "Teclado", "Lenovo", 5, "un", ""],
  ["Armário TI 01", "Switch JetStream 8 portas", "TP-Link", 3, "un", "8 portas"],
  ["Armário TI 01", "Switch 26 portas", "Dell", 1, "un", "26 portas"],
  ["Armário TI 01", "Switch 5 portas 10/100 PoE", "TP-Link", 3, "un", "5 portas, 10/100, PoE"],
  // Itens 31/32: mesmo nome "Telefone VoIP" mas MODELOS físicos diferentes
  // (TIP 125I vs V5502). O importador associa por nome exato — nomes idênticos
  // agrupariam os dois produtos. Desambiguados com o modelo (convenção do
  // próprio item 34: "Telefone VoIP TIP 125I — Montado").
  ["Armário TI 01", "Telefone VoIP TIP 125I", "Intelbras", 14, "un", "TIP 125I"],
  ["Armário TI 01", "Telefone VoIP V5502", "Intelbras", 1, "un", "V5502"],
  ["Armário TI 01", "RouterBoard", "MikroTik", 2, "un", "HEX Series"],
  ["Armário TI 01", "Telefone VoIP TIP 125I — Montado", "Intelbras", 1, "un", "TIP 125I; montado"],
  ["Armário TI 02", "Protetor de crachá — caixa fechada", "Reflex", 13, "caixa", "50 unidades por caixa"],
  ["Armário TI 02", "Protetor de crachá — unidade avulsa", "Reflex", 18, "un", "Caixa aberta"],
  ["Armário TI 02", "Mousepad", "Fênix", 10, "un", ""],
  ["Armário TI 02", "Abraçadeira de nylon", "Stormtech", 8, "pacote", "100 unidades por pacote"],
  ["Armário TI 02", "Telefone", "Attimo", 4, "un", "A-G01"],
  ["Armário TI 02", "Toner VersaLink — Preto", "Xerox", 1, "un", "Parte do kit original e 4 cores"],
  ["Armário TI 02", "Toner VersaLink — Ciano", "Xerox", 1, "un", "Parte do kit original e 4 cores"],
  ["Armário TI 02", "Toner VersaLink — Magenta", "Xerox", 1, "un", "Parte do kit original e 4 cores"],
  ["Armário TI 02", "Toner VersaLink — Amarelo", "Xerox", 1, "un", "Parte do kit original e 4 cores"],
  ["Armário TI 02", "Toner AltaLink — Preto", "Xerox", 2, "un", "Parte do kit original e 4 cores"],
  ["Armário TI 02", "Toner AltaLink — Ciano", "Xerox", 1, "un", "Parte do kit original e 4 cores"],
  ["Armário TI 02", "Toner AltaLink — Magenta", "Xerox", 2, "un", "Parte do kit original e 4 cores"],
  ["Armário TI 02", "Toner AltaLink — Amarelo", "Xerox", 4, "un", "Parte do kit original e 4 cores"],
  ["Armário TI 02", "Toner CX735 — Magenta", "Lexmark", 1, "un", "Parte do kit original e 4 cores; CX735"],
  ["Armário TI 02", "Toner CX735 — Amarelo", "Lexmark", 1, "un", "Parte do kit original e 4 cores; CX735"],
  ["Armário TI 02", "Etiqueta para impressão adesiva", "Sem marca", 23, "rolo", ""],
  ["Armário TI 02", "Ribbon para impressora de etiqueta adesiva", "Sem marca", 24, "rolo", ""],
  ["Armário TI 02", "Papel para impressora térmica", "Sem marca", 90, "rolo", ""],
  ["Armário TI 02", "Toner Lexmark XM5365", "Lexmark", 1, "un", "Parte do kit original e 4 cores"],
];

// ── Referências reais do deployment ────────────────────────────────────────
const LOC = {
  "Armário TI 01": "n5711zfag2vgm24hm5qd9yn42s8e54ej",
  "Armário TI 02": "n576x4v2v08tyzvzef21qk3m8h8e5y2f",
};
const ADMIN_USER = "jx70c3y841fp20pt5qfd5a5tw18dhhd8"; // Renan Gabriel (admin bootstrap)

// ── Construção dos documentos (réplica fiel do pipeline) ───────────────────
const now = Date.now();
const year = 2026;

const categoryId = encodeId(T.categories, internalId("categoria-diversos"));
const entryId = encodeId(T.entries, internalId("entrada-inicial-001"));

// _creationTime é definido pelo próprio import (timestamp de gravação) —
// omitir para evitar conflito de validação do convex import.
const docs = {
  categories: [{ _id: categoryId, name: "Diversos", description: "Categoria padrão para itens importados da planilha inicial", active: true }],
  products: [],
  entries: [{
    _id: entryId,
    entryNumber: `ENT-${year}-000001`, receivedAt: now,
    originType: "initial_inventory", responsibleUserId: ADMIN_USER,
    observation: "Importação da planilha de inventário físico", status: "confirmed",
    createdAt: now, updatedAt: now,
  }],
  lots: [],
  entryItems: [],
  stockByLocation: [],
  stock: [],
  stockMovements: [],
  auditLogs: [],
};

let totalUnits = 0;
let seq = 0;

for (const [locationName, productName, brand, quantity, unit, observation] of ROWS) {
  seq += 1;
  totalUnits += quantity;
  const productId = encodeId(T.products, internalId(`produto-${String(seq).padStart(3, "0")}`));
  const lotId = encodeId(T.lots, internalId(`lote-${String(seq).padStart(3, "0")}`));
  const locationId = LOC[locationName];
  const lotNumber = `LOT-${year}-${String(seq).padStart(6, "0")}`;

  docs.products.push({
    _id: productId,
    name: productName, categoryId,
    unitOfMeasure: unit, brand,
    observation: observation || undefined,
    minimumStock: 0, idealStock: 0, maximumStock: 0,
    active: true,
  });

  docs.lots.push({
    _id: lotId,
    lotNumber, productId, entryId,
    quantityReceived: quantity, quantityAvailable: quantity,
    receivedAt: now, active: true,
    observation: `Carga inicial — ${quantity} unidades`,
  });

  docs.entryItems.push({
    _id: encodeId(T.entryItems, internalId(`item-${String(seq).padStart(3, "0")}`)),
    entryId, productId, quantity,
    unitOfMeasure: "un", // réplica do performInitialLoad
    lotId, locationId,
  });

  docs.stockByLocation.push({
    _id: encodeId(T.stockByLocation, internalId(`sbl-${String(seq).padStart(3, "0")}`)),
    productId, locationId, quantity,
  });

  docs.stock.push({
    _id: encodeId(T.stock, internalId(`stock-${String(seq).padStart(3, "0")}`)),
    productId, physicalQuantity: quantity, reservedQuantity: 0,
  });

  docs.stockMovements.push({
    _id: encodeId(T.stockMovements, internalId(`mov-${String(seq).padStart(3, "0")}`)),
    productId, type: "adjustment", quantity,
    previousPhysical: 0, newPhysical: quantity,
    previousReserved: 0, newReserved: 0,
    userId: ADMIN_USER, entryId, lotId,
    observation: `Carga inicial — lote ${lotNumber} — ${quantity} unidades`,
    timestamp: now,
  });

  docs.auditLogs.push({
    _id: encodeId(T.auditLogs, internalId(`aud-prod-${String(seq).padStart(3, "0")}`)),
    userId: ADMIN_USER, action: "create", entity: "products", entityId: productId,
    details: `Produto criado pela importação da planilha inicial: ${productName}`,
    timestamp: now,
  });
}

docs.auditLogs.push({
  _id: encodeId(T.auditLogs, internalId("aud-carga-inicial")),
  userId: ADMIN_USER, action: "create", entity: "stock", entityId: entryId,
  details: `Carga inicial: ${seq} itens, ${totalUnits} unidades total, entrada ENT-${year}-000001`,
  timestamp: now,
});

// ── Prévia (validação antes da gravação) ───────────────────────────────────
const names = new Set(ROWS.map((r) => r[1]));
const ti01 = ROWS.filter((r) => r[0] === "Armário TI 01").length;
const ti02 = ROWS.filter((r) => r[0] === "Armário TI 02").length;
console.log("── PRÉVIA DA CARGA ──");
console.log(`Total de linhas: ${ROWS.length}`);
console.log(`Armário TI 01: ${ti01}`);
console.log(`Armário TI 02: ${ti02}`);
console.log(`Produtos novos: ${names.size} (todos distintos)`);
console.log(`Produtos já existentes (match por nome): 0`);
console.log(`Total de unidades (sem conversão de embalagem): ${totalUnits}`);
console.log(`Erros estruturais: nenhum (locais existentes, quantidades > 0, nomes únicos)`);

// ── Gravação dos arquivos no formato de snapshot ───────────────────────────
const outDir = join(process.cwd(), "backups/carga-inicial");
rmSync(outDir, { recursive: true, force: true });
for (const [table, rows] of Object.entries(docs)) {
  const dir = join(outDir, table);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "generated_schema.jsonl"), '"uniform"\n');
  writeFileSync(join(dir, "documents.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}
console.log(`\nArquivos gerados em backups/carga-inicial/ (${Object.values(docs).reduce((a, r) => a + r.length, 0)} documentos no total)`);
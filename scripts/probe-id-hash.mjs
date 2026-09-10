import zlib from "node:zlib";

const pairs = {
  users: "jx",
  auditLogs: "k1",
  categories: "k5",
  organizations: "k9",
  products: "kd",
  requests: "kn",
  stock: "ks",
  stockMovements: "kx",
  storageLocations: "n5",
};

const B36 = "0123456789abcdefghijklmnopqrstuvwxyz";

function fnv1a32(s) {
  let h = 2166136261;
  for (const b of Buffer.from(s)) {
    h ^= b;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}
function djb2(s) {
  let h = 5381;
  for (const b of Buffer.from(s)) h = ((Math.imul(h, 33) + b) >>> 0) >>> 0;
  return h >>> 0;
}
function sdbm(s) {
  let h = 0;
  for (const b of Buffer.from(s)) h = ((b + (h << 6) + (h << 16) - h) >>> 0) >>> 0;
  return h >>> 0;
}
function java31(s) {
  let h = 0;
  for (const b of Buffer.from(s)) h = ((Math.imul(h, 31) + b) >>> 0) >>> 0;
  return h >>> 0;
}

function crc32(s) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (const b of Buffer.from(s)) crc = (crc >>> 8) ^ table[(crc ^ b) & 0xff];
  return (crc ^ -1) >>> 0;
}

// Try many ways of deriving 2 base36 chars from a 32-bit hash.
const transforms = [
  ["lo12", (h) => B36[(h >> 6) & 35] + B36[h & 35]],
  ["hi12", (h) => B36[(h >> 22) & 35] + B36[(h >> 16) & 35]],
  ["loBytePair", (h) => B36[h & 35] + B36[(h >> 8) & 35]],
  ["b2+b3", (h) => B36[(h >> 8) & 35] + B36[(h >> 16) & 35]],
  ["byte1byte0", (h) => B36[(h >> 24) & 35] + B36[(h >> 16) & 35]],
  ["mid", (h) => B36[(h >> 12) & 35] + B36[(h >> 20) & 35]],
];

const hashes = { crc32, fnv1a32, djb2, sdbm, java31 };

for (const [hname, fn] of Object.entries(hashes)) {
  for (const [tname, tr] of transforms) {
    const results = {};
    let ok = true;
    for (const [table, code] of Object.entries(pairs)) {
      const cand = tr(fn(table));
      results[table] = cand;
      if (cand !== code) ok = false;
    }
    if (ok) console.log(`MATCH: ${hname} + ${tname} -> ${JSON.stringify(results)}`);
  }
}
console.log("done");
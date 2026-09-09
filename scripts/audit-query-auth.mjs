// Auditoria de autenticação: lista queries públicas cujo handler
// não chama nenhum helper `require*` (requireUser/requireAdmin/etc).
// Uso: bun scripts/audit-query-auth.mjs
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = "src/convex";
const files = readdirSync(dir).filter(
  (f) => f.endsWith(".ts") && !f.startsWith("_generated") && f !== "schema.ts" && f !== "http.ts" && f !== "auth.ts"
);

const results = [];
for (const file of files) {
  const src = readFileSync(join(dir, file), "utf8");
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^export const ([a-zA-Z0-9_]+) = query\(\{/);
    if (!m) continue;
    const name = m[1];
    // Percorre o corpo da query até o fechamento no nível 0
    let depth = 0;
    let started = false;
    let handlerBody = "";
    let sawHandler = false;
    for (let j = i; j < lines.length; j++) {
      const line = lines[j];
      for (const ch of line) {
        if (ch === "{") { depth++; started = true; if (depth === 2 && line.includes("handler")) sawHandler = true; }
        if (ch === "}") { depth--; }
      }
      if (sawHandler && started) handlerBody += line + "\n";
      if (started && depth === 0 && j > i) break;
    }
    const hasGate = /require[A-Za-z]*\s*\(/.test(handlerBody);
    // Não sinaliza funções marcadas como internas
    if (!hasGate) results.push({ file, name, line: i + 1 });
  }
}

if (results.length === 0) {
  console.log("OK: todas as queries públicas possuem gating de autenticação.");
} else {
  console.log(`SEM GATING (${results.length}):`);
  for (const r of results) console.log(`  ${r.file}:${r.line}  ${r.name}`);
}

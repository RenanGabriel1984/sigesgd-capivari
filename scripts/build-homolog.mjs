#!/usr/bin/env bun
/**
 * R32.0 — Build do frontend de HOMOLOGAÇÃO do SIGESGD.
 *
 * Gera um artefato estático que fale com um deployment Convex ISOLADO e
 * comprova, com a mesma função que o app usa em runtime, que a build resolve
 * para esse backend — nunca para o deployment oficial.
 *
 * Uso:
 *   VITE_CONVEX_URL=https://<staging>.convex.cloud \
 *   VITE_APP_ENV=homologacao \
 *   bun scripts/build-homolog.mjs [--dry-run]
 *
 * Backend permitido (allowlist fixa):
 *   tame-alligator-797.convex.cloud — projeto sigesgd-capivari-homologacao.
 *
 * Variáveis opcionais:
 *   HOMOLOG_OUT_DIR          pasta de saída (padrão: dist-homolog)
 *   BLOCKED_CONVEX_HOSTS     hosts adicionais proibidos, separados por espaço
 *
 * O script NÃO publica, NÃO faz deploy de funções e NÃO executa mutações no
 * banco: apenas valida a configuração e compila o frontend.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const ROOT = resolve(import.meta.dir, "..");

const HOMOLOG_CONVEX_HOST = "tame-alligator-797.convex.cloud";
const BLOCKED_CONVEX_HOSTS = (
  process.env.BLOCKED_CONVEX_HOSTS ??
  [
    "savory-sockeye-292.convex.cloud",
    "first-herring-264.convex.cloud",
    "first-starling-943.convex.cloud",
    "brilliant-bullfrog-982.convex.cloud",
    "first-dinosaur-625.convex.cloud",
  ].join(" ")
)
  .split(/\s+/)
  .filter(Boolean);

const OUT_DIR = process.env.HOMOLOG_OUT_DIR ?? "dist-homolog";
const rawUrl = (process.env.VITE_CONVEX_URL ?? "").trim();
const appEnv = (process.env.VITE_APP_ENV ?? "").trim().toLowerCase();

const APP_VERSION =
  readFileSync(resolve(ROOT, "src", "lib", "danfe-diagnostics.ts"), "utf8").match(
    /APP_VERSION\s*=\s*"([^"]+)"/,
  )?.[1] ?? "desconhecida";

const fail = (message) => {
  console.error(`✖ ${message}`);
  process.exit(1);
};

if (!rawUrl) {
  fail(
    "VITE_CONVEX_URL não definida — aponte explicitamente para o deployment de homologação.",
  );
}

if (appEnv !== "homologacao") {
  fail(
    `VITE_APP_ENV deve ser "homologacao" (recebido: "${appEnv || "vazio"}"). ` +
      "Sem isso o diagnóstico não comprova o ambiente.",
  );
}

let url;
try {
  url = new URL(rawUrl);
} catch {
  fail("VITE_CONVEX_URL inválida (esperado https://<deployment>.convex.cloud).");
}

const host = url.host;

if (
  BLOCKED_CONVEX_HOSTS.some(
    (blocked) => host === blocked || host.endsWith(`.${blocked}`),
  )
) {
  fail(
    `backend ${host} está na lista de hosts bloqueados (${BLOCKED_CONVEX_HOSTS.join(", ")}).`,
  );
}

if (host !== HOMOLOG_CONVEX_HOST) {
  fail(
    `destino de homologação recusado: ${host}. O único host permitido é ${HOMOLOG_CONVEX_HOST}.`,
  );
}

// Valida com a MESMA função que o app usa em runtime (src/lib/convex-url.ts).
// O import é dinâmico porque o módulo avalia a URL no carregamento e falha
// fechado; aqui queremos a mensagem limpa em vez de stack trace.
let convexHost;
let resolved;
try {
  const mod = await import("../src/lib/convex-url.ts");
  convexHost = mod.convexHost;
  resolved = mod.resolveConvexUrl(process.env);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

if (convexHost(resolved) !== host) {
  fail(
    `resolvedor do app devolveu ${convexHost(resolved) ?? "nada"} para esta configuração, ` +
      `mas o build apontaria para ${host}.`,
  );
}

console.log("── Build de homologação (R32.0) ──");
console.log(`backend   : ${host}`);
console.log(`ambiente  : homologacao`);
console.log(`versão app: ${APP_VERSION}`);
console.log(`saída     : ${OUT_DIR}`);
console.log(`bloqueados: ${BLOCKED_CONVEX_HOSTS.join(", ")}`);
console.log(`allowlist : ${HOMOLOG_CONVEX_HOST}`);

if (dryRun) {
  console.log("\nDRY RUN — configuração válida; nada compilado, nada publicado.");
  process.exit(0);
}

const run = (cmd, cmdArgs) => {
  const result = spawnSync(cmd, cmdArgs, {
    stdio: "inherit",
    cwd: ROOT,
    env: process.env,
  });
  if (result.status !== 0) fail(`falhou: ${cmd} ${cmdArgs.join(" ")}`);
};

run("bunx", ["tsc", "-b", "--noEmit"]);
run("bunx", ["vite", "build", "--outDir", OUT_DIR]);

// ── Comprovação no artefato gerado ───────────────────────────────────────────
const indexPath = resolve(OUT_DIR, "index.html");
if (!existsSync(indexPath)) fail(`artefato sem index.html em ${OUT_DIR}`);

const html = readFileSync(indexPath, "utf8");
const entry = html.match(/src="\/?(assets\/index-[A-Za-z0-9_-]+\.js)"/)?.[1];
if (!entry) fail("não foi possível localizar o bundle de entrada no index.html");

const entrySource = readFileSync(resolve(OUT_DIR, entry), "utf8");
const buildId = entry.match(/index-([A-Za-z0-9_-]+)\.js/)?.[1] ?? "desconhecido";

if (!entrySource.includes(`https://${host}`)) {
  fail(`o bundle ${entry} não contém o backend ${host} — configuração não foi embutida.`);
}

if (!entrySource.includes("homologacao")) {
  fail("o bundle não contém o rótulo de ambiente homologacao — VITE_APP_ENV não foi aplicada.");
}

console.log("\n── Artefato de homologação pronto ──");
console.log(`build    : ${buildId}`);
console.log(`backend  : ${host}`);
console.log(`ambiente : homologacao`);
console.log(`versão   : ${APP_VERSION}`);
console.log(`pasta    : ${OUT_DIR}`);
console.log(
  "\nPróximo passo (publicação) é do proprietário da conta: servir esta pasta em uma URL de teste separada da produção.",
);
console.log(
  "Nenhum deploy de funções e nenhuma mutação de banco foram executados por este script.",
);

import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";

const DEPLOYMENT = "first-herring-264";
const HOST = "first-herring-264.convex.cloud";
const deployKey = process.env.CONVEX_DEPLOY_KEY ?? "";
if (deployKey.split("|", 1)[0] !== `dev:${DEPLOYMENT}`) {
  throw new Error("Chave ausente ou incompatível: o teste aceita exclusivamente dev:first-herring-264.");
}
if (process.env.CONVEX_DEPLOYMENT) {
  throw new Error("CONVEX_DEPLOYMENT está definida; execução bloqueada para evitar destino implícito.");
}

const runId = `gha-${process.env.GITHUB_RUN_ID ?? "local"}-${process.env.GITHUB_RUN_ATTEMPT ?? "1"}`;
const results = [];
let seeded = false;
let fixture;

function run(args, label) {
  const result = spawnSync("bunx", ["convex", "run", ...args], {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${label} falhou (exit ${result.status}): ${(result.stderr || result.stdout).slice(-2500)}`);
  }
  const output = result.stdout.trim();
  try {
    return JSON.parse(output);
  } catch {
    const candidates = output.split("\n").reverse();
    for (const candidate of candidates) {
      try { return JSON.parse(candidate); } catch { /* tenta a próxima linha */ }
    }
    throw new Error(`${label} não retornou JSON válido: ${output.slice(-1500)}`);
  }
}

function internal(name, args = {}) {
  return run([name, JSON.stringify(args)], name);
}

function asOperator(identity, name, args) {
  return run(["--identity", JSON.stringify(identity), name, JSON.stringify(args)], name);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertState(state, expected, label) {
  assert(state.exists, `${label}: fixture não encontrada.`);
  assert(state.ledgerBalanced, `${label}: ledger divergente.`);
  assert(state.global === expected.global, `${label}: global esperado ${expected.global}, obtido ${state.global}.`);
  assert(state.local === expected.global, `${label}: soma dos armários não concilia.`);
  assert(state.lot === expected.global && state.lotLocal === expected.global, `${label}: lotes/armários não conciliam.`);
  assert(state.reserved === 0, `${label}: reserva inesperada.`);
  const byId = new Map(state.locationTotals.map((row) => [row.locationId, row.quantity]));
  assert(byId.get(fixture.fromLocationId) === expected.from, `${label}: origem esperada ${expected.from}.`);
  assert(byId.get(fixture.toLocationId) === expected.to, `${label}: destino esperado ${expected.to}.`);
  results.push({ label, global: state.global, from: expected.from, to: expected.to, ledgerBalanced: state.ledgerBalanced });
  return state;
}

function snapshot() {
  return internal("stockDevTransactionTests:inspect", { runId });
}

function expectFailure(fn, label, pattern) {
  try {
    fn();
  } catch (error) {
    const message = String(error);
    assert(pattern.test(message), `${label}: falhou por motivo inesperado: ${message}`);
    results.push({ label, rejectedAsExpected: true });
    return;
  }
  throw new Error(`${label}: a operação inválida foi aceita.`);
}

let failure;
try {
  fixture = internal("stockDevTransactionTests:seed", { runId });
  seeded = true;
  assert(fixture.runId === runId && fixture.exitIds.length === 3 && fixture.operatorId,
    "Fixture criada com estrutura inesperada.");
  const identity = { subject: fixture.operatorId, issuer: "https://sigesgd-capivari.dev" };
  results.push({ label: "fixture criada", operatorRole: fixture.operatorRole, isolatedProduct: true });

  let state = assertState(snapshot(), { global: 53, from: 33, to: 20 }, "baseline isolada");

  // Transferência: muda a distribuição física, sem alterar global, reservas ou total do lote.
  asOperator(identity, "stockTransfers:create", {
    productId: fixture.productId,
    lotId: fixture.lotId,
    fromLocationId: fixture.fromLocationId,
    toLocationId: fixture.toLocationId,
    quantity: 5,
    observation: `Validação transacional DEV ${runId}`,
  });
  state = assertState(snapshot(), { global: 53, from: 28, to: 25 }, "transferência de 5 unidades");
  assert(state.transferCount === 1 && state.movementCounts.transfer === 1 &&
    state.transferLinksValid && state.transferAllocations === 1,
  "Transferência não deixou vínculo completo no ledger.");

  const beforeRejectedTransfer = JSON.stringify(state);
  expectFailure(() => asOperator(identity, "stockTransfers:create", {
    productId: fixture.productId, lotId: fixture.lotId,
    fromLocationId: fixture.fromLocationId, toLocationId: fixture.toLocationId,
    quantity: 999, observation: "Teste negativo — saldo insuficiente",
  }), "bloqueio de transferência acima do saldo", /insuficiente|quantidade|transfer/i);
  assert(JSON.stringify(snapshot()) === beforeRejectedTransfer,
    "A tentativa de transferência inválida alterou os saldos.");

  // Devolução parcial de saída real sintética, com alocação explícita de lote e armário.
  const exit1 = fixture.exitIds[0];
  const returned1 = asOperator(identity, "returns:create", {
    exitMovementId: exit1,
    quantity: 2,
    reason: "Devolução de material não utilizado — teste DEV",
    condition: "unused",
    locationId: fixture.toLocationId,
    lotAllocations: [{ lotId: fixture.lotId, sourceLocationId: fixture.fromLocationId, quantity: 2 }],
    observation: `Validação transacional DEV ${runId}`,
  });
  state = assertState(snapshot(), { global: 55, from: 28, to: 27 }, "devolução parcial disponível");
  assert(state.returnCount === 1 && state.movementCounts.return === 1 &&
    state.returnAllocations === 1 && state.returnReversalAllocations === 1 &&
    state.unresolvedReturnMovements === 0,
  "Devolução disponível não criou movimento reversor e alocação estruturada.");

  const beforeOverReturn = JSON.stringify(state);
  expectFailure(() => asOperator(identity, "returns:create", {
    exitMovementId: exit1,
    quantity: 3,
    reason: "Teste negativo — excede saldo devolvível",
    condition: "unused",
    locationId: fixture.toLocationId,
    lotAllocations: [{ lotId: fixture.lotId, sourceLocationId: fixture.fromLocationId, quantity: 3 }],
  }), "bloqueio de devolução acima do saldo da saída", /devol|quantidade|saldo|excede/i);
  assert(JSON.stringify(snapshot()) === beforeOverReturn,
    "A tentativa de devolução acima do limite alterou os saldos.");

  // Quarentena: entrada em quarentena não recompõe o disponível; aprovação da inspeção recompõe.
  const quarantineReturn = asOperator(identity, "returns:create", {
    exitMovementId: fixture.exitIds[1],
    quantity: 1,
    reason: "Material devolvido para inspeção — teste DEV",
    condition: "defective",
    locationId: fixture.toLocationId,
    lotAllocations: [{ lotId: fixture.lotId, sourceLocationId: fixture.fromLocationId, quantity: 1 }],
  });
  state = snapshot();
  assertState(state, { global: 55, from: 28, to: 27 }, "devolução enviada à quarentena");
  assert(state.quarantineCount === 1, "Devolução defeituosa não ficou em quarentena.");
  asOperator(identity, "returns:resolveQuarantine", {
    returnId: quarantineReturn,
    disposition: "available",
    reason: "Inspeção aprovada — teste DEV",
  });
  state = assertState(snapshot(), { global: 56, from: 28, to: 28 }, "liberação da quarentena");
  assert(state.quarantineCount === 0 && state.movementCounts.return === 2 &&
    state.returnReversalAllocations === 2 && state.unresolvedReturnMovements === 0,
  "Liberação da quarentena não recompôs o ledger com movimento reversor.");

  // Descarte: encerra a quarentena sem reincorporar qualquer quantidade.
  const disposalReturn = asOperator(identity, "returns:create", {
    exitMovementId: fixture.exitIds[2],
    quantity: 1,
    reason: "Material defeituoso para descarte — teste DEV",
    condition: "defective",
    locationId: fixture.toLocationId,
    lotAllocations: [{ lotId: fixture.lotId, sourceLocationId: fixture.fromLocationId, quantity: 1 }],
  });
  state = snapshot();
  assertState(state, { global: 56, from: 28, to: 28 }, "devolução pendente de descarte");
  assert(state.quarantineCount === 1, "Devolução para descarte não entrou em quarentena.");
  asOperator(identity, "returns:resolveQuarantine", {
    returnId: disposalReturn,
    disposition: "disposed",
    reason: "Inspeção confirmou impossibilidade de reaproveitamento — teste DEV",
  });
  state = assertState(snapshot(), { global: 56, from: 28, to: 28 }, "descarte sem recomposição do saldo");
  assert(state.quarantineCount === 0 && state.returnCount === 3 &&
    state.movementCounts.transfer === 1 && state.movementCounts.return === 2 &&
    state.returnAllocations === 3,
  "Contagem final de devoluções, transferências ou alocações não corresponde ao cenário.");
  results.push({ label: "cenários transacionais aprovados", transfer: true, partialReturn: true,
    overReturnBlocked: true, quarantineRelease: true, disposalWithoutStockIncrease: true });
} catch (error) {
  failure = error;
} finally {
  try {
    internal("stockDevTransactionTests:cleanup", { runId });
    const remaining = snapshot();
    assert(remaining.exists === false, "A limpeza terminou, mas a fixture ainda existe.");
    results.push({ label: "limpeza verificada", fixtureRemaining: false });
  } catch (cleanupError) {
    failure = new Error(`${failure ? String(failure) + " | " : ""}Falha na limpeza: ${String(cleanupError)}`);
  }
}

const report = {
  deployment: DEPLOYMENT,
  host: HOST,
  runId,
  seeded,
  passed: !failure,
  results,
  failure: failure ? String(failure) : undefined,
};
console.log(JSON.stringify(report, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = [
    "### Validação transacional controlada — Convex DEV",
    "",
    "- Deployment: `dev:first-herring-264`",
    "- Fixture isolada: " + (seeded ? "criada" : "não criada"),
    "- Cenários aprovados: " + results.filter((row) => row.ledgerBalanced || row.rejectedAsExpected || row.label === "cenários transacionais aprovados").length,
    "- Limpeza final: " + (results.some((row) => row.label === "limpeza verificada") ? "confirmada" : "não confirmada"),
    "",
    "| Etapa | Resultado |",
    "|---|---|",
    ...results.map((row) => `| ${row.label} | ${row.ledgerBalanced ? `global ${row.global}; armários ${row.from} + ${row.to}; conciliado` : row.rejectedAsExpected ? "bloqueio correto" : row.fixtureRemaining === false ? "nenhum registro de fixture" : "aprovado"} |`),
  ];
  if (failure) lines.push("", "**Falha:** " + String(failure));
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
}
if (failure) throw failure;

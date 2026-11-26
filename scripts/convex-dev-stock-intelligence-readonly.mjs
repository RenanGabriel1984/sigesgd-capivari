import { spawnSync } from "node:child_process";

const DEPLOYMENT = "first-herring-264";
const key = process.env.CONVEX_DEPLOY_KEY ?? "";

if (key.split("|", 1)[0] !== `dev:${DEPLOYMENT}` || process.env.CONVEX_DEPLOYMENT) {
  throw new Error("Destino DEV não validado.");
}

function run(args, label) {
  const result = spawnSync("bunx", ["convex", "run", ...args], {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 8e6,
  });
  if (result.status !== 0) {
    throw new Error(label + ": " + (result.stderr || result.stdout).slice(-1800));
  }

  const output = result.stdout.trim();
  if (!output) return null;
  try {
    return JSON.parse(output);
  } catch {
    for (const line of output.split("\n").reverse()) {
      try {
        return JSON.parse(line);
      } catch {
        // Continue until a JSON result line is found.
      }
    }
    throw new Error("JSON inválido: " + label);
  }
}

const internal = (name, args = {}) => run([name, JSON.stringify(args)], name);
const pub = (identity, name, args = {}) =>
  run(["--identity", JSON.stringify(identity), name, JSON.stringify(args)], name);
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

function totals(readiness) {
  const products = readiness.report.products ?? [];
  return products.reduce(
    (sum, product) => ({
      global: sum.global + (product.globalPhysical ?? 0),
      local: sum.local + (product.localPhysicalTotal ?? 0),
      lots: sum.lots + (product.lotsAvailableTotal ?? 0),
    }),
    { global: 0, local: 0, lots: 0 },
  );
}

function validateOrganizationWindow(window, label) {
  for (const field of [
    "bySecretaria",
    "byDepartment",
    "byUnit",
    "byProduct",
    "byCategory",
    "hierarchy",
  ]) {
    assert(Array.isArray(window?.[field]), `Relatório ${label}: campo ${field} inválido.`);
  }
  assert(Number.isFinite(window.totalQuantity), `Relatório ${label}: totalQuantity inválido.`);
  assert(Number.isFinite(window.totalExitCount), `Relatório ${label}: totalExitCount inválido.`);
}

const before = internal("stockSetup:lotLocationMigrationReadinessInternal");
assert(before.readOnly === true && before.migrationApplied === false, "Snapshot inicial não é somente leitura.");

const identity = {
  subject: internal("stockIntelligenceDevTests:identity").userId,
  issuer: "https://sigesgd-capivari.dev",
};

const replenishment = pub(identity, "stockIntelligence:replenishment");
const consumption = pub(identity, "stockIntelligence:consumption", { period: "30d" });
assert(
  Array.isArray(replenishment.rows) &&
    replenishment.counters &&
    typeof replenishment.counters === "object",
  "Relatório de reposição inválido.",
);
assert(
  consumption.period === "30d" &&
    Array.isArray(consumption.summaries) &&
    Array.isArray(consumption.series) &&
    Number.isFinite(consumption.totalQuantity) &&
    Number.isFinite(consumption.totalExits),
  "Relatório de consumo inválido.",
);

const periods = ["15d", "30d", "90d", "6m", "12m"];
const organizationReports = {};
for (const period of periods) {
  const organization = pub(identity, "stockIntelligence:consumptionByOrganization", { period });
  assert(organization.period === period, `Período ${period} não foi respeitado.`);
  validateOrganizationWindow(organization.current, `atual (${period})`);
  validateOrganizationWindow(organization.previous, `anterior (${period})`);
  organizationReports[period] = {
    current: {
      secretarias: organization.current.bySecretaria.length,
      departments: organization.current.byDepartment.length,
      units: organization.current.byUnit.length,
      products: organization.current.byProduct.length,
      categories: organization.current.byCategory.length,
      hierarchyRows: organization.current.hierarchy.length,
      totalQuantity: organization.current.totalQuantity,
      totalExitCount: organization.current.totalExitCount,
    },
    previous: {
      secretarias: organization.previous.bySecretaria.length,
      departments: organization.previous.byDepartment.length,
      units: organization.previous.byUnit.length,
      products: organization.previous.byProduct.length,
      categories: organization.previous.byCategory.length,
      hierarchyRows: organization.previous.hierarchy.length,
      totalQuantity: organization.previous.totalQuantity,
      totalExitCount: organization.previous.totalExitCount,
    },
  };
}

const after = internal("stockSetup:lotLocationMigrationReadinessInternal");
const ledgerBefore = totals(before);
const ledgerAfter = totals(after);
assert(
  JSON.stringify(ledgerBefore) === JSON.stringify(ledgerAfter),
  "As consultas de inteligência alteraram os saldos entre a leitura anterior e a posterior.",
);

console.log(
  JSON.stringify(
    {
      passed: true,
      deployment: DEPLOYMENT,
      readOnly: true,
      products: before.report.products.length,
      replenishmentRows: replenishment.rows.length,
      counters: replenishment.counters,
      consumption: {
        period: consumption.period,
        quantity: consumption.totalQuantity,
        exits: consumption.totalExits,
        withoutHistory: consumption.withoutHistory,
        seriesPoints: consumption.series.length,
      },
      organizationReports,
      ledgerBefore,
      ledgerAfter,
    },
    null,
    2,
  ),
);

/**
 * Planejamento seguro da migração lote × local físico.
 *
 * A função é pura: não acessa Convex e não grava dados. Ela transforma o
 * diagnóstico read-only em um plano de inserções, bloqueando qualquer estado
 * ambíguo, divergente, incompleto ou aritmeticamente inconsistente.
 */
export type LotLocationMigrationReport = {
  readOnly: boolean;
  migrationApplied: boolean;
  summary: {
    lots: { withAvailableQuantity: number; quantityAvailableTotal: number };
    globalStock: { physicalQuantityTotal: number; reservedQuantityTotal: number; invalidRecords: number };
    stockByLocation: { physicalQuantityTotal: number; invalidRecords: number };
    lotLocationBalances: { records: number; quantityAvailableTotal: number; invalidRecords: number };
  };
  products: Array<{
    productId: string;
    productName: string;
    globalPhysical: number;
    globalReserved: number;
    globalError: string | null;
    localPhysicalTotal: number;
    lotsAvailableTotal: number;
    mappedLotTotal: number;
    candidateLotTotal: number;
    candidateTotalsAlign: boolean;
    invalidLotCount: number;
    invalidBalanceCount: number;
    duplicateBalanceScopeCount: number;
    orphanBalanceCount: number;
    localComparison: Array<{
      locationId: string;
      physicalQuantity: number;
      mappedLotQuantity: number;
      candidateLotQuantity: number;
      duplicatePhysicalRows: number;
    }>;
    lots: Array<{
      lotId: string;
      lotNumber: string;
      quantityAvailable: number;
      status: string;
      candidateLocationId: string | null;
      mappedLocations: Array<{ locationId: string; quantity: number }>;
    }>;
  }>;
};

export type LotLocationMigrationRow = {
  lotId: string;
  productId: string;
  locationId: string;
  quantityAvailable: number;
  lotNumber: string;
};

export type LotLocationMigrationPlan = {
  rows: LotLocationMigrationRow[];
  insertions: LotLocationMigrationRow[];
  alreadyMapped: number;
  totalLots: number;
  totalQuantity: number;
};

const EPSILON = 1e-9;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Migração lote × armário bloqueada: ${message}`);
}

/**
 * Exige que o diagnóstico cubra integralmente os saldos atuais e devolve
 * somente os vínculos candidatos inequívocos. Registros já mapeados e idênticos
 * são tratados como concluídos (idempotência); qualquer conflito aborta.
 */
export function buildLotLocationMigrationPlan(
  report: LotLocationMigrationReport,
  expected = { lotCount: 61, totalQuantity: 3338 },
): LotLocationMigrationPlan {
  assert(report?.readOnly === true, "a origem não é um diagnóstico somente leitura.");
  assert(report?.migrationApplied === false, "o diagnóstico indica uma migração já aplicada ou estado inesperado.");

  const summary = report.summary;
  assert(summary.globalStock.invalidRecords === 0, "há registros globais inválidos.");
  assert(summary.stockByLocation.invalidRecords === 0, "há registros por armário inválidos.");
  assert(summary.lotLocationBalances.invalidRecords === 0, "há saldos lote × armário inválidos.");
  assert(
    summary.lots.withAvailableQuantity === expected.lotCount,
    `esperados ${expected.lotCount} lotes com saldo; encontrados ${summary.lots.withAvailableQuantity}.`,
  );
  assert(
    Math.abs(summary.lots.quantityAvailableTotal - expected.totalQuantity) <= EPSILON,
    `saldo dos lotes esperado ${expected.totalQuantity}; encontrado ${summary.lots.quantityAvailableTotal}.`,
  );
  assert(
    Math.abs(summary.globalStock.physicalQuantityTotal - expected.totalQuantity) <= EPSILON,
    "o total global não corresponde ao total esperado.",
  );
  assert(
    Math.abs(summary.stockByLocation.physicalQuantityTotal - expected.totalQuantity) <= EPSILON,
    "o total por armário não corresponde ao total esperado.",
  );
  assert(
    summary.globalStock.reservedQuantityTotal >= 0 &&
      summary.globalStock.reservedQuantityTotal <= summary.globalStock.physicalQuantityTotal,
    "o total reservado é inválido.",
  );

  const rows: LotLocationMigrationRow[] = [];
  const insertions: LotLocationMigrationRow[] = [];
  const seenLots = new Set<string>();
  let alreadyMapped = 0;

  for (const product of report.products) {
    assert(!product.globalError, `${product.productName}: ${product.globalError}`);
    assert(product.invalidLotCount === 0, `${product.productName}: há lote inválido.`);
    assert(product.invalidBalanceCount === 0, `${product.productName}: há saldo lote × armário inválido.`);
    assert(product.duplicateBalanceScopeCount === 0, `${product.productName}: há escopo de saldo duplicado.`);
    assert(product.orphanBalanceCount === 0, `${product.productName}: há saldo órfão.`);
    assert(product.candidateTotalsAlign, `${product.productName}: candidato + mapeado não reconcilia com os saldos.`);
    assert(
      Math.abs(product.globalPhysical - product.localPhysicalTotal) <= EPSILON,
      `${product.productName}: saldo global difere do saldo por armário.`,
    );
    assert(
      Math.abs(product.globalPhysical - product.lotsAvailableTotal) <= EPSILON,
      `${product.productName}: saldo global difere dos lotes disponíveis.`,
    );

    for (const location of product.localComparison) {
      assert(location.duplicatePhysicalRows === 0, `${product.productName}: saldo físico duplicado no armário ${location.locationId}.`);
      assert(
        Math.abs(location.physicalQuantity - location.mappedLotQuantity - location.candidateLotQuantity) <= EPSILON,
        `${product.productName}: saldo não conciliado no armário ${location.locationId}.`,
      );
    }

    for (const lot of product.lots) {
      assert(!seenLots.has(lot.lotId), `o lote ${lot.lotNumber} aparece mais de uma vez no diagnóstico.`);
      seenLots.add(lot.lotId);
      assert(Number.isFinite(lot.quantityAvailable) && lot.quantityAvailable > 0, `o lote ${lot.lotNumber} possui quantidade inválida.`);

      let row: LotLocationMigrationRow;
      if (lot.status === "candidate") {
        assert(!!lot.candidateLocationId, `o lote ${lot.lotNumber} não tem armário candidato.`);
        row = {
          lotId: lot.lotId,
          productId: product.productId,
          locationId: lot.candidateLocationId,
          quantityAvailable: lot.quantityAvailable,
          lotNumber: lot.lotNumber,
        };
        insertions.push(row);
      } else if (lot.status === "mapped") {
        assert(lot.mappedLocations.length === 1, `o lote ${lot.lotNumber} não possui exatamente um armário mapeado.`);
        const mapped = lot.mappedLocations[0];
        assert(
          Math.abs(mapped.quantity - lot.quantityAvailable) <= EPSILON,
          `o lote ${lot.lotNumber} tem quantidade mapeada divergente.`,
        );
        row = {
          lotId: lot.lotId,
          productId: product.productId,
          locationId: mapped.locationId,
          quantityAvailable: lot.quantityAvailable,
          lotNumber: lot.lotNumber,
        };
        alreadyMapped++;
      } else {
        throw new Error(`Migração lote × armário bloqueada: lote ${lot.lotNumber} está em estado "${lot.status}".`);
      }
      rows.push(row);
    }
  }

  assert(rows.length === expected.lotCount, `o plano contém ${rows.length} lotes, mas deveria conter ${expected.lotCount}.`);
  const totalQuantity = rows.reduce((sum, row) => sum + row.quantityAvailable, 0);
  assert(Math.abs(totalQuantity - expected.totalQuantity) <= EPSILON, "a soma dos vínculos não corresponde ao total esperado.");

  assert(
    summary.lotLocationBalances.records === alreadyMapped,
    "a quantidade de registros persistidos não corresponde aos lotes já mapeados.",
  );
  assert(
    Math.abs(summary.lotLocationBalances.quantityAvailableTotal - rows
      .filter((row) => !insertions.some((candidate) => candidate.lotId === row.lotId))
      .reduce((sum, row) => sum + row.quantityAvailable, 0)) <= EPSILON,
    "a soma dos saldos já persistidos diverge dos lotes mapeados.",
  );

  return { rows, insertions, alreadyMapped, totalLots: rows.length, totalQuantity };
}

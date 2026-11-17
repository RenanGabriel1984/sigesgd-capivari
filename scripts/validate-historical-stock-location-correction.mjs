import { readFileSync, writeFileSync } from "node:fs";

function readJsonOutput(path) {
  const raw = readFileSync(path, "utf8");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error(`Não foi possível localizar JSON válido em ${path}.`);
  }
  return JSON.parse(raw.slice(start, end + 1));
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

const mode = process.argv[2];

if (mode === "dry-run") {
  const [inputPath, outputPath] = process.argv.slice(3);
  if (!inputPath || !outputPath) {
    throw new Error("Uso: dry-run <relatório> <arquivo-de-argumentos>");
  }

  const report = readJsonOutput(inputPath);
  requireCondition(report.mode === "DRY_RUN_ONLY", "O relatório não é DRY_RUN_ONLY.");
  requireCondition(report.readOnly === true, "O dry-run não confirmou readOnly=true.");
  requireCondition(report.writesPerformed === 0, "O dry-run registrou gravações.");
  requireCondition(
    report.totals?.totalMovements === 63 &&
      report.totals?.movementsWithoutLocation === 63 &&
      report.totals?.proposed === 61 &&
      report.totals?.excludedForReview === 2,
    "O conjunto de dados mudou em relação ao dry-run aprovado (63/61/2).",
  );

  const ids = report.proposedChanges?.map((row) => row.movementId) ?? [];
  requireCondition(ids.length === 61, `Esperados 61 IDs; recebidos ${ids.length}.`);
  requireCondition(new Set(ids).size === 61, "O dry-run contém IDs duplicados.");
  requireCondition(ids.every((id) => typeof id === "string" && id.length > 0), "ID inválido no dry-run.");

  writeFileSync(
    outputPath,
    JSON.stringify({
      expectedMovementIds: ids.sort(),
      confirmation: "APLICAR-61-CORRECOES-LOCALIZACAO",
    }),
  );
  console.log("DRY-RUN validado: 61 propostas únicas, 2 casos excluídos, zero gravações.");
  process.exit(0);
}

if (mode === "verify") {
  const [mutationPath, auditPath, logsPath, argsPath] = process.argv.slice(3);
  if (!mutationPath || !auditPath || !logsPath || !argsPath) {
    throw new Error("Uso: verify <resultado-mutation> <auditoria> <logs> <argumentos>");
  }

  const mutation = readJsonOutput(mutationPath);
  const audit = readJsonOutput(auditPath);
  const logs = readJsonOutput(logsPath);
  const args = JSON.parse(readFileSync(argsPath, "utf8"));
  const expectedIds = [...args.expectedMovementIds].sort();

  requireCondition(mutation.applied === true, "A mutation não confirmou applied=true.");
  requireCondition(
    mutation.corrected === 61 &&
      mutation.movementsPatched === 61 &&
      mutation.auditLogsCreated === 61 &&
      mutation.otherMovementFieldsChanged === 0,
    "Resultado da mutation não corresponde às 61 correções aprovadas.",
  );
  const correctedIds = [...(mutation.correctedMovementIds ?? [])].sort();
  requireCondition(
    correctedIds.length === 61 &&
      correctedIds.every((id, index) => id === expectedIds[index]),
    "A mutation retornou IDs diferentes dos IDs aprovados.",
  );
  requireCondition(
    mutation.correctedByLocation?.["Armário TI 01"] === 34 &&
      mutation.correctedByLocation?.["Armário TI 02"] === 27,
    "A distribuição por armário difere da distribuição aprovada (34/27).",
  );

  const totals = audit.totals ?? {};
  requireCondition(
    audit.readOnly === true &&
      totals.movements === 63 &&
      totals.withRecordedLocation === 61 &&
      totals.missingLocation === 2 &&
      totals.invalidLocationReference === 0 &&
      totals.unresolvedLotReference === 0 &&
      totals.ambiguousLotReference === 0 &&
      totals.productLotMismatch === 0 &&
      totals.entryLotMismatch === 0 &&
      totals.missingUserReference === 0 &&
      totals.missingProductReference === 0 &&
      totals.invalidEntryReference === 0 &&
      totals.invalidAllocationReferences === 0 &&
      totals.allocationQuantityMismatch === 0,
    "A auditoria após a correção não confirmou os totais esperados.",
  );
  requireCondition(
    audit.missingLocationByType?.exit === 1 &&
      audit.missingLocationByType?.return === 1,
    "Os dois movimentos excluídos não permaneceram exatamente como saída e devolução.",
  );

  const logIds = [...(logs.movementIds ?? [])].sort();
  requireCondition(
    logs.count === 61 &&
      logIds.length === 61 &&
      new Set(logIds).size === 61 &&
      logIds.every((id, index) => id === expectedIds[index]),
    "Os 61 auditLogs individuais não correspondem exatamente aos movimentos corrigidos.",
  );

  console.log(
    JSON.stringify(
      {
        verified: true,
        corrected: 61,
        auditLogs: 61,
        remainingWithoutLocation: 2,
        excluded: { exit: 1, return: 1 },
        correctedByLocation: mutation.correctedByLocation,
        otherMovementFieldsChanged: 0,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

throw new Error("Modo inválido. Use dry-run ou verify.");

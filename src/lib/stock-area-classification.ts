import {
  GOMAQ_ENTRY_NUMBER,
  GOMAQ_INVOICE_NUMBER,
  INITIAL_ENTRY_NUMBER,
  INITIAL_STOCK_MANIFEST,
  type InitialStockAreaName,
} from "@/lib/stock-regularization-manifest";

export type HistoricalAreaLotEvidence = {
  lotId: string;
  lotNumber: string;
  productName: string;
  areaId: string | null;
  sourceEntry: { entryNumber: string; invoiceNumber: string | null } | null;
  entryItemEvidence: Array<{
    entryItemId: string;
    productName: string;
    quantity: number;
    unitOfMeasure: string | null;
    locationId: string | null;
    locationName: string | null;
    lotId: string | null;
  }>;
};

export type HistoricalAreaClassificationPlan = {
  patches: Array<{ lotId: string; lotNumber: string; areaId: string; areaName: InitialStockAreaName }>;
  alreadyClassified: number;
  blockers: Array<{ lotId: string; lotNumber: string; reason: string }>;
};

const normalize = (value: string | null | undefined) =>
  (value ?? "").normalize("NFKC").trim().toLocaleLowerCase("pt-BR");

const digits = (value: string | null | undefined) => (value ?? "").replace(/\D/g, "");

/**
 * Classifica somente lotes cuja origem documental coincide integralmente com
 * o manifesto de carga inicial ou com a NF Gomaq conhecida. Não usa apenas
 * nome do produto e nunca reclassifica silenciosamente uma área já definida.
 */
export function buildHistoricalAreaClassificationPlan(
  lots: HistoricalAreaLotEvidence[],
  activeAreas: Array<{ areaId: string; name: string; active: boolean }>,
): HistoricalAreaClassificationPlan {
  const activeByName = new Map(
    activeAreas.filter((area) => area.active).map((area) => [normalize(area.name), area]),
  );
  const patches: HistoricalAreaClassificationPlan["patches"] = [];
  const blockers: HistoricalAreaClassificationPlan["blockers"] = [];
  let alreadyClassified = 0;

  for (const lot of lots) {
    const block = (reason: string) => blockers.push({ lotId: lot.lotId, lotNumber: lot.lotNumber, reason });
    if (lot.areaId) {
      const existingArea = activeAreas.find((area) => area.areaId === lot.areaId && area.active);
      if (existingArea) {
        alreadyClassified++;
        continue;
      }
      block("Área atual inexistente ou inativa; não será substituída automaticamente.");
      continue;
    }
    const source = lot.sourceEntry;
    const item = lot.entryItemEvidence.length === 1 ? lot.entryItemEvidence[0] : null;
    if (!source || !item || item.lotId !== lot.lotId || normalize(item.productName) !== normalize(lot.productName)) {
      block("Origem não possui vínculo único e íntegro entre lote, entrada e item.");
      continue;
    }

    let areaName: InitialStockAreaName | null = null;
    if (source.entryNumber === INITIAL_ENTRY_NUMBER) {
      const matches = INITIAL_STOCK_MANIFEST.filter((row) =>
        normalize(row.productName) === normalize(item.productName) &&
        row.quantity === item.quantity &&
        normalize(row.unitOfMeasure) === normalize(item.unitOfMeasure) &&
        normalize(row.locationName) === normalize(item.locationName),
      );
      if (matches.length !== 1) {
        block(matches.length === 0
          ? "Item não corresponde univocamente ao manifesto da carga inicial."
          : "Item corresponde a mais de uma linha do manifesto da carga inicial.");
        continue;
      }
      areaName = matches[0].areaName;
    } else if (
      source.entryNumber === GOMAQ_ENTRY_NUMBER &&
      digits(source.invoiceNumber) === GOMAQ_INVOICE_NUMBER &&
      normalize(item.productName) === normalize("Kit teclado e mouse") &&
      item.quantity === 25 &&
      normalize(item.unitOfMeasure) === "kit" &&
      !!item.locationId
    ) {
      areaName = "Impressoras";
    } else {
      block("Entrada de origem não pertence a uma fonte histórica classificada.");
      continue;
    }

    const area = activeByName.get(normalize(areaName));
    if (!area) {
      block(`A área ativa "${areaName}" não existe.`);
      continue;
    }
    if (lot.areaId && lot.areaId !== area.areaId) {
      block(`Área atual diverge da classificação documental "${areaName}".`);
      continue;
    }
    if (lot.areaId === area.areaId) {
      alreadyClassified++;
      continue;
    }
    patches.push({ lotId: lot.lotId, lotNumber: lot.lotNumber, areaId: area.areaId, areaName });
  }

  return { patches, alreadyClassified, blockers };
}

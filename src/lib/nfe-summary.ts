/**
 * SIGESGD Capivari — AVANÇO DA CONFERÊNCIA E RESUMO DA ENTRADA (R31.9).
 *
 * Módulo PURO (sem React/Convex) que concentra a regra de negócio da etapa
 * de conferência de produtos da NF-e:
 *
 *  • `evaluateNfeAdvance` — único portão para sair da conferência: exige ao
 *    menos um item, TODOS os itens associados e quantidade real (> 0). Quando
 *    falha, informa a mensagem e o índice da primeira linha que precisa de
 *    atenção — a tela rola até ela em vez de fechar o diálogo.
 *  • `buildNfeEntrySummary` — monta o modelo de apresentação do resumo
 *    (nota, fornecedor, chave, AF/processo/empenho, itens com quantidade,
 *    unidade, unitário, total, local e lote, e o total geral).
 *
 * NENHUMA função daqui cria produto, entrada, movimentação ou altera estoque:
 * confirmar a entrada continua sendo uma ação explícita no fluxo existente
 * (`api.entries.create` + `api.entries.confirm`).
 */
import {
  canContinueNfeReview,
  pendingNfeItemsSummary,
  type NfeItem,
  type ProductMatchStatus,
} from "@/lib/nfe";

/** Etapas da conferência: produtos → resumo. */
export type NfeEntryStep = "products" | "summary";

export interface NfeAdvanceRow {
  item: NfeItem;
  productId?: string;
  matchStatus: ProductMatchStatus;
  locationId?: string;
  supplierLot?: string;
}

export type NfeAdvanceResult =
  | { ok: true }
  | {
      ok: false;
      reason: "empty" | "pending" | "invalid-quantity";
      message: string;
      /** Índice da linha que precisa de atenção (-1 quando não há linha). */
      firstPendingIndex: number;
      pending: string[];
    };

/**
 * Regra única de avanço da conferência (R31.9 Parte A).
 * O avanço nunca fecha a tela nem cria dados: só decide se o resumo pode
 * abrir e, quando não pode, aponta exatamente a linha pendente.
 */
export function evaluateNfeAdvance(
  rows: ReadonlyArray<NfeAdvanceRow>,
): NfeAdvanceResult {
  if (rows.length === 0) {
    return {
      ok: false,
      reason: "empty",
      message:
        "A NF-e não tem itens identificados — informe os itens antes de avançar para o resumo.",
      firstPendingIndex: -1,
      pending: [],
    };
  }

  if (
    !canContinueNfeReview(
      rows.map((row) => ({
        productId: row.productId,
        matchStatus: row.matchStatus,
      })),
    )
  ) {
    const pending = pendingNfeItemsSummary(rows);
    return {
      ok: false,
      reason: "pending",
      message:
        pending.length > 0
          ? `Itens que precisam de atenção: ${pending.join(" | ")} — associe (ou cadastre) o produto antes de avançar.`
          : "Há itens sem produto associado — associe todos os itens antes de avançar.",
      firstPendingIndex: rows.findIndex(
        (row) => !row.productId || row.matchStatus !== "found",
      ),
      pending,
    };
  }

  const invalidQuantityIndex = rows.findIndex(
    (row) => !(Number(row.item.quantity) > 0),
  );
  if (invalidQuantityIndex >= 0) {
    const row = rows[invalidQuantityIndex];
    return {
      ok: false,
      reason: "invalid-quantity",
      message: `Informe a quantidade real do item ${row.item.lineNumber ?? invalidQuantityIndex + 1} (cód. ${row.item.code || "—"}) antes de avançar.`,
      firstPendingIndex: invalidQuantityIndex,
      pending: [],
    };
  }

  return { ok: true };
}

/** Item como aparece no resumo da entrada. */
export interface NfeSummaryItem {
  lineNumber: number;
  productId: string;
  productName: string;
  supplierCode: string;
  description: string;
  ncm?: string;
  cst?: string;
  quantity: number;
  unit: string;
  unitValue?: number;
  totalValue?: number;
  locationName?: string;
  supplierLot?: string;
}

export interface NfeEntrySummaryData {
  number: string;
  series: string;
  /** Data em ISO (estado interno) — a tela formata para DD/MM/AAAA. */
  emissionDate: string;
  supplierName: string | null;
  supplierCnpj: string | null;
  accessKey: string;
  afNumber: string;
  processNumber: string;
  empenhoNumber: string;
  items: NfeSummaryItem[];
  /** Total geral da nota (valor do documento; soma dos itens como fallback). */
  total: number;
  totalFromDocument: boolean;
}

/**
 * Monta o modelo do resumo a partir dos MESMOS dados da conferência — nada é
 * recalculado a partir do OCR e nenhum valor é inventado: quando o documento
 * não trouxe unidade/valor, o campo fica vazio.
 */
export function buildNfeEntrySummary(input: {
  nfe: {
    number: string;
    series: string;
    emissionDate: string;
    accessKey?: string;
    totalValue?: number;
  };
  rows: ReadonlyArray<NfeAdvanceRow>;
  products: ReadonlyArray<{ _id: string; name: string }>;
  locations?: ReadonlyArray<{ _id: string; name: string }>;
  supplier?: { legalName: string; cnpj?: string | null } | null;
  afNumber?: string;
  processNumber?: string;
  empenhoNumber?: string;
}): NfeEntrySummaryData {
  const locations = input.locations ?? [];
  const items: NfeSummaryItem[] = input.rows.map((row) => {
    const product = input.products.find(
      (candidate) => candidate._id === row.productId,
    );
    const location = locations.find(
      (candidate) => candidate._id === row.locationId,
    );
    return {
      lineNumber: row.item.lineNumber,
      productId: row.productId ?? "",
      productName: product?.name ?? "Produto não associado",
      supplierCode: row.item.code ?? "",
      description: row.item.description ?? "",
      ncm: row.item.ncm,
      cst: row.item.cst,
      quantity: row.item.quantity,
      unit: row.item.unit ?? "",
      unitValue: row.item.unitValue,
      totalValue: row.item.totalValue,
      locationName: location?.name,
      supplierLot: row.supplierLot || undefined,
    };
  });

  const sumOfItems = items.reduce(
    (total, item) => total + (item.totalValue ?? 0),
    0,
  );
  const documentTotal = input.nfe.totalValue;
  const hasDocumentTotal =
    typeof documentTotal === "number" && Number.isFinite(documentTotal);

  return {
    number: input.nfe.number ?? "",
    series: input.nfe.series ?? "",
    emissionDate: input.nfe.emissionDate ?? "",
    supplierName: input.supplier?.legalName ?? null,
    supplierCnpj: input.supplier?.cnpj ?? null,
    accessKey: input.nfe.accessKey ?? "",
    afNumber: input.afNumber ?? "",
    processNumber: input.processNumber ?? "",
    empenhoNumber: input.empenhoNumber ?? "",
    items,
    total: hasDocumentTotal ? documentTotal : sumOfItems,
    totalFromDocument: hasDocumentTotal,
  };
}

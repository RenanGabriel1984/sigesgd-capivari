/**
 * Gestão de Estoque SGGD — CAMADA DE EXPORTAÇÃO GOMAQ (adaptador puro).
 *
 * SEPARAÇÃO DE RESPONSABILIDADES (não negociável):
 *
 *   SIGESGD (fonte de verdade)  →  estrutura interna: produtos, estoque,
 *                                  parâmetros, equipamentos, solicitações.
 *   Planilha Gomaq (formato)    →  documento EXTERNO de saída.
 *
 * Este arquivo é a ÚNICA ponte. Ele NÃO altera o modelo interno nem o modelo
 * original da Gomaq: apenas mapeia campos internos para as células do
 * formulário. Nenhum produto é criado, nenhum saldo é alterado e nenhuma
 * movimentação é gerada na exportação.
 *
 * ─── MODELO GOMAQ (layout do documento fornecido) ──────────────────────────
 *   Cabeçalho:     Nome do solicitante · Telefone · Data
 *   Entrega:       Razão social · CNPJ/CPF · Endereço · Complemento/andar ·
 *                  Bairro · Cidade/UF · CEP · Contato
 *   Tabela:        Modelo do equipamento · Estoque dos suprimentos cheios ·
 *                  Estoque dos suprimentos vazios · Número de série das
 *                  máquinas · Quantidade solicitada
 *
 * Observação do modelo original: a quantidade solicitada representa a
 * necessidade para UM MÊS de produção. Essa semântica vem do fornecedor e é
 * apenas transportada — o SIGESGD não redefine o significado do número.
 */

/** Cabeçalho do formulário Gomaq. */
export interface GomaqHeader {
  requesterName: string | null;
  requesterPhone: string | null;
  /** ISO date string (yyyy-mm-dd) ou null quando ainda não gerado. */
  date: string | null;
}

/** Bloco de dados de entrega. */
export interface GomaqDeliveryBlock {
  legalName: string | null;
  cnpj: string | null;
  address: string | null;
  addressComplement: string | null;
  district: string | null;
  cityUf: string | null;
  cep: string | null;
  contact: string | null;
}

/** Uma linha da tabela de suprimentos do modelo Gomaq. */
export interface GomaqSupplyRow {
  equipmentModel: string | null;
  /** Estoque do suprimento CHEIO (disponível no SIGESGD). */
  fullStock: number;
  /** Estoque vazio/carcaça para devolução — vem do módulo de logística reversa. */
  emptyStock: number;
  /** Números de série das máquinas compatíveis com este suprimento. */
  machineSerials: string[];
  /** Necessidade para um mês de produção (quantidade solicitada). */
  requestedQuantity: number;
}

/** Documento completo pronto para virar planilha. */
export interface GomaqExportDocument {
  header: GomaqHeader;
  delivery: GomaqDeliveryBlock;
  rows: GomaqSupplyRow[];
  /** Rótulo do período da solicitação, ex.: "03/2026". */
  period: string | null;
}

/** Internal SIGESGD item → linha do modelo Gomaq. */
export interface InternalSupplyItem {
  productName: string;
  /** Saldo disponível real (físico − reservado). */
  availableQuantity: number;
  /** Carcaças/vazios registrados no módulo de logística reversa. */
  emptyQuantity: number;
  equipmentModel: string | null;
  /** Números de série dos equipamentos compatíveis (do parque cadastrado). */
  equipmentSerials: string[];
  /** Quantidade solicitada pelo operador (NÃO a sugestão do sistema). */
  requestedQuantity: number;
}

const orEmpty = (value: string | null | undefined): string => (value ?? "").trim();

/**
 * Formata "cidade/UF" quando as duas partes são conhecidas.
 * O documento interno já traz o par pronto; a função existe para chamadas que
 * possuem cidade e UF separadas.
 */
export function formatCityUf(city: string | null, state: string | null): string {
  const c = orEmpty(city);
  const s = orEmpty(state);
  if (c && s) return `${c}/${s}`;
  return c || s;
}

/**
 * Monta o documento de exportação a partir dos dados INTERNOS.
 *
 * Mapeamento 1:1, sem enriquecimento: nenhum número é estimado ou inventado.
 * Campo interno ausente vira célula vazia — nunca zero inventado.
 */
export function buildGomaqExportDocument(input: {
  header: GomaqHeader;
  delivery: GomaqDeliveryBlock;
  items: InternalSupplyItem[];
  period: string | null;
}): GomaqExportDocument {
  return {
    header: {
      requesterName: orEmpty(input.header.requesterName) || null,
      requesterPhone: orEmpty(input.header.requesterPhone) || null,
      date: orEmpty(input.header.date) || null,
    },
    delivery: {
      legalName: orEmpty(input.delivery.legalName) || null,
      cnpj: orEmpty(input.delivery.cnpj) || null,
      address: orEmpty(input.delivery.address) || null,
      addressComplement: orEmpty(input.delivery.addressComplement) || null,
      district: orEmpty(input.delivery.district) || null,
      cityUf: orEmpty(input.delivery.cityUf) || null,
      cep: orEmpty(input.delivery.cep) || null,
      contact: orEmpty(input.delivery.contact) || null,
    },
    rows: input.items.map((item) => ({
      equipmentModel: orEmpty(item.equipmentModel) || null,
      fullStock: item.availableQuantity,
      emptyStock: item.emptyQuantity,
      machineSerials: item.equipmentSerials.filter((s) => s.trim().length > 0),
      // A quantidade solicitada é a do operador — a sugestão do sistema
      // NUNCA substitui este número na exportação.
      requestedQuantity: item.requestedQuantity,
    })),
    period: orEmpty(input.period) || null,
  };
}

/** Cabeçalho textual da planilha, na ordem do modelo original. */
export const GOMAQ_TABLE_HEADERS = [
  "Modelo do equipamento",
  "Estoque dos suprimentos cheios",
  "Estoque dos suprimentos vazios",
  "Número de série das máquinas",
  "Quantidade solicitada",
] as const;

/** Rótulos do bloco de entrega (ordem do modelo original). */
export const GOMAQ_DELIVERY_LABELS: Array<keyof GomaqDeliveryBlock> = [
  "legalName",
  "cnpj",
  "address",
  "addressComplement",
  "district",
  "cityUf",
  "cep",
  "contact",
];

export const GOMAQ_DELIVERY_LABELS_PT: Record<keyof GomaqDeliveryBlock, string> = {
  legalName: "Razão social",
  cnpj: "CNPJ/CPF",
  address: "Endereço",
  addressComplement: "Complemento/andar",
  district: "Bairro",
  cityUf: "Cidade/UF",
  cep: "CEP",
  contact: "Contato",
};

/**
 * Converte o documento exportável em uma matriz (array de linhas) pronta
 * para `xlsx`. Mantém a estrutura do modelo Gomaq: cabeçalho → entrega →
 * tabela. Nenhum valor do documento é recalculado aqui.
 */
export function gomaqDocumentToMatrix(
  doc: GomaqExportDocument
): Array<Array<string | number>> {
  const matrix: Array<Array<string | number>> = [];

  // ── Cabeçalho ──
  matrix.push(["Nome do solicitante", doc.header.requesterName ?? ""]);
  matrix.push(["Telefone", doc.header.requesterPhone ?? ""]);
  matrix.push(["Data", doc.header.date ?? ""]);
  matrix.push(["Período", doc.period ?? ""]);
  matrix.push([]);

  // ── Dados de entrega ──
  for (const key of GOMAQ_DELIVERY_LABELS) {
    matrix.push([GOMAQ_DELIVERY_LABELS_PT[key], doc.delivery[key] ?? ""]);
  }
  matrix.push([]);

  // ── Tabela de suprimentos ──
  matrix.push([...GOMAQ_TABLE_HEADERS]);
  for (const row of doc.rows) {
    matrix.push([
      row.equipmentModel ?? "",
      row.fullStock,
      row.emptyStock,
      row.machineSerials.join(", "),
      row.requestedQuantity,
    ]);
  }

  // ── Rodapé com a semântica do modelo do fornecedor ──
  matrix.push([]);
  matrix.push([
    "A quantidade solicitada representa a necessidade para um mês de produção.",
  ]);

  return matrix;
}

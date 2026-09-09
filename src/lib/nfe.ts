/**
 * SIGESGD CAPIVARI — Importação de NF-e XML
 *
 * Núcleo puro e testável da funcionalidade de importação de NF-e:
 *  - parseNfeXml: valida e extrai os dados estruturados do XML da NF-e;
 *  - mapNfeUnit: mapeia a unidade da NF (UN, PC, CX, KIT...) para as unidades do sistema;
 *  - findSupplierMatch: localiza o fornecedor existente (CNPJ ou razão social);
 *  - matchNfeProduct: classifica a correspondência produto da NF ↔ produto SIGESGD;
 *  - buildEntryDraftFromNfe: monta o rascunho da entrada (NUNCA altera estoque).
 *
 * REGRA FUNDAMENTAL: importar XML NÃO é entrada. Somente a confirmação
 * (entries.confirm) efetiva estoque, lote, movimentação e auditoria.
 */
import { XMLParser } from "fast-xml-parser";

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface NfeItem {
  /** Número do item na NF (nItem) */
  lineNumber: number;
  /** Código do produto do fornecedor (cProd) */
  code: string;
  /** Descrição do produto (xProd) */
  description: string;
  ncm?: string;
  cfop?: string;
  /** Unidade informada na NF (uCom) — preservada, sem conversão automática */
  unit: string;
  /** Quantidade (qCom) — preservada exatamente como informada */
  quantity: number;
  unitValue?: number;
  totalValue?: number;
  /** EAN/GTIN (cEAN) — pode ser "SEM GTIN" */
  ean?: string;
}

export interface NfeData {
  /** Chave de acesso (44 dígitos) — identificador único da NF */
  accessKey: string;
  /** Número da NF (nNF) */
  number: string;
  /** Série (serie) */
  series: string;
  /** Data de emissão (dhEmi/dEmi) — mantida como string "yyyy-mm-dd" */
  emissionDate: string;
  emitterCnpj?: string;
  emitterName?: string;
  natureOperation?: string;
  totalValue?: number;
  /** Informações complementares (infCpl) — pode conter pedido/contrato */
  additionalInfo?: string;
  /** Pedido/contrato detectado nas informações adicionais (melhor esforço) */
  orderReference?: string;
  items: NfeItem[];
}

export type ProductForMatch = {
  _id: string;
  name: string;
  internalCode?: string | null;
  brand?: string | null;
  model?: string | null;
  specification?: string | null;
};

export type SupplierForMatch = {
  _id: string;
  legalName: string;
  cnpj?: string | null;
};

export type ProductMatchStatus = "found" | "possible" | "not_found";

export interface ProductMatch {
  productId?: string;
  status: ProductMatchStatus;
  /** 0–100; >=100 encontrado, >=40 possível */
  score: number;
}

export interface NfeDraftItem {
  productId: string;
  quantity: number;
  unitOfMeasure: string;
  unitCost?: number;
  totalCost?: number;
  specification?: string;
  locationId?: string;
  supplierLotNumber?: string;
  supplierCode?: string;
  ncm?: string;
  cfop?: string;
  ean?: string;
}

export interface NfeDraft {
  invoiceNumber: string;
  series?: string;
  invoiceDate?: string;
  accessKey: string;
  supplierId?: string;
  contractNumber?: string;
  observation?: string;
  totalValue?: number;
  documentStorageId?: string;
  xmlStorageId?: string;
  items: NfeDraftItem[];
}

/**
 * Localiza uma entrada já registrada com a mesma chave de acesso (NF duplicada).
 * Usada como verificação prévia na UI; o backend (entries.create) é a garantia final.
 */
export function findEntryByAccessKey(
  entries: { _id: string; entryNumber: string; accessKey?: string | null }[],
  accessKey: string
): { _id: string; entryNumber: string } | undefined {
  const target = digitsOnly(accessKey);
  if (!target) return undefined;
  return entries.find((e) => e.accessKey && digitsOnly(e.accessKey) === target);
}

// ─── Helpers de texto ────────────────────────────────────────────────────────

const normalizeAccents = (s: string): string =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/** Normaliza para comparação: minúsculas, sem acentos, só alfanuméricos */
export const normalizeText = (s: string): string =>
  normalizeAccents((s ?? "").toLowerCase()).replace(/[^a-z0-9]+/g, " ").trim();

export const digitsOnly = (s: string): string => (s ?? "").replace(/\D/g, "");

/** Converte "1.0000", "1,5" ou "0.3333" em número */
export const parseNum = (raw: string | number | undefined | null): number | undefined => {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === "number") return isFinite(raw) ? raw : undefined;
  const trimmed = String(raw).trim();
  // "12.500,00" → milhar brasileiro: remove pontos, vírgula vira decimal
  const looksLikeThousands = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(trimmed);
  const parsed = parseFloat(looksLikeThousands ? trimmed.replace(/\./g, "").replace(",", ".") : trimmed.replace(",", "."));
  return isFinite(parsed) ? parsed : undefined;
};

// ─── Unidades ────────────────────────────────────────────────────────────────

const NF_UNIT_MAP: Record<string, string> = {
  UN: "un", UND: "un", UNID: "un", UNIDADE: "un", UNI: "un",
  PC: "pc", PÇ: "pc", PEC: "pc", PECA: "pc",
  CX: "cx", CAIXA: "cx",
  M: "m", METRO: "m", MT: "m",
  RL: "rl", ROLO: "rl",
  PCT: "pct", PACOTE: "pct",
  PO: "po", POTE: "po",
  KIT: "kt",
  L: "l", LITRO: "l", LITROS: "l",
  KG: "kg", GR: "g", G: "g", MG: "mg",
};

/**
 * Preserva a unidade informada na NF. Converte apenas a grafia
 * (UN → un, PC → pc, CX → cx, KIT → kt). Unidades desconhecidas
 * caem em "outro" — NUNCA converte quantidade (ex.: 90 UNI ≠ 2.700).
 */
export function mapNfeUnit(raw: string): string {
  const key = (raw ?? "").trim().toUpperCase().replace(/\s+/g, "");
  return NF_UNIT_MAP[key] ?? "outro";
}

/** Unidade desconhecida: preserva a grafia original na especificação */
export function unitNeedsMapping(raw: string): boolean {
  return mapNfeUnit(raw) === "outro";
}

// ─── Parser XML ──────────────────────────────────────────────────────────────

function firstString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return firstString(value[0]);
  return String(value).trim() || undefined;
}

/**
 * Extrai o texto de um nó que pode ser string ou objeto com #text
 * (ocorre quando o nó possui atributos).
 */
function nodeText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value.trim() || undefined;
  if (Array.isArray(value)) return nodeText(value[0]);
  if (typeof value === "object") {
    const any = value as Record<string, unknown>;
    return nodeText(any["#text"] ?? any["@_xText"]);
  }
  return undefined;
}

const PEDIDO_PATTERN = /(?:pedido|contrato|af|empenho|processo)\s*[:\s#º.]*\s*([0-9]{3,}[0-9a-zA-Z\-/]*)/i;

/**
 * Valida e interpreta um XML de NF-e.
 * Lança erro com mensagem amigável se o arquivo não for uma NF-e válida.
 * NÃO altera estoque — apenas leitura.
 */
export function parseNfeXml(xmlText: string): NfeData {
  if (!xmlText || !xmlText.trim()) throw new Error("Arquivo vazio. Selecione um XML de NF-e.");

  let doc: any;
  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      trimValues: true,
      parseTagValue: false,
      parseAttributeValue: false,
      removeNSPrefix: false,
    });
    doc = parser.parse(xmlText);
  } catch {
    throw new Error("Arquivo XML inválido. Não foi possível ler o conteúdo.");
  }

  const nfeProc = doc?.nfeProc;
  const nfe = nfeProc?.NFe ?? doc?.NFe ?? doc?.nfe;
  const infNFe = nfe?.infNFe;

  if (!infNFe || !infNFe.ide || !infNFe.emit || !infNFe.det) {
    throw new Error("O arquivo não é uma NF-e válida (estrutura <NFe>/<infNFe> não encontrada).");
  }

  const idAttr = firstString(infNFe["@_Id"]);
  const accessKey = idAttr ? idAttr.replace(/^NFe/i, "") : "";

  const ide = infNFe.ide;
  const emit = infNFe.emit;

  const dets: any[] = Array.isArray(infNFe.det) ? infNFe.det : infNFe.det ? [infNFe.det] : [];
  if (dets.length === 0) throw new Error("A NF-e não possui itens (det).");

  const items: NfeItem[] = dets.map((det: any, idx: number): NfeItem => {
    const prod = det?.prod ?? {};
    const lineRaw = firstString(det?.["@_nItem"]);
    const lineNumber = lineRaw ? parseInt(lineRaw, 10) : idx + 1;
    const eanRaw = firstString(prod.cEAN);
    return {
      lineNumber,
      code: firstString(prod.cProd) ?? "",
      description: firstString(prod.xProd) ?? "Item sem descrição",
      ncm: firstString(prod.NCM),
      cfop: firstString(prod.CFOP),
      unit: firstString(prod.uCom) ?? "UN",
      quantity: parseNum(prod.qCom) ?? 0,
      unitValue: parseNum(prod.vUnCom),
      totalValue: parseNum(prod.vProd),
      ean: eanRaw && eanRaw.toUpperCase() !== "SEM GTIN" ? eanRaw : undefined,
    };
  });

  const infCpl = nodeText(infNFe?.infAdic?.infCpl);
  const orderMatch = infCpl ? infCpl.match(PEDIDO_PATTERN) : null;

  const emissionRaw = firstString(ide.dhEmi) ?? firstString(ide.dEmi) ?? "";

  return {
    accessKey,
    number: firstString(ide.nNF) ?? "",
    series: firstString(ide.serie) ?? "",
    emissionDate: emissionRaw.slice(0, 10),
    emitterCnpj: firstString(emit.CNPJ),
    emitterName: firstString(emit.xNome),
    natureOperation: firstString(ide.natOp),
    totalValue: parseNum(nfe?.total?.ICMSTot?.vNF) ?? parseNum(infNFe?.total?.ICMSTot?.vNF),
    additionalInfo: infCpl,
    orderReference: orderMatch ? orderMatch[1] : undefined,
    items,
  };
}

// ─── Correspondência de fornecedor ───────────────────────────────────────────

export interface SupplierMatch {
  supplierId?: string;
  found: boolean;
  byCnpj: boolean;
}

/**
 * Localiza o fornecedor existente a partir da NF.
 * 1º: CNPJ exato; 2º: razão social normalizada.
 * Nunca cria fornecedor — retorna null para criação contextual/manual.
 */
export function findSupplierMatch(parsed: NfeData, suppliers: SupplierForMatch[]): SupplierMatch {
  const cnpj = parsed.emitterCnpj ? digitsOnly(parsed.emitterCnpj) : "";
  if (cnpj) {
    for (const s of suppliers) {
      if (s.cnpj && digitsOnly(s.cnpj) === cnpj) {
        return { supplierId: s._id, found: true, byCnpj: true };
      }
    }
  }
  const name = normalizeText(parsed.emitterName ?? "");
  if (name) {
    let best: SupplierForMatch | undefined;
    let bestScore = 0;
    for (const s of suppliers) {
      const score = similarity(normalizeText(s.legalName), name);
      if (score > bestScore) { bestScore = score; best = s; }
    }
    if (best && bestScore >= 0.9) {
      return { supplierId: best._id, found: true, byCnpj: false };
    }
  }
  return { found: false, byCnpj: false };
}

// ─── Correspondência de produtos ─────────────────────────────────────────────

function tokenize(s: string): string[] {
  return normalizeText(s).split(" ").filter((t) => t.length > 1);
}

/** Similaridade de Jaccard entre conjuntos de tokens */
function tokenOverlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  const union = new Set([...setA, ...setB]);
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter++;
  return inter / union.size;
}

/** Similaridade de bigramas para nomes curtos ("TONER" vs "TONER PRETO") */
function similarity(a: string, b: string): number {
  const normA = normalizeText(a);
  const normB = normalizeText(b);
  if (!normA || !normB) return 0;
  if (normA === normB) return 1;
  const bigrams = (s: string): string[] => {
    const out: string[] = [];
    for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
    return out;
  };
  const ba = bigrams(normA);
  const bb = bigrams(normB);
  const inter = ba.filter((g) => bb.includes(g)).length;
  return (2 * inter) / (ba.length + bb.length);
}

/**
 * Classifica a correspondência do item da NF com produtos cadastrados.
 *
 * Prioridade:
 *  1. código interno (cProd armazenado em internalCode) — encontrado;
 *  2. combinação forte marca + modelo + especificação — encontrado;
 *  3. similaridade de descrição — possível (confirmar);
 *  4. nada — não encontrado.
 *
 * Descrições genéricas ("TONER" vs outro "TONER" de modelo diferente)
 * NUNCA são tratadas como iguais sem confirmação.
 */
export function matchNfeProduct(item: NfeItem, products: ProductForMatch[]): ProductMatch {
  const code = normalizeText(item.code);
  // 1. Código interno do fornecedor previamente armazenado
  if (code) {
    for (const p of products) {
      if (p.internalCode && normalizeText(p.internalCode) === code) {
        return { productId: p._id, status: "found", score: 100 };
      }
    }
  }

  const descTokens = tokenize(item.description);
  const descNorm = normalizeText(item.description);

  let best: ProductMatch = { status: "not_found", score: 0 };

  for (const p of products) {
    const pNameNorm = normalizeText(p.name);
    const nameSim = similarity(pNameNorm, descNorm);

    // Marca/modelo explícitos do produto presentes na descrição da NF
    let brandHit = 0;
    if (p.brand && normalizeText(p.brand)) {
      brandHit = descNorm.includes(normalizeText(p.brand)) ? 1 : 0;
    }
    let modelHit = 0;
    if (p.model && normalizeText(p.model)) {
      modelHit = descNorm.includes(normalizeText(p.model)) ? 1 : 0;
    }
    let specHit = 0;
    if (p.specification && normalizeText(p.specification)) {
      specHit = descNorm.includes(normalizeText(p.specification)) ? 1 : 0;
    }

    let score = 0;
    if (nameSim >= 0.95) score = Math.max(score, 100); // descrição essencialmente igual → encontrado
    if (nameSim >= 0.8) score = Math.max(score, 70);
    const overlap = tokenOverlap(descTokens, tokenize(p.name));
    if (overlap >= 0.7) score = Math.max(score, 55 + Math.round(overlap * 20));

    // Combinação forte: marca + modelo (ou especificação) casam na descrição
    const strongCombo = brandHit && (modelHit || specHit);
    if (strongCombo) score = Math.max(score, 85);

    if (score > best.score) {
      best = { productId: p._id, score, status: score >= 100 ? "found" : score >= 40 ? "possible" : "not_found" };
    }
  }

  return best;
}

// ─── Montagem do rascunho ────────────────────────────────────────────────────

/**
 * Monta os argumentos de entries.create a partir da NF interpretada.
 * Função pura — NÃO altera estoque, lote, movimentação ou auditoria.
 * A efetivação ocorre somente em entries.confirm (fluxo existente).
 */
export function buildEntryDraftFromNfe(
  parsed: NfeData,
  mapped: { productId: string; locationId?: string; supplierLotNumber?: string }[],
  opts: {
    supplierId?: string;
    contractNumber?: string;
    observation?: string;
    documentStorageId?: string;
    xmlStorageId?: string;
  } = {}
): NfeDraft {
  if (parsed.items.length !== mapped.length || mapped.some((m) => !m.productId)) {
    throw new Error("Todos os itens da NF precisam de um produto associado.");
  }

  const observations: string[] = [];
  if (parsed.orderReference) observations.push(`Pedido/contrato da NF: ${parsed.orderReference}`);
  if (parsed.natureOperation) observations.push(`Natureza da operação: ${parsed.natureOperation}`);
  if (parsed.additionalInfo && !parsed.orderReference) {
    observations.push(`Informações adicionais: ${parsed.additionalInfo.slice(0, 300)}`);
  }
  if (opts.observation) observations.push(opts.observation);

  const items: NfeDraftItem[] = parsed.items.map((item, idx) => {
    const m = mapped[idx];
    const specs: string[] = [];
    if (unitNeedsMapping(item.unit)) specs.push(`Unidade na NF: ${item.unit}`);
    if (item.ean) specs.push(`EAN: ${item.ean}`);
    return {
      productId: m.productId,
      quantity: item.quantity,
      unitOfMeasure: mapNfeUnit(item.unit),
      unitCost: item.unitValue,
      totalCost: item.totalValue,
      specification: specs.length > 0 ? specs.join(" · ") : undefined,
      locationId: m.locationId,
      supplierLotNumber: m.supplierLotNumber || undefined,
      supplierCode: item.code || undefined,
      ncm: item.ncm,
      cfop: item.cfop,
      ean: item.ean,
    };
  });

  return {
    invoiceNumber: parsed.number,
    series: parsed.series || undefined,
    invoiceDate: parsed.emissionDate || undefined,
    accessKey: parsed.accessKey,
    supplierId: opts.supplierId,
    contractNumber: opts.contractNumber || parsed.orderReference,
    observation: observations.join(". ") || undefined,
    totalValue: parsed.totalValue,
    documentStorageId: opts.documentStorageId,
    xmlStorageId: opts.xmlStorageId,
    items,
  };
}
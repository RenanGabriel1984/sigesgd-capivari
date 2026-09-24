/**
 * Gestão de Estoque SGGD CAPIVARI — Importação de NF-e XML
 *
 * Núcleo puro e testável da funcionalidade de importação de NF-e:
 *  - parseNfeXml: valida e extrai os dados estruturados do XML da NF-e;
 *  - mapNfeUnit: mapeia a unidade da NF (UN, PC, CX, KIT...) para as unidades do sistema;
 *  - findSupplierMatch: localiza o fornecedor existente (CNPJ ou razão social);
 *  - matchNfeProduct: classifica a correspondência produto da NF ↔ produto Gestão de Estoque SGGD;
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
  ean?: string | null;
  brand?: string | null;
  model?: string | null;
  specification?: string | null;
};

export type ProductAliasForMatch = {
  _id: string;
  supplierId?: string | null;
  supplierCode?: string | null;
  normalizedDescription: string;
  productId: string;
};

export type ProductMatchSource =
  | "ean"
  | "supplier_alias"
  | "internal_code"
  | "brand_model"
  | "normalized_description"
  | "approximate"
  | "manual"
  | "new_product";

export type ProductAssociationType = "automatic" | "manual" | "created";

export type SupplierForMatch = {
  _id: string;
  legalName: string;
  cnpj?: string | null;
};

export type ProductMatchStatus = "found" | "possible" | "not_found";

export interface ProductMatch {
  productId?: string;
  status: ProductMatchStatus;
  /** 0–100. Aproximações são sempre "possible" e exigem confirmação. */
  score: number;
  source?: ProductMatchSource;
  reason?: string;
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
  matchSource?: ProductMatchSource;
  matchScore?: number;
  associationType?: ProductAssociationType;
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

/**
 * Normaliza texto fiscal para comparação sem apagar identificadores.
 * Abreviações são equivalentes, mas modelo, capacidade, cor e códigos
 * continuam presentes (ex.: "CX-735" e "CX735" convergem para "cx735").
 */
export const normalizeText = (s: string): string => {
  let value = normalizeAccents((s ?? "").toLowerCase());
  value = value
    .replace(/\bcart(?:\.|\s+)/g, "cartucho ")
    .replace(/\bcartuchos?\b/g, "cartucho")
    .replace(/\bp\s*\/\s*/g, " para ")
    .replace(/\bcaixa\s+c\b/g, "caixa")
    .replace(/\bunid(?:ade)?\b/g, "un")
    .replace(/\baltalink\b/g, "alta link")
    .replace(/\bbobina\s+termica\b/g, "papel termico")
    .replace(/([a-z]+)\s+termica\b/g, "$1 termico")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  // Junta apenas prefixos inequívocos de modelo_partículo: CX-735, TN-34925BR...
  const parts = value.split(/\s+/).filter(Boolean);
  const joined: string[] = [];
  const splitModelPrefixes = new Set(["cx", "tn", "006r", "mfc", "mfcl", "c81", "c82"]);
  for (let i = 0; i < parts.length; i++) {
    const current = parts[i];
    const next = parts[i + 1];
    if (next && splitModelPrefixes.has(current) && /^[a-z]*\d[a-z0-9-]*$/.test(next)) {
      joined.push(current + next);
      i++;
    } else {
      joined.push(current);
    }
  }
  return joined.join(" ");
};

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
  /** Complemento visual: cadastro de nome muito similar mas com CNPJ divergente — NUNCA vira vínculo automático. */
  suggestedSupplierId?: string;
  suggestedSupplierName?: string;
}

/** Melhor candidato por razão social normalizada (score ≥ 0.9), se houver. */
function bestNameCandidate(name: string, suppliers: SupplierForMatch[]): SupplierForMatch | undefined {
  if (!name) return undefined;
  let best: SupplierForMatch | undefined;
  let bestScore = 0;
  for (const s of suppliers) {
    const score = similarity(normalizeText(s.legalName), name);
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return best && bestScore >= 0.9 ? best : undefined;
}

/**
 * Localiza o fornecedor existente a partir da NF.
 * O CNPJ do emitente é o identificador PRINCIPAL — comparado em só dígitos,
 * portanto aceita tanto com máscara (61.457.941/0001-43) quanto sem
 * (61457941000143), independentemente de como estiver gravado no cadastro.
 * A razão social entra apenas como fallback/complemento visual:
 *  • cadastro sem CNPJ registrado + nome similar → fallback (não há contradição fiscal);
 *  • cadastro com CNPJ DIVERGENTE → nunca vincula; devolve apenas sugestão visual.
 * Nunca cria fornecedor — a UI oferece cadastro com os dados fiscais do XML.
 */
export function findSupplierMatch(parsed: NfeData, suppliers: SupplierForMatch[]): SupplierMatch {
  const cnpj = parsed.emitterCnpj ? digitsOnly(parsed.emitterCnpj) : "";
  const name = normalizeText(parsed.emitterName ?? "");

  if (cnpj) {
    const hit = suppliers.find((s) => s.cnpj && digitsOnly(s.cnpj) === cnpj);
    if (hit) return { supplierId: hit._id, found: true, byCnpj: true };

    const candidate = bestNameCandidate(name, suppliers);
    if (!candidate) return { found: false, byCnpj: false };
    // Cadastro sem CNPJ: nada contradiz o vínculo → fallback por razão social.
    if (!candidate.cnpj || !digitsOnly(candidate.cnpj)) {
      return { supplierId: candidate._id, found: true, byCnpj: false };
    }
    // CNPJ divergente: apenas sugestão visual, vínculo fica para o usuário.
    return {
      found: false,
      byCnpj: false,
      suggestedSupplierId: candidate._id,
      suggestedSupplierName: candidate.legalName,
    };
  }

  // XML sem CNPJ (caso raro): fallback por razão social normalizada.
  const fallback = bestNameCandidate(name, suppliers);
  if (fallback) return { supplierId: fallback._id, found: true, byCnpj: false };
  return { found: false, byCnpj: false };
}

/** Formata CNPJ de 14 dígitos como 00.000.000/0000-00; valores não padronizados voltam como estão. */
export const formatCnpj = (raw?: string | null): string => {
  const d = digitsOnly(raw ?? "");
  if (d.length !== 14) return raw ?? "";
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12, 14)}`;
};

// ─── Correspondência de produtos ─────────────────────────────────────────────

function tokenize(s: string): string[] {
  return normalizeText(s).split(" ").filter((t) => t.length > 1);
}

function tokenOverlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  const union = new Set([...setA, ...setB]);
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter++;
  return inter / union.size;
}

/** Similaridade de bigramas; não decide sozinha uma associação automática. */
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
  return ba.length + bb.length === 0 ? 0 : (2 * inter) / (ba.length + bb.length);
}

const COLOR_TERMS = new Set(["preto", "branco", "amarelo", "ciano", "magenta", "vermelho", "azul", "verde"]);
const BRAND_TERMS = new Set(["brother", "lexmark", "xerox", "hp", "hewlett", "packard", "canon", "ricoh", "konica", "minolta", "samsung", "epson"]);
const SEMANTIC_STOP_WORDS = new Set([
  "cartucho", "cartucho", "caixa", "kit", "para", "p", "com", "original", "cor",
  "de", "da", "do", "das", "dos", "un", "unidade", "produto", "item",
]);
const DISTINCTIVE_FAMILIES: string[][] = [["sigma"], ["alta", "link"]];

function tokensOf(text: string): Set<string> {
  return new Set(tokenize(text));
}

function extractColors(text: string): Set<string> {
  return new Set(tokenize(text).filter((token) => COLOR_TERMS.has(token)));
}

function extractBrands(text: string): Set<string> {
  return new Set(tokenize(text).filter((token) => BRAND_TERMS.has(token)));
}

/** Códigos de modelo/fabricante com letras e números; capacidades e medidas não entram. */
function extractModelTokens(text: string): Set<string> {
  return new Set(tokenize(text).filter((token) => {
    if (!/^[a-z]*\d[a-z0-9]*$/.test(token) || token.length < 4) return false;
    if (/^\d+x\d+/.test(token)) return false; // dimensão, ex.: 86x54
    if (/^\d{1,3}k$/.test(token)) return false; // capacidade fiscal, ex.: 28k
    return true;
  }));
}

function extractFamilies(text: string): Set<string> {
  const tokens = new Set(tokenize(text));
  const families = new Set<string>();
  for (const family of DISTINCTIVE_FAMILIES) {
    if (family.every((token) => tokens.has(token))) families.add(family.join(" "));
  }
  return families;
}

function intersects(a: Set<string>, b: Set<string>): boolean {
  return [...a].some((value) => b.has(value));
}

function semanticCore(text: string): Set<string> {
  return new Set(tokenize(text).filter((token) => !SEMANTIC_STOP_WORDS.has(token)));
}

/** Equivalências semânticas conservativeas; não genérica por categoria. */
function hasSafeMaterialEquivalence(a: Set<string>, b: Set<string>): boolean {
  const pvcCard = a.has("cartao") && a.has("pvc") && b.has("cartao") && b.has("pvc");
  const thermalPaper = a.has("papel") && a.has("termico") && b.has("papel") && b.has("termico");
  return pvcCard || thermalPaper;
}

function isReliableGtin(value?: string | null): boolean {
  const digits = digitsOnly(value ?? "");
  return [8, 12, 13, 14].includes(digits.length) && !/^0+$/.test(digits);
}

function normalizedCode(value?: string | null): string {
  return normalizeText(value ?? "").replace(/\s+/g, "");
}

/**
 * Correspondência em camadas, da mais forte para a mais frágil:
 * EAN/GTIN → memória do fornecedor → código → marca/modelo/família →
 * núcleo semântico → descrição normalizada → aproximação.
 *
 * Aproximações NUNCA retornam `found`. Modelos e cores conflitantes
 * eliminam o candidato, evitando que qualquer toner preto compatível com
 * outro modelo seja escolhido.
 */
export function matchNfeProduct(
  item: NfeItem,
  products: ProductForMatch[],
  options: { supplierId?: string | null; aliases?: ProductAliasForMatch[] } = {}
): ProductMatch {
  const activeIds = new Set(products.map((product) => product._id));
  const itemEan = digitsOnly(item.ean ?? "");
  if (isReliableGtin(item.ean)) {
    const eanHit = products.find((product) => isReliableGtin(product.ean) && digitsOnly(product.ean ?? "") === itemEan);
    if (eanHit) return { productId: eanHit._id, status: "found", score: 100, source: "ean", reason: "GTIN/EAN idêntico" };
  }

  const code = normalizedCode(item.code);
  const description = normalizeText(item.description);
  const aliases = options.aliases ?? [];
  const alias = aliases.find((candidate) => {
    if (!activeIds.has(candidate.productId)) return false;
    const sameSupplier = !candidate.supplierId || candidate.supplierId === options.supplierId;
    if (!sameSupplier) return false;
    if (code && candidate.supplierCode) return normalizedCode(candidate.supplierCode) === code;
    return candidate.normalizedDescription === description;
  });
  if (alias) {
    return { productId: alias.productId, status: "found", score: 100, source: "supplier_alias", reason: "Associação memorizada do fornecedor" };
  }

  if (code) {
    const codeHit = products.find((product) => product.internalCode && normalizedCode(product.internalCode) === code);
    if (codeHit) return { productId: codeHit._id, status: "found", score: 100, source: "internal_code", reason: "Código do produto idêntico" };
  }

  const itemColors = extractColors(item.description);
  const itemBrands = extractBrands(item.description);
  const itemModels = extractModelTokens(item.description);
  const itemFamilies = extractFamilies(item.description);
  const itemCore = semanticCore(item.description);
  const candidates: ProductMatch[] = [];

  for (const product of products) {
    const productText = [product.brand, product.name, product.model, product.specification].filter(Boolean).join(" ");
    const productColors = extractColors(productText);
    const productBrands = extractBrands(productText);
    const productModels = extractModelTokens(productText);
    const productFamilies = extractFamilies(productText);
    const productCore = semanticCore(productText);
    const productName = normalizeText(product.name);

    // Guardas explícitas: incompatibilidades de marca/modelo/cor eliminam o candidato.
    if (itemModels.size > 0 && productModels.size > 0 && !intersects(itemModels, productModels)) continue;
    if (itemBrands.size > 0 && productBrands.size > 0 && !intersects(itemBrands, productBrands)) continue;
    if (itemColors.size > 0 && productColors.size > 0 && !intersects(itemColors, productColors)) continue;

    // Ribbon Sigma não pode cair em um produto genérico "Ribbon".
    if (itemFamilies.has("sigma") && !productFamilies.has("sigma")) continue;

    const modelHit = intersects(itemModels, productModels);
    const familyHit = intersects(itemFamilies, productFamilies);
    const brandHit = product.brand ? itemBrands.has(normalizeText(product.brand)) : false;
    const nameSim = similarity(productName, description);
    const overlap = tokenOverlap(tokenize(item.description), tokenize(product.name));
    let score = 0;
    let source: ProductMatchSource = "approximate";
    let reason = "Aproximação — requer confirmação";

    if (productName === description) {
      score = 100;
      source = "normalized_description";
      reason = "Descrição normalizada idêntica";
    } else if (modelHit) {
      const colorsAreSafe = itemColors.size === 0 || productColors.size === 0 || intersects(itemColors, productColors);
      score = colorsAreSafe && itemColors.size > 0 ? 96 : 82;
      source = "brand_model";
      reason = colorsAreSafe ? "Modelo e cor compatíveis" : "Modelo compatível; cor não está cadastrada";
    } else if (familyHit) {
      const colorsAreSafe = itemColors.size === 0 || productColors.size === 0 || intersects(itemColors, productColors);
      score = colorsAreSafe ? 94 : 76;
      source = "brand_model";
      reason = colorsAreSafe ? "Família de produto e cor compatíveis" : "Família compatível; cor não está cadastrada";
    } else if (brandHit && productModels.size > 0) {
      score = 92;
      source = "brand_model";
      reason = "Marca e modelo compatíveis";
    } else if (hasSafeMaterialEquivalence(itemCore, productCore)) {
      // equivalências como cartão PVC↔cartão para crachá e bobina térmica↔papel térmico
      score = 93;
      source = "normalized_description";
      reason = "Descrição fiscal e cadastro referem-se ao mesmo material";
    } else if (nameSim >= 0.8 || overlap >= 0.65) {
      score = Math.max(65, Math.round(Math.max(nameSim, overlap) * 80));
    } else {
      continue;
    }

    const status: ProductMatchStatus = score >= 90 ? "found" : "possible";
    if (status === "possible" && score >= 90) score = 85;
    candidates.push({ productId: product._id, status, score, source, reason });
  }

  if (candidates.length === 0) return { status: "not_found", score: 0, reason: "Nenhum produto seguro ou suficientemente parecido" };
  candidates.sort((a, b) => b.score - a.score);
  const top = candidates[0];
  if (candidates.length > 1 && candidates[1].score === top.score && top.status === "found") {
    return { ...top, status: "possible", score: Math.min(top.score - 1, 85), source: "approximate", reason: "Mais de um produto com a mesma pontuação — confirme" };
  }
  return top;
}

export interface NfeReviewAssociation {
  productId?: string;
  matchStatus: ProductMatchStatus;
  associationType?: ProductAssociationType;
}

/**
 * Reaplica o matching aos itens ainda sem uma associação definitiva.
 *
 * O catálogo e os aliases são dados reativos: uma associação automática já
 * encontrada não pode desaparecer em um rerender, e uma seleção manual/criada
 * nunca pode ser sobrescrita. Itens ainda não encontrados continuam elegíveis
 * para reaproveitar quando uma consulta que estava indefinida terminar de
 * carregar.
 */
export function reconcileNfeReviewMatches<
  T extends NfeReviewAssociation & { item: NfeItem },
>(reviews: T[], products: ProductForMatch[], options: { supplierId?: string | null; aliases?: ProductAliasForMatch[] } = {}): T[] {
  return reviews.map((review) => {
    const protectedAssociation = review.associationType && review.associationType !== "automatic";
    const foundAlready = Boolean(review.productId) && review.matchStatus === "found";
    if (protectedAssociation || foundAlready) return review;

    const match = matchNfeProduct(review.item, products, options);
    return {
      ...review,
      productId: match.productId ?? "",
      matchStatus: match.status,
      matchScore: match.score,
      matchSource: match.source,
      matchReason: match.reason,
      associationType: "automatic",
    };
  });
}

/** Regra pura testável para o avanço na conferência da NF-e. */
export function canContinueNfeReview(items: NfeReviewAssociation[]): boolean {
  return items.length > 0 && items.every((item) => Boolean(item.productId) && item.matchStatus === "found");
}

export interface NfeProductHints {
  brand?: string;
  model?: string;
  ean?: string;
  unitOfMeasure: string;
}

/** Sugestões para o formulário controlado; não executa cadastro. */
export function extractNfeProductHints(item: NfeItem): NfeProductHints {
  const brand = [...extractBrands(item.description)][0];
  const model = [...extractModelTokens(item.description)].sort((a, b) => b.length - a.length)[0];
  return {
    brand: brand ? brand.toUpperCase() : undefined,
    model: model ? model.toUpperCase() : undefined,
    ean: isReliableGtin(item.ean) ? item.ean : undefined,
    unitOfMeasure: mapNfeUnit(item.unit),
  };
}

// ─── Montagem do rascunho ────────────────────────────────────────────────────

/**
 * Monta os argumentos de entries.create a partir da NF interpretada.
 * Função pura — NÃO altera estoque, lote, movimentação ou auditoria.
 * A efetivação ocorre somente em entries.confirm (fluxo existente).
 */
export function buildEntryDraftFromNfe(
  parsed: NfeData,
  mapped: {
    productId: string;
    locationId?: string;
    supplierLotNumber?: string;
    matchSource?: ProductMatchSource;
    matchScore?: number;
    associationType?: ProductAssociationType;
  }[],
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
      matchSource: m.matchSource,
      matchScore: m.matchScore,
      associationType: m.associationType ?? "automatic",
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
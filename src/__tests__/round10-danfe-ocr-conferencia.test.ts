/**
 * RODADA 10 — CORREÇÃO DEFINITIVA DA CONFERÊNCIA DANFE/OCR E RESPONSIVIDADE
 *
 * Cobre o §11 do prompt (testes A–L) + critérios de aceite da rodada:
 *  §1/§2  modal largo (max-w-6xl, calc(100vw - 2rem)) e zero overflow
 *  §3     alerta da chave APENAS como pendência de conferência
 *  §4/§5  cabeçalho da DANFE NUNCA vira produto; nada é inventado
 *  §6/§7  chave de 44 dígitos validada estruturalmente (estrutura + DV)
 *  §8     contador "X de 10 campos" conta SOMENTE campos válidos
 *  §10    fornecedor em duas linhas com truncate (não invade Nº NF)
 *  §11    testes A–L
 *
 * Testes PUROS: leem fontes e exercitam o parser — NÃO escrevem no banco,
 * NÃO criam entradas e NÃO alteram dados de produção.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  DANFE_TRACKED_FIELDS,
  danfeFieldSummary,
  extractAccessKey44,
  isValidDanfeItemCandidate,
  mergeDanfeTexts,
  parseDanfeText,
  validateAccessKey44,
} from "@/lib/danfe-ocr";
import { canContinueNfeReview } from "@/lib/nfe";

const read = (rel: string) => readFileSync(resolve(__dirname, "..", "..", rel), "utf8");

const ENTRIES = read("src/pages/Entries.tsx");
const DIALOG = read("src/components/DanfeImportDialog.tsx");
const REVIEW = read("src/components/NfeReviewTable.tsx");

const ACCESS_KEY = "42260922816315000144550010000029671515440064";

const HEADER_LINE =
  "DESCRICAO DOS PRODUTOS/SERVICOS NCM C.S.T. UNID. QUANT. VALOR UNITARIO VALOR TOTAL ALIQ. ICMS";

const VALID_ITEM =
  "1 23107 KIT TECLADO E MOUSE USB SLIM CHOCO 25 PC 52,94 1.323,50";

// ═══════════════════════════════════════════════════════════════════════════
// A/B — Cabeçalho da DANFE nunca vira produto
// ═══════════════════════════════════════════════════════════════════════════

describe("A/B — cabeçalho da DANFE nunca vira produto", () => {
  it("A — texto de cabeçalho/paginação não gera item algum", () => {
    const parsed = parseDanfeText(
      ["NF-e Nº 123", HEADER_LINE, "FOLHA 1 DE 3", "DANFE - DOCUMENTO AUXILIAR"].join("\n"),
    );
    expect(parsed.items).toHaveLength(0);
  });

  it("B — 'DESCRICAO DOS PRODUTOS/SERVICOS...' é rejeitado explicitamente", () => {
    expect(isValidDanfeItemCandidate(HEADER_LINE)).toBe(false);
    expect(
      isValidDanfeItemCandidate(
        "DESCRICAO DOS PRODUTOS/SERVICOS NCM C.S.T. UNID. QUANT. VALOR UNITARIO VALOR TOTAL...",
      ),
    ).toBe(false);
  });

  it("A — o cabeçalho não engole o produto real ao lado", () => {
    const parsed = parseDanfeText(
      ["DADOS DOS PRODUTOS", HEADER_LINE, VALID_ITEM].join("\n"),
    );
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]?.description).toBe("KIT TECLADO E MOUSE USB SLIM CHOCO");
  });

  it("A — 'Cód. IGO' e '2 EPP' nunca viram produto/quantidade", () => {
    expect(isValidDanfeItemCandidate("Cód. IGO")).toBe(false);
    expect(isValidDanfeItemCandidate("2 EPP")).toBe(false);
    expect(isValidDanfeItemCandidate("2 EPP 1 PC 10,00 10,00")).toBe(false);
    expect(parseDanfeText("2 EPP\nCód. IGO").items).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C/D — Quantidade inválida rejeitada; produto sem evidência fica pendente
// ═══════════════════════════════════════════════════════════════════════════

describe("C/D — evidência suficiente para virar item", () => {
  it("C — quantidade zerada/não numérica é rejeitada", () => {
    expect(isValidDanfeItemCandidate("1 23107 KIT TECLADO E MOUSE 0 PC 52,94 0,00")).toBe(false);
    expect(isValidDanfeItemCandidate("1 23107 KIT TECLADO E MOUSE ABC PC 52,94 0,00")).toBe(false);
    expect(
      parseDanfeText("1 23107 KIT TECLADO E MOUSE 0 PC 52,94 0,00").items,
    ).toHaveLength(0);
  });

  it("C — unidade que é nome de coluna (NCM/CST/UNID…) é rejeitada", () => {
    expect(
      isValidDanfeItemCandidate("1 ABC PRODUTO QUALQUER AQUI 25 NCM 52,94 1323,50"),
    ).toBe(false);
  });

  it("D — item não identificado fica PENDENTE, nunca inventado", () => {
    // Aviso presente na tela de conferência (linha pendente, campos vazios):
    expect(REVIEW).toContain(
      "Produto não identificado automaticamente. Faça a associação manual na conferência.",
    );
    // E a conferência não avança sem associação real:
    const pending = [
      {
        item: { lineNumber: 1, description: "", quantity: 0 },
        productId: "",
        matchStatus: "not_found",
        matchScore: 0,
        associationType: "automatic",
      },
    ];
    expect(canContinueNfeReview(pending as any)).toBe(false);
    const associated = [
      {
        item: { lineNumber: 1, description: "KIT", quantity: 25 },
        productId: "prod1",
        matchStatus: "found",
        matchScore: 90,
        associationType: "automatic",
      },
    ];
    expect(canContinueNfeReview(associated as any)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// E/F — Chave de acesso: 44 dígitos validados estruturalmente
// ═══════════════════════════════════════════════════════════════════════════

describe("E/F — chave de acesso: estrutura + dígito verificador", () => {
  it("E — chave válida (com espaço, glifos e prefixo do nº da NF) é aceita", () => {
    expect(validateAccessKey44(ACCESS_KEY)).toBe(true);
    expect(
      extractAccessKey44("NF-e Nº 2967\n4226 0922 8163 1500 0144 5500 1000 0029 6715 1544 0064"),
    ).toBe(ACCESS_KEY);
    expect(
      extractAccessKey44("4226.0922.8163.1500.0144.5500.1000.0029.6715.1544.0064"),
    ).toBe(ACCESS_KEY);
    expect(
      extractAccessKey44("4226 O922 8163 15OO O144 55OO 1OOO OO29 6715 1544 OO64"),
    ).toBe(ACCESS_KEY);
  });

  it("F — 44 caracteres inválidos NUNCA são aceitos", () => {
    expect(validateAccessKey44("9".repeat(44))).toBe(false); // UF impossível
    expect(validateAccessKey44("1".repeat(44))).toBe(false);
    expect(validateAccessKey44("123")).toBe(false);
    const wrongDv = ACCESS_KEY.slice(0, 43) + String((Number(ACCESS_KEY[43]) + 1) % 10);
    expect(validateAccessKey44(wrongDv)).toBe(false); // DV módulo 11 errado
    expect(extractAccessKey44("9".repeat(44))).toBeUndefined();
    expect(extractAccessKey44(wrongDv)).toBeUndefined();
    expect(extractAccessKey44("a".repeat(44))).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// G — OCR parcial continua permitindo a conferência + hierarquia do alerta
// ═══════════════════════════════════════════════════════════════════════════

describe("G — OCR parcial não bloqueia a conferência", () => {
  const partial = parseDanfeText(
    ["NF-e Nº 42", "Série: 001", "CNPJ: 61.457.941/0001-43"].join("\n"),
  );

  it("parse parcial é aceito (ok) e o resumo mostra X de 10", () => {
    expect(partial.ok).toBe(true);
    const summary = danfeFieldSummary(partial);
    expect(summary.total).toBe(10);
    expect(summary.found).toBeGreaterThan(0);
    expect(summary.found).toBeLessThan(summary.total);
    expect(DANFE_TRACKED_FIELDS).toHaveLength(10);
  });

  it("o modal mostra resumo + 'você pode informar ou corrigir' (não é falha total)", () => {
    expect(DIALOG).toContain(
      "Dados identificados: {fieldSummary.found} de {fieldSummary.total} campos",
    );
    expect(DIALOG).toContain("Você pode informar ou corrigir");
    expect(DIALOG).toContain("summary.found === 0"); // falha total só se NADA lido
    expect(DIALOG).toContain("OCR concluído");
  });

  it("§3 — alerta da chave é APENAS pendência de conferência", () => {
    expect(DIALOG).toContain(
      "Chave de acesso não identificada automaticamente. Confira a DANFE e informe a",
    );
    // A antiga mensagem catastrófica não existe mais:
    expect(DIALOG).not.toContain(
      "Não foi possível identificar automaticamente a chave de acesso.",
    );
    // A conferência existe na Entrada com orientação de pendência:
    expect(ENTRIES).toContain("Chave pendente de conferência");
    expect(ENTRIES).toContain("value={nfeAccessKey}");
  });

  it("§8 — contador só considera campos realmente válidos", () => {
    const badKey = parseDanfeText(
      ["NF-e Nº 42", "12345678901234567890123456789012345678901234"].join("\n"),
    );
    const summary = danfeFieldSummary(badKey);
    expect(summary.missing).toContain("Chave de acesso"); // 44 dígitos inválidos não contam
    expect(summary.found).toBe(1); // somente o número da NF-e
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// H/I/J — Overflow, SupplierSelectValue e modal
// ═══════════════════════════════════════════════════════════════════════════

describe("H/I/J — layout sem overflow", () => {
  it("H — células de valor longo têm min-w-0/max-w-full/overflow-hidden/break-words", () => {
    expect(DIALOG).toContain("min-w-0 max-w-full overflow-hidden");
    expect(DIALOG).toContain("min-w-0 max-w-full overflow-hidden break-words");
    expect(ENTRIES).toContain("min-w-0 max-w-full overflow-hidden");
    expect(ENTRIES).toContain("break-words");
    // chave ocupa largura total quando necessária:
    expect(DIALOG).toContain('wide && "col-span-1 sm:col-span-2"');
  });

  it("I — SupplierSelectValue não ultrapassa o SelectTrigger (truncate + min-w-0)", () => {
    expect(ENTRIES).toContain("<SupplierSelectValue");
    expect(ENTRIES).toContain("min-w-0 truncate");
    expect(ENTRIES).toContain("CNPJ {formatCnpj(supplier.cnpj)}");
    // gatilho do select também é contido:
    expect(ENTRIES).toContain('className="mt-1 h-10 w-full min-w-0 max-w-full"');
    // fornecedor em duas linhas, nunca invadindo Nº NF/Série/Data:
    expect(ENTRIES).toContain("Fornecedor identificado: {nfeSupplier.legalName}");
    expect(ENTRIES).toContain("CNPJ {formatCnpj(nfeSupplier.cnpj)}");
  });

  it("J — modal da DANFE: 960px/85dvh, sem overflow horizontal e rodapé fixo", () => {
    expect(DIALOG).toContain(
      'className="w-[calc(100vw-32px)] max-w-[960px] max-h-[85dvh] flex flex-col gap-0 overflow-hidden p-0 sm:p-0"',
    );
    // conteúdo interno protegido; rolagem SOMENTE na área central:
    expect(DIALOG).toContain("min-w-0 max-w-full overflow-x-hidden");
    expect(DIALOG).toContain(
      "flex-1 min-h-0 overflow-x-hidden overflow-y-auto px-5 pb-3 sm:px-6 space-y-3",
    );
    // cabeçalho e rodapé estáticos (shrink-0) — botões sempre acessíveis:
    expect(DIALOG).toContain("min-w-0 max-w-full shrink-0");
    expect(DIALOG).toContain(
      "min-w-0 max-w-full shrink-0 overflow-x-hidden border-t bg-background px-5 py-3 sm:px-6",
    );
    // sem classes antigas de largura exagerada:
    expect(DIALOG).not.toContain("max-w-6xl");
    expect(DIALOG).not.toContain("max-h-[calc(100vh-11rem)]");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// K/L — Grid da conferência em desktop e mobile
// ═══════════════════════════════════════════════════════════════════════════

describe("K/L — grid da conferência responsivo", () => {
  it("K — desktop: duas/três colunas legíveis a partir de sm/lg", () => {
    expect(ENTRIES).toContain("grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3");
    expect(ENTRIES).toContain("grid grid-cols-1 gap-3 sm:grid-cols-3");
    expect(DIALOG).toContain("grid grid-cols-1 sm:grid-cols-2 gap-3");
  });

  it("L — mobile: sempre começa em UMA coluna (nenhum grid rígido de 2)", () => {
    expect(ENTRIES).toContain("grid-cols-1");
    expect(DIALOG).toContain("grid-cols-1");
    // Não existe grid de duas colunas sem o fallback mobile:
    expect(ENTRIES).not.toMatch(/className="grid grid-cols-2/);
    expect(DIALOG).not.toMatch(/className="grid grid-cols-2/);
  });

  // ═══════════════════════════════════════════════════════════════════
// R11 — Linha repetida por OCR/regiões NUNCA duplica produto
// (bug real pego no navegador: "Itens (2)" com o mesmo item duas vezes)
// ═══════════════════════════════════════════════════════════════════

describe("R11 — sem produto duplicado vindo do OCR por regiões", () => {
  const ITEM = "1 23107 CADEIRA ERGONOMICA EXECUTIVA 2 PC 115,50 231,00";

  it("mergeDanfeTexts descarta linha repetida entre página e região (só espaços/caixa)", () => {
    const page = [`NF-e Nº 118`, ITEM].join("\n");
    const region = "1  23107   CADEIRA ERGONOMICA EXECUTIVA   2 PC 115,50 231,00";
    const merged = mergeDanfeTexts(page, [region]);
    expect(merged.split("\n").filter((l) => l.includes("CADEIRA"))).toHaveLength(1);
    expect(parseDanfeText(merged).items).toHaveLength(1);
  });

  it("parseDanfeText ignora item exatamente repetido", () => {
    expect(parseDanfeText([ITEM, ITEM].join("\n")).items).toHaveLength(1);
  });

  it("itens legítimos distintos (nItem diferente) continuam todos", () => {
    const lines = [ITEM, "2 23107 CADEIRA ERGONOMICA EXECUTIVA 1 PC 115,50 115,50"];
    expect(parseDanfeText(lines.join("\n")).items).toHaveLength(2);
  });

  it("regressão R8 — merge de textos distintos continua concatenando", () => {
    expect(mergeDanfeTexts("pag1", ["reg1", "reg2"])).toBe("pag1\nreg1\nreg2");
  });
});

it("§10 — dropdown do fornecedor exibe razão social + CNPJ organizados", () => {
    expect(ENTRIES).toContain("textValue={s.legalName}");
    expect(ENTRIES).toContain("CNPJ: ${formatCnpj(s.cnpj)}");
    expect(ENTRIES).not.toContain("${s.legalName} — ${formatCnpj(s.cnpj)}");
  });

  it("§1 — modal comporta resumo, dados, fornecedor, destinatário, itens, total, chave, documento e botões", () => {
    expect(DIALOG).toContain("OCR concluído");
    expect(DIALOG).toContain("Dados lidos da DANFE");
    expect(DIALOG).toContain(">Fornecedor<");
    expect(DIALOG).toContain("Destinatário");
    expect(DIALOG).toContain("Itens (");
    expect(DIALOG).toContain("Valor total da NF");
    expect(DIALOG).toContain("Chave de acesso");
    expect(DIALOG).toContain("Documento original");
    expect(DIALOG).toContain("Conferir na Entrada");
  });
});

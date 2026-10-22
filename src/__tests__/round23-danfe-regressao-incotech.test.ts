/**
 * Rodada 23 — regressão da importação de DANFE (Incotech Company.pdf/.png).
 *
 * Causas-raiz corrigidas e cobertas aqui:
 *  1. O diálogo colava TODOS os fragmentos do pdfjs em UMA linha por página —
 *     o parser (orientado a linhas) perdia emitente/destinatário e itens.
 *  2. PDFs com operadores malformados (Tm/Tf inválidos) faziam o pdfjs
 *     devolver ZERO itens — o texto existia no arquivo, mas nunca era lido.
 *  3. Seções trocadas: "IDENTIFICAÇÃO DO EMITENTE / REMETENTE" virava
 *     destinatário e "FRETE: 0-EMITENTE" virava emitente (CNPJs trocados).
 *  4. Rótulos reais "NOME:" e "NOME / RAZAO SOCIAL:" eram rejeitados.
 *  5. "Todos os itens associados" aparecia com ZERO itens na conferência.
 *  6. Nome do fornecedor concatenado ao CNPJ na tela de conferência.
 *
 * A chave de acesso codifica APENAS ano/mês (AAMM) — nenhum teste declara o
 * dia validado pela chave.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  danfeFieldNotes,
  danfeFieldSummary,
  hasUsableTextLayer,
  isDanfeParseBetter,
  mergeDanfeTexts,
  parseDanfeText,
  validateAccessKey44,
  validateDanfeFields,
  type DanfeParseResult,
} from "@/lib/danfe-ocr";
import {
  extractTextFromPdfStreams,
  reconstructPdfTextLines,
} from "@/lib/pdf-text-layer";
import { parseReportInput } from "@/lib/ocr-report";
import { formatAccessKeyGrouped, digitsOnly } from "@/lib/br-validators";
import { nfeItemsAssociationState } from "@/components/NfeReviewTable";

const read = (p: string) => readFileSync(resolve(__dirname, "..", "..", p), "utf8");
const DIALOG = read("src/components/DanfeImportDialog.tsx");
const ENTRIES = read("src/pages/Entries.tsx");
const REVIEW_TABLE = read("src/components/NfeReviewTable.tsx");

const PDF_FIXTURE = resolve(__dirname, "fixtures", "danfe-incotech-2967-original.pdf");
const PNG_REPORT = resolve(__dirname, "fixtures", "incotech-company-png.report.json");
const PDF_REPORT = resolve(__dirname, "fixtures", "incotech-company-pdf.report.json");

const ACCESS_KEY = "42260922816315000144550010000029671515440064";

/** GABARITO da DANFE de teste — referência do documento, nunca injetado no parse. */
const GABARITO = {
  numero: "2967",
  serie: "001",
  emissao: "2026-09-28",
  emitente: "INCOTECH COMPANY LTDA",
  cnpjEmitente: "22.816.315/0001-44",
  cepEmitente: "88701-600",
  destinatario: "MUNICIPIO DE CAPIVARI",
  cnpjDestinatario: "44.723.674/0001-90",
  item: {
    codigo: "231071",
    descricao: "KIT TECLADO E MOUSE USB SLIM CHOCO",
    ncm: "84716053",
    unidade: "PC",
    quantidade: 25,
    valorUnitario: 52.94,
    valorTotal: 1323.5,
  },
  totalNf: 1323.5,
};

function noteOf(p: DanfeParseResult, campo: string): string {
  return validateDanfeFields(p).find((v) => v.campo === campo)?.note ?? "";
}
function okOf(p: DanfeParseResult, campo: string): boolean {
  return Boolean(validateDanfeFields(p).find((v) => v.campo === campo)?.ok);
}

// ─── 1. PDF original com camada de texto ─────────────────────────────────────

describe("R23 — 1. PDF original com camada de texto (dado real, sem gabarito)", () => {
  it("o PDF DANFE versionado existe e é o documento real", () => {
    const bytes = new Uint8Array(readFileSync(PDF_FIXTURE));
    expect(bytes.length).toBeGreaterThan(1000);
    expect(readFileSync(PDF_FIXTURE, "latin1").startsWith("%PDF")).toBe(true);
  });

  it("fallback de streams brutos recupera a camada de texto que o pdfjs não lê", async () => {
    const bytes = new Uint8Array(readFileSync(PDF_FIXTURE));
    const layer = await extractTextFromPdfStreams(bytes);
    // O PDF tem operadores malformados (Tm com 2 operandos, sem Tf) — o pdfjs
    // devolve 0 itens, mas o texto está literalmente no arquivo.
    expect(hasUsableTextLayer(layer)).toBe(true);
    expect(layer).toContain("NOME / RAZAO SOCIAL: INCOTECH COMPANY LTDA");
    expect(layer).toContain(`CHAVE DE ACESSO: ${ACCESS_KEY}`);
    expect(layer.split("\n").length).toBeGreaterThan(30); // linhas preservadas
  });

  it("parse do texto POR LINHAS recupera emitente, destinatário, NF-e, série, data, chave, item e valores", async () => {
    const layer = await extractTextFromPdfStreams(new Uint8Array(readFileSync(PDF_FIXTURE)));
    const parsed = parseDanfeText(layer);

    expect(parsed.nfeNumber).toBe(GABARITO.numero);
    expect(parsed.series).toBe(GABARITO.serie);
    expect(parsed.emissionDate).toBe(GABARITO.emissao);
    expect(parsed.accessKey).toBe(ACCESS_KEY);
    expect(validateAccessKey44(parsed.accessKey ?? "")).toBe(true);

    expect(parsed.emitterName).toBe(GABARITO.emitente);
    expect(parsed.emitterCnpj).toBe(GABARITO.cnpjEmitente);
    expect(digitsOnly(parsed.emitterCnpj ?? "")).toBe(digitsOnly(GABARITO.cnpjEmitente));
    expect(parsed.emitterCity?.toLowerCase()).toBe("tubarao");
    expect(parsed.emitterState).toBe("SC");
    expect(parsed.emitterPostalCode).toBe(GABARITO.cepEmitente);

    expect(parsed.receiverName).toBe(GABARITO.destinatario);
    expect(parsed.receiverCnpj).toBe(GABARITO.cnpjDestinatario);

    // Transportador NÃO é o destinatário (CNPJ distinto do bloco 6).
    expect(parsed.transporterCnpj).toBe("38.306.164/0001-14");
    expect(parsed.transporterCnpj).not.toBe(parsed.receiverCnpj);

    expect(parsed.items).toHaveLength(1);
    const item = parsed.items[0];
    expect(item.code).toBe(GABARITO.item.codigo);
    expect(item.description).toBe(GABARITO.item.descricao);
    expect(item.ncm).toBe(GABARITO.item.ncm);
    expect(item.unit).toBe(GABARITO.item.unidade);
    expect(item.quantity).toBe(GABARITO.item.quantidade);
    expect(item.unitValue).toBeCloseTo(GABARITO.item.valorUnitario, 2);
    expect(item.totalValue).toBeCloseTo(GABARITO.item.valorTotal, 2);
    expect(parsed.totalValue).toBeCloseTo(GABARITO.totalNf, 2);

    // Validação campo a campo: tudo que foi lido passa na validação específica.
    for (const campo of ["nfeNumber", "series", "emissionDate", "accessKey", "emitterCnpj", "emitterName", "receiverCnpj", "receiverName", "items"]) {
      expect(okOf(parsed, campo), `campo ${campo}`).toBe(true);
    }
    expect(danfeFieldSummary(parsed).found).toBeGreaterThanOrEqual(9);
  });

  it("REGRESSÃO da causa-raiz: texto colado em UMA linha perde nomes/itens e perde a comparação", async () => {
    const layer = await extractTextFromPdfStreams(new Uint8Array(readFileSync(PDF_FIXTURE)));
    const glued = layer.replace(/\n/g, " "); // comportamento antigo do diálogo
    const parsedGlued = parseDanfeText(glued);
    const parsedLines = parseDanfeText(layer);

    // Documenta o defeito corrigido: no texto colado, só os campos numéricos
    // sobrevivem — nomes e itens desaparecem.
    expect(parsedGlued.emitterName).toBeUndefined();
    expect(parsedGlued.receiverName).toBeUndefined();
    expect(parsedGlued.items).toHaveLength(0);
    expect(parsedGlued.nfeNumber).toBe(GABARITO.numero);

    // E o comparador escolhe a leitura POR LINHAS (nunca a colada).
    expect(isDanfeParseBetter(parsedLines, parsedGlued)).toBe(true);
    expect(isDanfeParseBetter(parsedGlued, parsedLines)).toBe(false);
    expect(parsedLines.items).toHaveLength(1);
    expect(parsedLines.emitterName).toBe(GABARITO.emitente);
  });

  it("reconstructPdfTextLines agrupa fragmentos por coordenada Y (una linha visual)", () => {
    const lines = reconstructPdfTextLines([
      { str: "B", x: 60, y: 700 },
      { str: "A", x: 50, y: 700.5 },
      { str: "C", x: 50, y: 686 },
    ]);
    expect(lines).toBe("A B\nC");
  });
});

// ─── 2. Imagem da mesma DANFE (OCR real capturado) ───────────────────────────

describe("R23 — 2. Imagem: OCR real capturado recupera o que tem evidência", () => {
  for (const [label, path] of [
    ["PNG", PNG_REPORT],
    ["PDF (proxy PNG)", PDF_REPORT],
  ] as const) {
    it(`${label}: relatório real → merge do diálogo → campos identificados`, () => {
      const { reports } = parseReportInput(readFileSync(path, "utf8"));
      expect(reports.length).toBeGreaterThan(0);
      for (const payload of reports) {
        const merged = mergeDanfeTexts(payload.pageOcrText ?? "", payload.regionTexts ?? []);
        const parsed = parseDanfeText(merged);
        expect(parsed.accessKey).toBe(ACCESS_KEY);
        expect(parsed.nfeNumber).toBe(GABARITO.numero);
        expect(parsed.series).toBe(GABARITO.serie);
        expect(parsed.emissionDate).toBe(GABARITO.emissao);
        expect(parsed.emitterName).toBe(GABARITO.emitente);
        expect(parsed.emitterCnpj).toBe(GABARITO.cnpjEmitente);
        expect(parsed.receiverName).toBe(GABARITO.destinatario);
        expect(parsed.receiverCnpj).toBe(GABARITO.cnpjDestinatario);
        expect(parsed.items).toHaveLength(1);
        expect(parsed.items[0].code).toBe(GABARITO.item.codigo);
        expect(parsed.totalValue).toBeCloseTo(GABARITO.totalNf, 2);
      }
    });
  }

  it("sem evidência do nome (linhas removidas), o campo fica PENDENTE — nunca inventado", () => {
    const { reports } = parseReportInput(readFileSync(PNG_REPORT, "utf8"));
    for (const payload of reports) {
      const merged = mergeDanfeTexts(payload.pageOcrText ?? "", payload.regionTexts ?? []);
      const withoutNames = merged
        .split("\n")
        .filter((line) => !/INCOTECH COMPANY LTDA|MUNICIPIO DE CAPIVARI/i.test(line))
        .join("\n");
      const parsed = parseDanfeText(withoutNames);
      expect(parsed.emitterName).toBeUndefined();
      expect(parsed.receiverName).toBeUndefined();
      expect(parsed.emitterCnpj).toBe(GABARITO.cnpjEmitente); // CNPJ preservado
      expect(parsed.emitterPendingName ?? parsed.receiverPendingName).toBeTruthy();
      const missing = danfeFieldSummary(parsed).missing;
      expect(missing.join("|")).toMatch(/Razão social/);
    }
  });
});

// ─── 3. Divergência entre leitura OCR e chave ────────────────────────────────

describe("R23 — 3. Chave de acesso confere ANO/MÊS; o dia nunca vem da chave", () => {
  it("data em conflito com o AAMM da chave fica pendente (sem inferir nada)", () => {
    const parsed = parseDanfeText(
      [`CHAVE DE ACESSO: ${ACCESS_KEY}`, "DATA DE EMISSAO: 02/10/2026"].join("\n"),
    );
    expect(parsed.emissionDate).toBeUndefined();
    expect(okOf(parsed, "emissionDate")).toBe(false);
    expect(noteOf(parsed, "emissionDate")).toMatch(/AAMM/);
    expect(noteOf(parsed, "emissionDate")).toMatch(/\(09\/2026\)/); // MM/AAAA legível
  });

  it("sem data no documento, a chave NÃO determina o dia: campo pendente", () => {
    const parsed = parseDanfeText(`CHAVE DE ACESSO: ${ACCESS_KEY}`);
    expect(parsed.emissionDate).toBeUndefined();
    expect(noteOf(parsed, "emissionDate")).toMatch(/Somente o mês\/ano/);
    expect(noteOf(parsed, "emissionDate")).toMatch(/\(09\/2026\)/);
  });

  it("quando o mês/ano conferem, a nota explicita que o DIA não é validado pela chave", () => {
    const parsed = parseDanfeText(
      [`CHAVE DE ACESSO: ${ACCESS_KEY}`, "DATA DE EMISSAO: 28/09/2026"].join("\n"),
    );
    expect(parsed.emissionDate).toBe("2026-09-28"); // dia vem do documento
    expect(noteOf(parsed, "emissionDate")).toMatch(/o dia não é codificado pela chave/i);
  });
});

// ─── 4. Zero itens ───────────────────────────────────────────────────────────

describe("R23 — 4. Sem itens identificados: zero itens, nunca “todos associados”", () => {
  it("PDF sem a linha do item: nenhum item é inventado e a pendência aparece", async () => {
    const layer = await extractTextFromPdfStreams(new Uint8Array(readFileSync(PDF_FIXTURE)));
    const withoutItem = layer
      .split("\n")
      .filter((line) => !line.includes(GABARITO.item.codigo))
      .join("\n");
    const parsed = parseDanfeText(withoutItem);
    expect(parsed.items).toHaveLength(0);
    expect(okOf(parsed, "items")).toBe(false);
    expect(noteOf(parsed, "items")).toMatch(/Nenhum item identificado/);
    expect(danfeFieldSummary(parsed).missing).toContain("Itens da NF-e");
    // O total da nota NÃO substitui os itens discriminados.
    expect(parsed.totalValue).toBeCloseTo(GABARITO.totalNf, 2);
  });

  it("nfeItemsAssociationState: lista vazia NUNCA é “todos associados”", () => {
    expect(nfeItemsAssociationState([])).toEqual({ total: 0, pendingCount: 0, allAssociated: false });
    expect(
      nfeItemsAssociationState([{ matchStatus: "found" } as { matchStatus: "found" }]),
    ).toEqual({ total: 1, pendingCount: 0, allAssociated: true });
    expect(
      nfeItemsAssociationState([
        { matchStatus: "found" as const },
        { matchStatus: "not_found" as const },
      ]),
    ).toEqual({ total: 2, pendingCount: 1, allAssociated: false });
  });

  it("tela de conferência: badge condicionado ao total de itens + mensagem de lista vazia", () => {
    expect(REVIEW_TABLE).toContain("allAssociated &&");
    expect(REVIEW_TABLE).toContain("Nenhum item identificado na NF-e");
    expect(REVIEW_TABLE).not.toContain("pendingCount === 0 &&");
  });
});

// ─── 5. Valores financeiros ──────────────────────────────────────────────────

describe("R23 — 5. Quantidade × valor unitário × total × total da NF", () => {
  it("item coerente passa na validação (25 × 52,94 = 1.323,50)", async () => {
    const layer = await extractTextFromPdfStreams(new Uint8Array(readFileSync(PDF_FIXTURE)));
    const parsed = parseDanfeText(layer);
    expect(okOf(parsed, "items")).toBe(true);
    const item = parsed.items[0];
    expect(item.quantity * item.unitValue).toBeCloseTo(item.totalValue, 2);
    expect(parsed.totalValue).toBeCloseTo(parsed.items[0].totalValue, 2);
  });

  it("item incoerente é sinalizado SEM correção silenciosa do documento", () => {
    const parsed = parseDanfeText(
      [
        `CHAVE DE ACESSO: ${ACCESS_KEY}`,
        "1 231071 KIT TECLADO E MOUSE USB SLIM CHOCO 84716053 PC 25 52,94 999,99",
      ].join("\n"),
    );
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].totalValue).toBeCloseTo(999.99, 2); // valor impresso preservado
    expect(okOf(parsed, "items")).toBe(false);
    expect(noteOf(parsed, "items")).toMatch(/sem coerência/i);
  });

  it("total da nota divergente da soma dos itens é sinalizado, nunca corrigido", async () => {
    const layer = await extractTextFromPdfStreams(new Uint8Array(readFileSync(PDF_FIXTURE)));
    const divergent = layer.replace("VALOR TOTAL DA NOTA: 1323.50", "VALOR TOTAL DA NOTA: 1500,00");
    const parsed = parseDanfeText(divergent);
    expect(parsed.totalValue).toBeCloseTo(1500, 2); // valor do documento preservado
    expect(parsed.notes?.totalValue ?? "").toMatch(/Divergência/);
    expect(parsed.notes?.totalValue ?? "").toMatch(/1323\.50/);
  });
});

// ─── 6. Tela de conferência (fonte dos componentes) ──────────────────────────

describe("R23 — 6. Interface: fornecedor/CNPJ separados e textos da chave", () => {
  it("diálogo de importação: CNPJ do fornecedor em linha própria (sem concatenação)", () => {
    expect(DIALOG).not.toContain("float-right text-xs text-muted-foreground");
    expect(DIALOG).toContain("flex min-w-0 flex-col leading-tight");
    expect(DIALOG).toContain("CNPJ pendente de conferência");
  });

  it("conferência da entrada: nome do fornecedor e CNPJ em blocos separados", () => {
    expect(ENTRIES).toContain("Fornecedor identificado:");
    expect(ENTRIES).not.toContain('<span className="text-muted-foreground"> CNPJ ');
    expect(ENTRIES).toContain("CNPJ pendente de conferência");
  });

  it("chave de acesso exibida agrupada com contagem de dígitos e status do DV", () => {
    expect(formatAccessKeyGrouped(ACCESS_KEY)).toBe(
      "4226 0922 8163 1500 0144 5500 1000 0029 6715 1544 0064",
    );
    expect(DIALOG).toContain("formatAccessKeyGrouped(parsed.accessKey)");
    expect(DIALOG).toContain("dígito verificador");
    expect(ENTRIES).toContain("formatAccessKeyGrouped(nfeAccessKeyDigits)");
  });
});

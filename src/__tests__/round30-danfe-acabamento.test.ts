/**
 * RODADA 30 — ACABAMENTO DA IMPORTAÇÃO DANFE E CONFERÊNCIA FISCAL
 *
 * Cobre, com as linhas REAIS do OCR da DANFE Incotech:
 *   1. data ISO → DD/MM/AAAA na interface (estado permanece ISO);
 *   2. máscara de leitura da chave no formato impresso + 44 dígitos crus;
 *   3. reconciliação de item com CST estruturado (não na descrição);
 *   4. remoção das comparações exclusivas de teste da interface de produção.
 *
 * Nenhum banco, estoque ou registro é criado/modificado.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  digitsOnly,
  formatAccessKeyGrouped,
  formatAccessKeyPrint,
  formatIsoDateBrazilian,
  isValidAccessKey,
  normalizeAccessKey,
} from "@/lib/br-validators";
import { parseDanfeText, type DanfeParseResult } from "@/lib/danfe-ocr";

const ACCESS_KEY = "42260922816315000144550010000029671515440064";
const ACCESS_KEY_PRINTED =
  "42.2609.22.816.315/0001-44-55-001-000.002.967-151.544.006-4";

const ENTRIES = readFileSync(
  resolve(__dirname, "..", "pages", "Entries.tsx"),
  "utf8",
);
const DIALOG = readFileSync(
  resolve(__dirname, "..", "components", "DanfeImportDialog.tsx"),
  "utf8",
);

// ─── Linhas reais do OCR (página inteira + região) ──────────────────────────
const LINHA_PAGINA_INTEGRAL =
  "231071 KIT TECLADO E MOUSE USB SLIM CHOCO | 84716053 25,0000 52,94 1.323,50] 00,00";
const LINHA_REGIAO =
  "1071 KIT TECLADO E MOUSE USB SLIM CHOCO 84716053 [0102] PC 25,0000 52,94 1.323,50] 00,0";
const MERGED = [LINHA_PAGINA_INTEGRAL, LINHA_REGIAO].join("\n");

// ─── 1. Data brasileira ─────────────────────────────────────────────────────

describe("R30 §1 — data ISO → DD/MM/AAAA sem conversão de fuso", () => {
  it("formata datas válidas decompondo a string ISO diretamente", () => {
    expect(formatIsoDateBrazilian("2026-09-28")).toBe("28/09/2026");
    expect(formatIsoDateBrazilian("2026-01-01")).toBe("01/01/2026");
    expect(formatIsoDateBrazilian("2026-12-31")).toBe("31/12/2026");
  });

  it("não muda o dia por fuso: nenhum Date()/timezone no caminho", () => {
    // O helper só aceita o padrão AAAA-MM-DD e devolve a decomposição — se
    // passasse por Date, 2026-09-28 em -03:00 poderia virar 27/09.
    const src = readFileSync(
      resolve(__dirname, "..", "lib", "br-validators.ts"),
      "utf8",
    );
    const corpo = src.slice(
      src.indexOf("export function formatIsoDateBrazilian"),
      src.indexOf("// ─── Normalização"),
    );
    expect(corpo).not.toContain("new Date(");
    expect(corpo).not.toContain("Date.UTC");
    expect(corpo).not.toContain("getTime");
  });

  it("valores ausentes exibem travessão e nunca inventam data", () => {
    expect(formatIsoDateBrazilian(undefined)).toBe("—");
    expect(formatIsoDateBrazilian(null)).toBe("—");
    expect(formatIsoDateBrazilian("")).toBe("—");
  });

  it("datas inválidas são devolvidas como estão — sem formatar errado", () => {
    expect(formatIsoDateBrazilian("2026-13-45")).toBe("2026-13-45");
    expect(formatIsoDateBrazilian("2026-00-10")).toBe("2026-00-10");
    expect(formatIsoDateBrazilian("28/09/2026")).toBe("28/09/2026");
    expect(formatIsoDateBrazilian("2026-9-28")).toBe("2026-9-28");
    expect(formatIsoDateBrazilian("não é data")).toBe("não é data");
  });

  it("as duas telas usam o helper e mantêm o estado em ISO", () => {
    expect(ENTRIES).toContain("formatIsoDateBrazilian(nfe.emissionDate)");
    expect(DIALOG).toContain("formatIsoDateBrazilian(parsed.emissionDate)");
    // Estado/persistência continuam ISO (digits/ISO nunca viram pt-BR).
    expect(ENTRIES).toContain('emissionDate: result.emissionDate ?? ""');
  });
});

// ─── 2. Chave de acesso: máscara de leitura × 44 dígitos ────────────────────

describe("R30 §5 — chave de acesso: apresentação e valor interno", () => {
  it("a máscara de impressão reproduz exatamente o formato do PDF", () => {
    expect(formatAccessKeyPrint(ACCESS_KEY)).toBe(ACCESS_KEY_PRINTED);
  });

  it("a representação em blocos de 4 permanece disponível", () => {
    expect(formatAccessKeyGrouped(ACCESS_KEY)).toBe(
      "4226 0922 8163 1500 0144 5500 1000 0029 6715 1544 0064",
    );
  });

  it("colagem com pontuação recupera os 44 dígitos sem alteração", () => {
    const colado = "42.2609.22.816.315/0001-44-55-001-000.002.967-151.544.006-4";
    expect(digitsOnly(colado)).toBe(ACCESS_KEY);
    expect(normalizeAccessKey(colado)).toBe(ACCESS_KEY);
    expect(digitsOnly(formatAccessKeyPrint(ACCESS_KEY))).toBe(ACCESS_KEY);
    expect(digitsOnly(formatAccessKeyGrouped(ACCESS_KEY))).toBe(ACCESS_KEY);
  });

  it("a chave real passa na validação de 44 dígitos + DV", () => {
    expect(ACCESS_KEY).toHaveLength(44);
    expect(isValidAccessKey(ACCESS_KEY)).toBe(true);
    // A chave com DV errado (digitada com '066' no final) NÃO passa.
    expect(isValidAccessKey(ACCESS_KEY.slice(0, 43) + "0")).toBe(false);
  });

  it("entrada parcial não recebe máscara inventada", () => {
    expect(formatAccessKeyPrint("422609")).toBe("422609");
    expect(formatAccessKeyPrint("")).toBe("");
    expect(formatAccessKeyPrint(undefined)).toBe("");
  });

  it("as telas mantêm cópia dos 44 dígitos crus e exibem a máscara", () => {
    // Botão de cópia copia SOMENTE dígitos (estado/persistência/cópia = 44 dígitos).
    expect(ENTRIES).toContain("navigator.clipboard.writeText(nfeAccessKeyDigits)");
    expect(ENTRIES).toContain("Copiar chave (44 dígitos)");
    expect(DIALOG).toContain(
      '"Chave de acesso copiada (44 dígitos, sem formatação)"',
    );
    // Máscara de leitura presente nas duas telas.
    expect(ENTRIES).toContain("formatAccessKeyPrint(nfeAccessKeyDigits)");
    expect(DIALOG).toContain("formatAccessKeyPrint(parsed.accessKey)");
    // A máscara NUNCA entra no valor persistido: o campo grava só dígitos.
    expect(ENTRIES).toContain(
      "setNfeAccessKey(digitsOnly(event.target.value).slice(0, 44))",
    );
  });
});

// ─── 3. Reconciliação de item + CST estruturado ─────────────────────────────

describe("R30 §4 — reconciliação das duas leituras reais com CST separado", () => {
  const parsed: DanfeParseResult = parseDanfeText(MERGED);

  it("produz exatamente UM item com os campos fiscais separados", () => {
    expect(parsed.items).toHaveLength(1);
    const [item] = parsed.items;
    expect(item.code).toBe("231071");
    expect(item.description).toBe("KIT TECLADO E MOUSE USB SLIM CHOCO");
    expect(item.description).not.toContain("84716053");
    expect(item.description).not.toContain("0102");
    expect(item.ncm).toBe("84716053");
    expect(item.cst).toBe("0102");
    expect(item.unit).toBe("PC");
    expect(item.quantity).toBe(25);
    expect(item.unitValue).toBeCloseTo(52.94, 5);
    expect(item.totalValue).toBeCloseTo(1323.5, 5);
  });

  it("soma dos itens = total da nota (sem duplicação de quantidade/valor)", () => {
    const soma = parsed.items.reduce((acc, i) => acc + i.totalValue, 0);
    expect(soma).toBeCloseTo(1323.5, 2);
  });

  it("dois produtos genuinamente distintos não são fundidos", () => {
    const distintos = parseDanfeText(
      [
        "100001 TECLADO USB 10 52,94 529,40",
        "200002 MOUSE USB 10 52,94 529,40",
      ].join("\n"),
    );
    expect(distintos.items).toHaveLength(2);
    expect(distintos.items[0].code).toBe("100001");
    expect(distintos.items[1].code).toBe("200002");
  });

  it("CST é transportado até a conferência NF-e e exibido separado do NCM", () => {
    // O mapeamento DANFE → NfeData preserva o CST estruturado.
    expect(ENTRIES).toContain("cst: item.cst,");
    // A exibição na conferência mostra NCM e CST em campos distintos.
    expect(ENTRIES).not.toBe(""); // sanidade
    const review = readFileSync(
      resolve(__dirname, "..", "components", "NfeReviewTable.tsx"),
      "utf8",
    );
    expect(review).toContain("NCM {review.item.ncm}");
    expect(review).toContain("CST {review.item.cst}");
    // NCM/CST nunca são misturados na descrição; na prévia do diálogo cada
    // identificador vive em seu próprio elemento (R31.3 §3 substituiu o
    // join colado por elementos separados com espaçamento explícito).
    expect(DIALOG).toContain("NCM {item.ncm}");
    expect(DIALOG).toContain("CST {item.cst}");
    expect(DIALOG).not.toContain('join(" · ")');
  });
});

// ─── 4. Sem checagem exclusiva de teste na interface de produção ────────────

describe("R30 §6 — interface de produção sem referência ao documento de teste", () => {
  it("Entries.tsx não contém chave/CNPJ fixos de teste nem mensagens exclusivas", () => {
    expect(ENTRIES).not.toContain("INCOTECH_TEST_ACCESS_KEY");
    expect(ENTRIES).not.toContain("INCOTECH_TEST_CNPJ");
    expect(ENTRIES).not.toContain("nfeIncotechCheck");
    expect(ENTRIES).not.toContain("DANFE de teste");
    expect(ENTRIES).not.toContain("teste Incotech");
  });

  it("DanfeImportDialog.tsx não contém chave/CNPJ fixos de teste", () => {
    expect(DIALOG).not.toContain("INCOTECH_TEST_ACCESS_KEY");
    expect(DIALOG).not.toContain("INCOTECH_TEST_CNPJ");
    expect(DIALOG).not.toContain("incotechCheck");
    // Validação fiscal genérica permanece (44 dígitos + DV).
    expect(DIALOG).toContain("validateAccessKey44(parsed.accessKey ?? \"\")");
    expect(ENTRIES).toContain("validateAccessKey44(nfeAccessKey)");
  });
});

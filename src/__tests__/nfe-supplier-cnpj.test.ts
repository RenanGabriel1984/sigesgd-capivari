/**
 * SIGESGD CAPIVARI — VÍNCULO DE FORNECEDOR POR CNPJ NA IMPORTAÇÃO NF-e
 *
 * Cenário real: NF-e 372043 do emitente
 *   CNPJ 61457941000143 — GOMAQ MAQUINAS PARA ESCRITORIO LTDA
 *
 * Regra: o CNPJ é o identificador PRINCIPAL do matching (com ou sem máscara).
 * A razão social só complementa visualmente e NUNCA sobrescreve um CNPJ
 * divergente. Estos testes são puros: NÃO escrevem no banco e NÃO alteram estoque.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  findSupplierMatch,
  formatCnpj,
  digitsOnly,
  type NfeData,
  type SupplierForMatch,
} from "@/lib/nfe";

const GOMAQ_CNPJ = "61457941000143";
const GOMAQ_MASKED = "61.457.941/0001-43";
const GOMAQ_XML_NAME = "GOMAQ MAQUINAS PARA ESCRITORIO LTDA";

const gomaqDigits: SupplierForMatch = { _id: "sup_gomaq", legalName: GOMAQ_XML_NAME, cnpj: GOMAQ_CNPJ };
const gomaqMasked: SupplierForMatch = { _id: "sup_gomaq", legalName: "Gomaq Maquinas para Escritorio Ltda", cnpj: GOMAQ_MASKED };
const testSupplier: SupplierForMatch = { _id: "sup_teste", legalName: "Renan Raitano", cnpj: "000000000000000" };

const nfe = (emitterCnpj?: string, emitterName?: string): NfeData => ({
  accessKey: "35260961457941000143550010003720431466669127",
  number: "372043",
  series: "1",
  emissionDate: "2026-09-01",
  emitterCnpj,
  emitterName,
  items: [],
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. CNPJ como identificador principal
// ═══════════════════════════════════════════════════════════════════════════

describe("findSupplierMatch — CNPJ identifica o fornecedor", () => {
  it("CNPJ 61457941000143 sem máscara no XML encontra o cadastro Gomaq", () => {
    const m = findSupplierMatch(nfe(GOMAQ_CNPJ, GOMAQ_XML_NAME), [gomaqDigits, testSupplier]);
    expect(m.found).toBe(true);
    expect(m.byCnpj).toBe(true);
    expect(m.supplierId).toBe("sup_gomaq");
  });

  it("CNPJ com máscara no XML encontra o cadastro gravado sem máscara", () => {
    const m = findSupplierMatch(nfe(GOMAQ_MASKED, GOMAQ_XML_NAME), [gomaqDigits, testSupplier]);
    expect(m.found).toBe(true);
    expect(m.byCnpj).toBe(true);
    expect(m.supplierId).toBe("sup_gomaq");
  });

  it("cadastro gravado com máscara encontra o CNPJ do XML sem máscara", () => {
    const m = findSupplierMatch(nfe(GOMAQ_CNPJ, GOMAQ_XML_NAME), [gomaqMasked, testSupplier]);
    expect(m.found).toBe(true);
    expect(m.supplierId).toBe("sup_gomaq");
  });

  it("razão social DIFERENTE mas mesmo CNPJ → o CNPJ vence e identifica", () => {
    const m = findSupplierMatch(nfe(GOMAQ_CNPJ, "OUTRA RAZAO SOCIAL QUALQUER SA"), [gomaqMasked, testSupplier]);
    expect(m.found).toBe(true);
    expect(m.byCnpj).toBe(true);
    expect(m.supplierId).toBe("sup_gomaq");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. CNPJ divergente nunca é sobrescrito por nome (fallback é visual)
// ═══════════════════════════════════════════════════════════════════════════

describe("findSupplierMatch — razão social só complementa", () => {
  it("razão social IGUAL mas CNPJ divergente → não vincula, devolve sugestão visual", () => {
    const outra: SupplierForMatch = { _id: "sup_outro", legalName: GOMAQ_XML_NAME, cnpj: "99999999999999" };
    const m = findSupplierMatch(nfe(GOMAQ_CNPJ, GOMAQ_XML_NAME), [outra, testSupplier]);
    expect(m.found).toBe(false);
    expect(m.supplierId).toBeUndefined();
    expect(m.suggestedSupplierId).toBe("sup_outro");
    expect(m.suggestedSupplierName).toBe(GOMAQ_XML_NAME);
  });

  it("o fornecedor de teste NUNCA é associado à NF da Gomaq", () => {
    const m = findSupplierMatch(nfe(GOMAQ_CNPJ, GOMAQ_XML_NAME), [testSupplier]);
    expect(m.found).toBe(false);
    expect(m.supplierId).toBeUndefined();
    expect(m.suggestedSupplierId).toBeUndefined();
  });

  it("cadastro sem CNPJ registrado permanece com fallback por razão social", () => {
    const semCnpj: SupplierForMatch = { _id: "sup_gomaq2", legalName: "Gomaq Maquinas para Escritorio Ltda", cnpj: null };
    const m = findSupplierMatch(nfe(GOMAQ_CNPJ, GOMAQ_XML_NAME), [semCnpj, testSupplier]);
    expect(m.found).toBe(true);
    expect(m.byCnpj).toBe(false);
    expect(m.supplierId).toBe("sup_gomaq2");
  });

  it("nenhum candidato → fornecedor não cadastrado (UI oferece cadastro com dados fiscais)", () => {
    const m = findSupplierMatch(nfe(GOMAQ_CNPJ, GOMAQ_XML_NAME), [
      { _id: "sup_outro", legalName: "Papelaria Central", cnpj: "12.345.678/0001-90" },
    ]);
    expect(m.found).toBe(false);
    expect(m.supplierId).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Normalização de CNPJ
// ═══════════════════════════════════════════════════════════════════════════

describe("formatCnpj / digitsOnly", () => {
  it("formata 14 dígitos no padrão brasileiro", () => {
    expect(formatCnpj(GOMAQ_CNPJ)).toBe(GOMAQ_MASKED);
  });
  it("valor já formatado permanece intacto", () => {
    expect(formatCnpj(GOMAQ_MASKED)).toBe(GOMAQ_MASKED);
  });
  it("valor não padronizado é devolvido como está", () => {
    expect(formatCnpj("000")).toBe("000");
    expect(formatCnpj(undefined)).toBe("");
  });
  it("digitsOnly remove toda a pontuação", () => {
    expect(digitsOnly(GOMAQ_MASKED)).toBe(GOMAQ_CNPJ);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. UI da conferência (garantias estáticas)
// ═══════════════════════════════════════════════════════════════════════════

describe("Entries.tsx — conferência da NF-e", () => {
  const ENTRIES = readFileSync(resolve(__dirname, "..", "..", "src", "pages", "Entries.tsx"), "utf8");

  it("mostra 'Fornecedor identificado' com nome + CNPJ quando o matching encontra", () => {
    expect(ENTRIES).toContain("Fornecedor identificado:");
    expect(ENTRIES).toContain("formatCnpj(nfeSupplier.cnpj)");
  });

  it("mantém 'Fornecedor não cadastrado' + botão de cadastro com dados fiscais do XML", () => {
    expect(ENTRIES).toContain("Fornecedor não cadastrado");
    expect(ENTRIES).toContain("Cadastrar fornecedor");
    expect(ENTRIES).toContain('setNewSupplierCnpj(nfe.emitterCnpj ?? "")');
  });

  it("dropdown 'Selecionar fornecedor' exibe o CNPJ para desambiguar cadastros", () => {
    expect(ENTRIES).toContain("${s.legalName} — ${formatCnpj(s.cnpj)}");
  });
});

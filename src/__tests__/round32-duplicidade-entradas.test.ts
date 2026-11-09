/**
 * R32 — D5: anti-duplicidade da entrada.
 *
 * A comparação de notas vive em `src/lib/entry-duplicates.ts`, que é o MÓDULO
 * IMPORTADO POR `src/convex/entries.ts` (create e confirm). Este teste exercita
 * essa regra de produção.
 *
 * LIMITAÇÃO DECLARADA: o projeto não tem `convex-test` e não é permitido
 * publicar funções nesta etapa, então a mutation `entries.create` NÃO é
 * executada aqui. A ligação backend → módulo é conferida no último bloco e
 * identificada como verificação estática, não como prova de runtime.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  duplicateInvoiceMessage,
  entryInvoiceFingerprint,
  findDuplicateInvoice,
  isSameInvoice,
  normalizeAccessKey,
  normalizeInvoiceNumber,
  normalizeSeries,
  type EntryInvoiceIdentity,
} from "@/lib/entry-duplicates";

const CONFIRMED: EntryInvoiceIdentity = {
  _id: "e1",
  entryNumber: "ENT-2026-000010",
  status: "confirmed",
  accessKey: "42260922816315000144550010000029671515440064",
  invoiceNumber: "000002967",
  series: "001",
  supplierId: "supplier-a",
};

describe("R32/D5 — normalização", () => {
  it("número da nota ignora máscara, espaços e zeros à esquerda", () => {
    expect(normalizeInvoiceNumber("000002967")).toBe("2967");
    expect(normalizeInvoiceNumber(" 2967 ")).toBe("2967");
    expect(normalizeInvoiceNumber("NF 2967/1")).toBe("NF2967/1");
    expect(normalizeInvoiceNumber("abc-12")).toBe("ABC-12");
    expect(normalizeInvoiceNumber("")).toBe("");
  });

  it("série 001 e 1 são a mesma série", () => {
    expect(normalizeSeries("001")).toBe("1");
    expect(normalizeSeries("1")).toBe("1");
    expect(normalizeSeries("")).toBe("");
  });

  it("chave de acesso só é considerada com 44 dígitos", () => {
    expect(normalizeAccessKey(CONFIRMED.accessKey)).toBe(CONFIRMED.accessKey);
    expect(normalizeAccessKey("4226 0922 8163 1500 0144 5500 1000 0029 6715 1544 0064")).toBe(
      CONFIRMED.accessKey,
    );
    expect(normalizeAccessKey("123")).toBe("");
    expect(normalizeAccessKey(undefined)).toBe("");
  });

  it("impressão digital usa valores normalizados e o fornecedor", () => {
    expect(
      entryInvoiceFingerprint({
        supplierId: "supplier-a",
        invoiceNumber: "000002967",
        series: "001",
      }),
    ).toBe("nf:2967|ser:1|sup:supplier-a");

    expect(
      entryInvoiceFingerprint({ invoiceNumber: "2967", series: "1" }),
    ).toBe("nf:2967|ser:1");

    expect(entryInvoiceFingerprint({ invoiceNumber: "" })).toBeUndefined();
  });
});

describe("R32/D5 — mesma nota", () => {
  it("reconhece a mesma nota com número/série mascarados", () => {
    expect(
      isSameInvoice(CONFIRMED, {
        invoiceNumber: "2967",
        series: "1",
        supplierId: "supplier-a",
      }),
    ).toBe(true);
  });

  it("chave de acesso igual vence divergências de digitação", () => {
    expect(
      isSameInvoice(CONFIRMED, {
        accessKey: CONFIRMED.accessKey,
        invoiceNumber: "999",
        series: "9",
      }),
    ).toBe(true);
  });

  it("chaves diferentes são documentos diferentes (reemissão com mesmo número)", () => {
    expect(
      isSameInvoice(CONFIRMED, {
        accessKey: "42260922816315000144550010000029671515440065",
        invoiceNumber: "2967",
        series: "1",
      }),
    ).toBe(false);
  });

  it("fornecedor diferente ou série diferente não é a mesma nota", () => {
    expect(
      isSameInvoice(CONFIRMED, {
        invoiceNumber: "2967",
        series: "1",
        supplierId: "supplier-b",
      }),
    ).toBe(false);

    expect(
      isSameInvoice(CONFIRMED, {
        invoiceNumber: "2967",
        series: "2",
        supplierId: "supplier-a",
      }),
    ).toBe(false);
  });

  it("entrada estornada nunca bloqueia nova tentativa", () => {
    expect(
      isSameInvoice(
        { ...CONFIRMED, status: "reversed" },
        { invoiceNumber: "2967", series: "1", supplierId: "supplier-a" },
      ),
    ).toBe(false);
  });

  it("não considera duplicata quando não há número nem chave", () => {
    expect(isSameInvoice({ supplierId: "supplier-a" }, { supplierId: "supplier-a" })).toBe(
      false,
    );
  });
});

describe("R32/D5 — busca e mensagem", () => {
  it("ignora a própria entrada e as estornadas", () => {
    const entries: EntryInvoiceIdentity[] = [
      { ...CONFIRMED, _id: "self" },
      { ...CONFIRMED, _id: "rev", status: "reversed", entryNumber: "ENT-2026-000011" },
    ];
    const probe = { invoiceNumber: "2967", series: "1", supplierId: "supplier-a" };

    expect(findDuplicateInvoice(entries, probe, { excludeId: "self" })).toBeUndefined();
    expect(findDuplicateInvoice(entries, probe)?.entryNumber).toBe(
      "ENT-2026-000010",
    );
  });

  it("mensagem distingue rascunho existente de nota já confirmada", () => {
    expect(duplicateInvoiceMessage({ ...CONFIRMED, status: "draft" }, {})).toMatch(
      /RASCUNHO/,
    );
    expect(
      duplicateInvoiceMessage(CONFIRMED, { invoiceNumber: "000002967" }),
    ).toMatch(/já foi registrada.*Não é possível duplicar o estoque/s);
  });
});

describe("R32/D5 — ligação com o backend (verificação estática)", () => {
  const ENTRIES = readFileSync(resolve(__dirname, "../convex/entries.ts"), "utf8");
  const SCHEMA = readFileSync(resolve(__dirname, "../convex/schema.ts"), "utf8");

  it("create e confirm usam a mesma regra de duplicidade", () => {
    expect(ENTRIES).toContain("from \"../lib/entry-duplicates\"");
    expect(ENTRIES).toContain("findDuplicateInvoice(");
    // create → valida antes de inserir; confirm → segunda barreira.
    expect(ENTRIES.match(/findExistingInvoice\(/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(ENTRIES).toContain("duplicateInvoiceMessage(");
  });

  it("a entrada grava a impressão digital e o schema tem o índice da busca", () => {
    expect(ENTRIES).toContain("const invoiceFingerprint = entryInvoiceFingerprint({");
    expect(ENTRIES).toContain("invoiceFingerprint,");
    expect(SCHEMA).toContain("invoiceFingerprint: v.optional(v.string())");
    expect(SCHEMA).toContain('.index("by_invoice_fingerprint", ["invoiceFingerprint"])');
  });

  it("create devolve id + número do rascunho (recuperação D4)", () => {
    expect(ENTRIES).toContain("return { entryId, entryNumber };");
  });
});

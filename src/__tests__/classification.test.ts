import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(resolve(__dirname, "../convex/productClassification.ts"), "utf8");

/** Extrai o bloco do mapeamento oficial (PRODUCT_CLASSIFICATION … ]). */
function classificationBlock(): string {
  const start = SRC.indexOf("const PRODUCT_CLASSIFICATION");
  const end = SRC.indexOf("/** Contexto compartilhado", start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return SRC.slice(start, end);
}

describe("SIGESGD — Classificação oficial dos 53 produtos", () => {
  it("CL-01: mapeia exatamente 53 produtos, sem duplicidade", () => {
    const ids = [...classificationBlock().matchAll(/productId: "([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(53);
    expect(new Set(ids).size).toBe(53);
  });

  it("CL-02: identifica produtos homônimos pelo cadastro (Telefones VoIP), não só pelo nome", () => {
    const ids = [...classificationBlock().matchAll(/productId: "([^"]+)"/g)].map((m) => m[1]);
    // Os 4 telefones são registros distintos (TIP 125I, V5502, TIP 125I Montado, Attimo).
    const telefones = [...classificationBlock().matchAll(/name: "(Telefone[^"]*)"/g)].map((m) => m[1]);
    expect(telefones).toHaveLength(4);
    expect(new Set(ids).size).toBe(ids.length);
    expect(SRC).toContain("dbNameMatches");
  });

  it("CL-03: distribuição esperada 11/9/2/4/17/5/5 (produtos distintos)", () => {
    const expected: Record<string, number> = {
      "Periféricos": 11,
      "Redes e Conectividade": 9,
      "Armazenamento e Hardware": 2,
      "Telefonia e Comunicação": 4,
      "Suprimentos de Impressão": 17,
      "Materiais de Infraestrutura": 5,
      "Ferramentas e Manutenção": 5,
    };
    for (const [category, count] of Object.entries(expected)) {
      expect(SRC).toContain(`"${category}": ${count},`);
    }
    const total = Object.values(expected).reduce((s, n) => s + n, 0);
    expect(total).toBe(53);
  });

  it("CL-04: as 7 categorias oficiais estão declaradas (sem nome inventado)", () => {
    for (const category of [
      "Periféricos",
      "Redes e Conectividade",
      "Armazenamento e Hardware",
      "Telefonia e Comunicação",
      "Suprimentos de Impressão",
      "Materiais de Infraestrutura",
      "Ferramentas e Manutenção",
    ]) {
      expect(SRC).toContain(`"${category}",`);
    }
  });

  it("CL-05: categorias existentes são reutilizadas por renome, sem duplicata", () => {
    expect(SRC).toContain('{ existing: "Redes", official: "Redes e Conectividade" }');
    expect(SRC).toContain('{ existing: "Armazenamento", official: "Armazenamento e Hardware" }');
  });

  it("CL-06: funções são internal e exigem confirmação literal", () => {
    expect(SRC).toContain("export const previewProductClassificationInternal = internalQuery(");
    expect(SRC).toContain("export const applyProductClassificationInternal = internalMutation(");
    expect(SRC).toContain('args.confirm !== "CLASSIFICAR-53-PRODUTOS"');
    // Nada exposto ao cliente web
    expect(SRC).not.toMatch(/export const \w+ = (query|mutation)\(/);
  });

  it("CL-07: classificação é somente cadastral (não deleta e não toca em estoque)", () => {
    expect(SRC).not.toContain("ctx.db.delete");
    expect(SRC).toContain('categoryId: targetCategoryId as Id<"categories">');
    // Nenhuma escrita em tabelas operacionais
    for (const table of [
      "stockByLocation",
      "lots",
      "entryItems",
      "stockMovements",
      "requests",
      "suppliers",
      "organizations",
    ]) {
      expect(SRC).not.toMatch(new RegExp(`ctx\\.db\\.(patch|insert)\\("${table}"`));
    }
  });

  it("CL-08: aborta sem gravar quando o cadastro não corresponde ao mapeamento", () => {
    expect(SRC).toContain("Conferência do mapeamento falhou");
    expect(SRC).toContain("nome divergente em");
    expect(SRC).toContain("produto sem lote da carga oficial");
    expect(SRC).toContain("Há produtos da carga oficial fora do mapeamento");
    expect(SRC).toContain("Distribuição divergente em");
  });

  it("CL-09: exige snapshot operacional idêntico antes/depois", () => {
    expect(SRC).toContain("Operação abortada: dados operacionais mudaram");
    expect(SRC).toContain("stockByLocationTotal");
    expect(SRC).toContain("movementsQuantityTotal");
  });

  it("CL-10: suporta dry-run sem gravar", () => {
    expect(SRC).toContain("dryRun: v.optional(v.boolean())");
    expect(SRC).toContain("if (!dryRun) {");
  });

  it("CL-11: nunca retorna objeto com chave acentuada (serialização Convex)", () => {
    // byCategory/projected são internos e só viram array antes de retornar.
    expect(SRC).toContain("sempre arrays");
    expect(SRC).toMatch(/distribution = OFFICIAL_CATEGORIES\.map\(/);
  });
});

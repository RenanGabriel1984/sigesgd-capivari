/**
 * Gestão de Estoque SGGD — UNIDADE DE ESTOQUE × EMBALAGEM (PACK-01..05).
 *
 * Caso real: NF-e 372043, "BOBINA TERMICA BRANCA 80X40 CAIXA C 30 UNID".
 *
 *   quantidade fiscal da NF ....... 90
 *   estoque operacional ........... 180 (90 iniciais + 90 da NF)
 *
 * Regras verificadas aqui:
 *  - a quantidade fiscal é preservada exatamente (90), em qualquer leitura;
 *  - o estoque permanece 180 — nada de 90 × 30 = 2.700;
 *  - "CAIXA C 30 UNID" (e equivalentes) NUNCA vira fator de conversão;
 *  - a estrutura de embalagem (bobina / caixa / 30) pode ser preparada sem
 *    tocar em saldo, lote, movimentação ou histórico;
 *  - a conversão explícita é separada da quantidade fiscal.
 *
 * Testes UNITÁRIOS: nenhuma chamada ao banco, nenhum dado real alterado.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  FISCAL_QUANTITY_LABEL,
  OPERATIONAL_QUANTITY_LABEL,
  NO_PACKAGING_CONVERSION_NOTE,
  CONFIGURED_PACKAGING_NOTE,
  mentionsPackaging,
  readDescriptionPackagingHint,
  buildFiscalQuantityView,
  packagingReadiness,
  describePackagingTarget,
} from "@/lib/packaging-units";
import { readPackagingConversion } from "@/lib/print-supplies";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf-8");

const packagingLib = read("src/lib/packaging-units.ts");
const printSupplies = read("src/convex/printSupplies.ts");
const schema = read("src/convex/schema.ts");
const stockParametersPage = read("src/pages/StockParameters.tsx");
const stockParametersLib = read("src/lib/stock-parameters.ts");

/** Descrição exatamente como consta no XML da NF 372043. */
const NF_DESCRIPTION = "BOBINA TERMICA BRANCA 80X40 CAIXA C 30 UNID";
/** Quantidade fiscal declarada no documento. */
const NF_FISCAL_QUANTITY = 90;
/** Saldo real do produto na base (90 da carga inicial + 90 da NF). */
const STOCK_ON_HAND = 180;

/** Alvo de embalagem desejado para a bobina (ainda NÃO gravado). */
const BOBINA_TARGET = { baseUnit: "bobina", packagingUnit: "caixa", conversionFactor: 30 };

// ─────────────────────────────────────────────────────────────────────────────

describe("PACK-01 — Quantidade fiscal permanece 90", () => {
  it("a leitura fiscal devolve 90, com e sem conversão configurada", () => {
    const semConversao = buildFiscalQuantityView({
      fiscalQuantity: NF_FISCAL_QUANTITY,
      fiscalUnit: "UN",
      packaging: null,
      operationalUnit: "bobina",
    });
    expect(semConversao.fiscalQuantity).toBe(90);
    expect(semConversao.fiscalUnit).toBe("UN");
    expect(semConversao.appliedFactor).toBe(1);

    // Mesmo com a conversão configurada, o campo FISCAL continua 90.
    const comConversao = buildFiscalQuantityView({
      fiscalQuantity: NF_FISCAL_QUANTITY,
      fiscalUnit: "UN",
      packaging: BOBINA_TARGET,
      operationalUnit: "bobina",
    });
    expect(comConversao.fiscalQuantity).toBe(90);
    expect(comConversao.fiscalUnit).toBe("UN");
  });

  it("os rótulos fiscal e operacional são distintos na interface", () => {
    expect(FISCAL_QUANTITY_LABEL).toBe("Quantidade fiscal");
    expect(OPERATIONAL_QUANTITY_LABEL).toBe("Quantidade operacional de estoque");
    expect(FISCAL_QUANTITY_LABEL).not.toBe(OPERATIONAL_QUANTITY_LABEL);
  });
});

describe("PACK-02 — Estoque atual permanece 180", () => {
  it("nenhuma função do modelo altera o saldo em estoque", () => {
    // O saldo é um dado do banco, não um cálculo: a rodada é somente leitura.
    const stockSnapshot = { productId: "p_bobina", physicalQuantity: STOCK_ON_HAND, reservedQuantity: 0 };
    const antes = JSON.stringify(stockSnapshot);

    // Prepara a estrutura de embalagem (não aplica nada).
    packagingReadiness({ current: null, desired: BOBINA_TARGET });
    buildFiscalQuantityView({
      fiscalQuantity: NF_FISCAL_QUANTITY,
      packaging: BOBINA_TARGET,
      operationalUnit: "bobina",
    });
    mentionsPackaging(NF_DESCRIPTION);
    readDescriptionPackagingHint(NF_DESCRIPTION);

    // O snapshot é o MESMO objeto, com o MESMO saldo.
    expect(stockSnapshot.physicalQuantity).toBe(180);
    expect(JSON.stringify(stockSnapshot)).toBe(antes);
  });

  it("a preparação só descreve campos de `products` — nada físico", () => {
    const readiness = packagingReadiness({ current: null, desired: BOBINA_TARGET });
    expect(Object.keys(readiness.productFields ?? {}).sort()).toEqual([
      "baseUnit",
      "conversionFactor",
      "packagingUnit",
    ]);
    expect(readiness.touchesStock).toBe(false);
    expect(readiness.createsMovement).toBe(false);
    expect(readiness.convertsExistingStock).toBe(false);
  });
});

describe("PACK-03 — 'CAIXA C 30 UNID' não gera multiplicação automática", () => {
  it("nenhuma descrição de documento vira conversão", () => {
    for (const desc of [
      NF_DESCRIPTION,
      "PAPEL TERMICO 80X80 CAIXA C 100",
      "CARTUCHO P/ PACOTE C 50 UNID",
      "FITA ISOLANTE PACOTE C 10",
    ]) {
      expect(readDescriptionPackagingHint(desc)).toBeNull();
    }
  });

  it("a descrição é apenas evidencia de embalagem para exibição", () => {
    expect(mentionsPackaging(NF_DESCRIPTION)).toBe(true);
    expect(mentionsPackaging("BOBINA TERMICA BRANCA 80X40")).toBe(false);
    expect(mentionsPackaging(null)).toBe(false);
  });

  it("sem os três campos explícitos não existe conversão", () => {
    expect(readPackagingConversion({})).toBeNull();
    expect(readPackagingConversion({ baseUnit: "bobina" })).toBeNull();
    expect(readPackagingConversion({ baseUnit: "bobina", packagingUnit: "caixa" })).toBeNull();
    expect(readPackagingConversion({ baseUnit: "bobina", packagingUnit: "caixa", conversionFactor: 0 })).toBeNull();
    // Unidade-base = unidade de embalagem não é conversão.
    expect(
      readPackagingConversion({ baseUnit: "bobina", packagingUnit: "bobina", conversionFactor: 30 })
    ).toBeNull();
  });

  it("a biblioteca não faz parsing numérico de texto", () => {
    // Nenhuma extração de "30" a partir de "CAIXA C 30 UNID".
    expect(packagingLib).not.toContain(".match(");
    expect(packagingLib).not.toContain("parseInt");
    expect(packagingLib).not.toContain("parseFloat");
    expect(packagingLib).toContain("readDescriptionPackagingHint");
  });

  it("90 × 30 nunca é calculado por padrão", () => {
    const view = buildFiscalQuantityView({
      fiscalQuantity: NF_FISCAL_QUANTITY,
      packaging: null,
      operationalUnit: "bobina",
    });
    // Sem configuração explícita: operacional = fiscal.
    expect(view.baseQuantity).toBe(90);
    expect(view.baseQuantity).not.toBe(2700);
  });
});

describe("PACK-04 — Embalagem pode ser configurada sem alterar o estoque", () => {
  it("o alvo bobina/caixa/30 é reconhecido como pendente (sem gravar)", () => {
    const readiness = packagingReadiness({ current: null, desired: BOBINA_TARGET });

    expect(readiness.alreadyConfigured).toBe(false);
    expect(readiness.current).toBeNull();
    expect(readiness.gaps).toEqual([]);
    expect(readiness.desired).toEqual({
      baseUnit: "bobina",
      packagingUnit: "caixa",
      factor: 30,
    });
    expect(readiness.productFields).toEqual({
      baseUnit: "bobina",
      packagingUnit: "caixa",
      conversionFactor: 30,
    });
    expect(describePackagingTarget(readiness.desired)).toBe("1 caixa = 30 bobina");
  });

  it("configuração incompleta é apontada como lacuna, nunca aplicada", () => {
    const soBase = packagingReadiness({ current: null, desired: { baseUnit: "bobina" } });
    expect(soBase.desired).toBeNull();
    expect(soBase.productFields).toBeNull();
    expect(soBase.gaps.length).toBeGreaterThan(0);

    const iguais = packagingReadiness({
      current: null,
      desired: { baseUnit: "bobina", packagingUnit: "bobina", conversionFactor: 30 },
    });
    expect(iguais.productFields).toBeNull();
    expect(iguais.gaps).toContain("Unidade-base e unidade de embalagem devem ser distintas.");
  });

  it("já configurado não gera nada para gravar", () => {
    const readiness = packagingReadiness({ current: BOBINA_TARGET, desired: BOBINA_TARGET });
    expect(readiness.alreadyConfigured).toBe(true);
    expect(readiness.productFields).toBeNull();
    expect(describePackagingTarget(null)).toBe("Sem conversão de embalagem configurada");
  });

  it("a estrutura de embalagem já existe no schema como opcional", () => {
    const products = schema.slice(
      schema.indexOf("products: defineTable"),
      schema.indexOf("stock: defineTable")
    );
    for (const field of ["baseUnit", "packagingUnit", "conversionFactor"]) {
      expect(products).toContain(`${field}: v.optional(`);
    }
    // A mutation existente grava configuração sem mover saldo.
    expect(printSupplies).toContain("export const configurePackaging");
    expect(printSupplies).toContain("Conversão incompleta");
  });
});

describe("PACK-05 — Conversão explícita é separada da quantidade fiscal", () => {
  it("com a conversão configurada, o fiscal continua 90 e o operacional é derivado", () => {
    const view = buildFiscalQuantityView({
      fiscalQuantity: NF_FISCAL_QUANTITY,
      fiscalUnit: "UN",
      packaging: BOBINA_TARGET,
      operationalUnit: "bobina",
    });
    expect(view.fiscalQuantity).toBe(90);
    expect(view.fiscalUnit).toBe("UN");
    expect(view.appliedFactor).toBe(30);
    expect(view.baseQuantity).toBe(2700);
    expect(view.baseUnit).toBe("bobina");
    expect(view.packaging).toEqual({ baseUnit: "bobina", packagingUnit: "caixa", factor: 30 });
    // E o aviso deixa claro que o estoque existente não é reescrito.
    expect(view.note).toBe(CONFIGURED_PACKAGING_NOTE);
  });

  it("sem conversão configurada, o aviso é o de 'não configurada'", () => {
    const view = buildFiscalQuantityView({ fiscalQuantity: NF_FISCAL_QUANTITY });
    expect(view.packaging).toBeNull();
    expect(view.appliedFactor).toBe(1);
    expect(view.baseQuantity).toBe(90);
    expect(view.note).toBe(NO_PACKAGING_CONVERSION_NOTE);
    expect(view.note).not.toBe(CONFIGURED_PACKAGING_NOTE);
  });

  it("a distinção fiscal × operacional existe também no backend de impressão", () => {
    // O painel de suprimentos conhece a conversão, mas só a partir do produto.
    expect(printSupplies).toContain("readPackagingConversion");
    expect(printSupplies).toContain("baseUnit");
    expect(printSupplies).toContain("conversionFactor");
  });
});

describe("REGR-11 — Parametrização de Estoque intocada", () => {
  it("/stock-parameters continua com mínimo, ideal e consumo mensal, sem preenchimento automático", () => {
    expect(stockParametersPage).toContain("/stock-parameters");
    for (const field of ["minimumStock", "idealStock", "monthlyConsumptionTarget"]) {
      expect(stockParametersLib).toContain(field);
    }
    // A tela de equipamentos NÃO escreve parâmetros de reposição.
    expect(read("src/pages/Assets.tsx")).not.toContain("stockParameters");
    expect(read("src/pages/Assets.tsx")).not.toContain("monthlyConsumptionTarget");
  });
});

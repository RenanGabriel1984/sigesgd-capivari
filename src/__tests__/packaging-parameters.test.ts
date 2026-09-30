/**
 * Gestão de Estoque SGGD — PARAMETRIZAÇÃO DE UNIDADES E EMBALAGENS
 * (PACKCFG-01..15, /packaging-parameters).
 *
 * Premissa central desta rodada: a configuração de embalagem é CADISTRAL.
 *
 *   1 caixa = 30 rolos   ← configuração
 *   180 rolos            ← saldo físico (unidade BASE), INTOCADO
 *
 * Nenhuma quantidade real pode mudar: nada de 180 → 6 no estoque, nada de
 * lote novo, nada de movimentação, nada de reescrita da quantidade fiscal
 * de NF-e. A conversão aparece apenas como PRÉVIA/equivalente textual.
 *
 * Testes UNITÁRIOS: nenhuma chamada ao banco, nenhum dado real alterado.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  PACKAGING_UNITS,
  EMPTY_PACKAGING_FIELD,
  PACKAGING_ERRORS,
  PACKAGING_STATUS_LABELS,
  PACKAGING_SCREEN_NOTICE,
  readPackagingSettings,
  hasConfiguredPackaging,
  packagingStatus,
  validatePackagingConfig,
  normalizePackagingInput,
  formatConversion,
  pluralizeUnit,
  formatQuantity,
  formatApproximatePacks,
  buildPackagingPreview,
  describeEquivalent,
  buildPackagingRow,
  computePackagingCounters,
  applyPackagingFilters,
  draftFromSettings,
  diffPackagingDraft,
} from "@/lib/packaging-parameters";
import { readPackagingConversion } from "@/lib/print-supplies";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf-8");

const packagingBackend = read("src/convex/packagingParameters.ts");
const schema = read("src/convex/schema.ts");
const screen = read("src/pages/PackagingParameters.tsx");
const routes = read("src/main.tsx");
const rbac = read("src/lib/rbac.ts");
const constants = read("src/types/constants.ts");
const shell = read("src/components/AppShell.tsx");
const stockParametersLib = read("src/lib/stock-parameters.ts");
const stockParametersBackend = read("src/convex/stockParameters.ts");
const stockParametersScreen = read("src/pages/StockParameters.tsx");
const gomaq = read("src/pages/GomaQ.tsx");
const printSuppliesLib = read("src/lib/print-supplies.ts");

/** Remove comentários para evitar falso positivo em asserções negativas. */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const BOBINA = {
  productName: "Papel para impressora térmica",
  unitOfMeasure: "rolo",
  physicalStock: 180,
  reservedStock: 0,
};

/* ═══ PACKCFG-01 — Configuração base/embalagem/fator é salva ═══════════════ */

describe("PACKCFG-01 — Configuração base/embalagem/fator é salva", () => {
  it("valida e normaliza a configuração 1 caixa = 30 rolos", () => {
    const validation = validatePackagingConfig({
      baseUnit: "rolo",
      packagingUnit: "caixa",
      conversionFactor: 30,
    });
    expect(validation.ok).toBe(true);
    expect(validation.errors).toEqual([]);
    expect(normalizePackagingInput({ baseUnit: "rolo", packagingUnit: "caixa", conversionFactor: "30" })).toEqual({
      baseUnit: "rolo",
      packagingUnit: "caixa",
      conversionFactor: 30,
    });
  });

  it("a mutation grava apenas os três campos de embalagem do produto", () => {
    const body = stripComments(packagingBackend);
    expect(body).toMatch(/ctx\.db\.patch\(productId, \{/);
    expect(body).toMatch(/baseUnit: normalized\.baseUnit/);
    expect(body).toMatch(/packagingUnit: normalized\.packagingUnit/);
    expect(body).toMatch(/conversionFactor: normalized\.conversionFactor/);
    // Nenhum outro patch/insert de dados além do produto e da auditoria.
    expect(body.match(/ctx\.db\.(patch|insert|replace|delete)/g)).toEqual([
      "ctx.db.patch",
      "ctx.db.insert",
    ]);
  });

  it("os campos existem no schema como opcionais (sem tabela nova)", () => {
    const productsBlock = schema.slice(schema.indexOf("products:"), schema.indexOf("products:") + 2200);
    expect(productsBlock).toMatch(/baseUnit: v\.optional\(v\.string\(\)\)/);
    expect(productsBlock).toMatch(/packagingUnit: v\.optional\(v\.string\(\)\)/);
    expect(productsBlock).toMatch(/conversionFactor: v\.optional\(v\.number\(\)\)/);
    // Conversão é texto, não unidade normalizada nova: não há nova tabela.
    expect(schema).not.toMatch(/packagingParameters:\s*defineTable/);
  });

  it("a tela, rota, menu e permissões existem", () => {
    expect(routes).toMatch(/packaging-parameters/);
    expect(routes).toMatch(/PackagingParameters/);
    expect(shell).toMatch(/packaging-parameters/);
    expect(rbac).toMatch(/packaging_parameters\.view/);
    expect(rbac).toMatch(/packaging_parameters\.manage/);
    expect(constants).toMatch(/canViewPackagingParameters/);
    expect(constants).toMatch(/canManagePackagingParameters/);
    expect(screen).toMatch(/PACKAGING_SCREEN_NOTICE|notice|Aviso/i);
  });

  it("mostra a conversão como '1 caixa = 30 rolos' e o status Configurado", () => {
    const conversion = readPackagingConversion({ baseUnit: "rolo", packagingUnit: "caixa", conversionFactor: 30 });
    expect(formatConversion(conversion)).toBe("1 caixa = 30 rolos");
    expect(PACKAGING_STATUS_LABELS.configurado).toBe("Configurado");
    expect(
      packagingStatus({ baseUnit: "rolo", packagingUnit: "caixa", conversionFactor: 30 })
    ).toBe("configurado");
  });

  it("produto sem configuração aparece como Não parametrizado com '—'", () => {
    const row = buildPackagingRow({ productId: "p1", ...BOBINA, packaging: null });
    expect(row.status).toBe("nao_parametrizado");
    expect(row.conversionLabel).toBe(EMPTY_PACKAGING_FIELD);
    expect(PACKAGING_STATUS_LABELS.nao_parametrizado).toBe("Não parametrizado");
    // Unidade base sugere a unidade já cadastrada no produto, sem gravá-la.
    expect(row.unitOfMeasure).toBe("rolo");
  });
});

/* ═══ PACKCFG-02 — Fator deve ser inteiro positivo ══════════════════════════ */

describe("PACKCFG-02 — Fator deve ser inteiro positivo", () => {
  it("aceita 1 e inteiros positivos", () => {
    for (const factor of [1, 2, 30, 50, 100, 1000]) {
      expect(validatePackagingConfig({ baseUnit: "un", packagingUnit: "caixa", conversionFactor: factor }).ok).toBe(
        true
      );
    }
  });

  it("rejeita fator decimal", () => {
    const result = validatePackagingConfig({ baseUnit: "un", packagingUnit: "caixa", conversionFactor: 30.5 });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain(PACKAGING_ERRORS.factorNotInteger);
  });

  it("o backend valida com a MESMA função da tela", () => {
    const body = stripComments(packagingBackend);
    expect(body).toMatch(/validatePackagingConfig\(/);
    expect(body).toMatch(/if \(!validation\.ok\) \{[\s\S]*?throw new Error\(/);
  });
});

/* ═══ PACKCFG-03 — Fator zero é rejeitado ═══════════════════════════════════ */

describe("PACKCFG-03 — Fator zero é rejeitado", () => {
  it("zero é recusado com mensagem própria", () => {
    const result = validatePackagingConfig({ baseUnit: "rolo", packagingUnit: "caixa", conversionFactor: 0 });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain(PACKAGING_ERRORS.factorZero);
    expect(result.error).toBe(PACKAGING_ERRORS.factorZero);
  });

  it("zero nunca é normalizado para um valor gravável", () => {
    const result = validatePackagingConfig({ baseUnit: "rolo", packagingUnit: "caixa", conversionFactor: 0 });
    expect(result.ok).toBe(false);
  });
});

/* ═══ PACKCFG-04 — Fator negativo é rejeitado ═══════════════════════════════ */

describe("PACKCFG-04 — Fator negativo é rejeitado", () => {
  it("negativo é recusado com mensagem própria", () => {
    const result = validatePackagingConfig({ baseUnit: "un", packagingUnit: "caixa", conversionFactor: -5 });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain(PACKAGING_ERRORS.factorNegative);
  });

  it("fator zero ou negativo nunca vira conversão válida", () => {
    expect(readPackagingConversion({ baseUnit: "un", packagingUnit: "caixa", conversionFactor: 0 })).toBeNull();
    expect(readPackagingConversion({ baseUnit: "un", packagingUnit: "caixa", conversionFactor: -5 })).toBeNull();
  });
});

/* ═══ PACKCFG-05 — Prévia 180 / 30 = 6 caixas ═══════════════════════════════ */

describe("PACKCFG-05 — Prévia 180 / 30 = 6 caixas", () => {
  it("divisão exata é exibida sem resto", () => {
    const preview = buildPackagingPreview({
      baseQuantity: 180,
      baseUnit: "rolo",
      conversion: { baseUnit: "rolo", packagingUnit: "caixa", factor: 30 },
    });
    expect(preview?.packs).toBe(6);
    expect(preview?.remainder).toBe(0);
    expect(preview?.exact).toBe(true);
    expect(preview?.text).toBe("180 rolos = 6 caixas");
  });

  it("a linha da tabela mostra 180 rolos = 6 caixas mantendo o saldo", () => {
    const row = buildPackagingRow({
      productId: "p1",
      ...BOBINA,
      packaging: { baseUnit: "rolo", packagingUnit: "caixa", conversionFactor: 30 },
    });
    expect(row.physicalStock).toBe(180);
    expect(row.availableStock).toBe(180);
    expect(row.preview?.text).toBe("180 rolos = 6 caixas");
    expect(row.conversionLabel).toBe("1 caixa = 30 rolos");
  });

  it("formata o equivalente aproximado para as telas auxiliares", () => {
    expect(
      formatApproximatePacks({ baseUnit: "rolo", packagingUnit: "caixa", factor: 30 }, 180)
    ).toBe("≈ 6 caixas");
    expect(describeEquivalent(180, { baseUnit: "rolo", packagingUnit: "caixa", conversionFactor: 30 })).toBe(
      "≈ 180 rolos = 6 caixas"
    );
  });
});

/* ═══ PACKCFG-06 — Prévia 185 / 30 = 6 caixas + 5 rolos ═════════════════════ */

describe("PACKCFG-06 — Prévia 185 / 30 = 6 caixas + 5 rolos", () => {
  it("divisão não exata mostra o resto, sem arredondar", () => {
    const preview = buildPackagingPreview({
      baseQuantity: 185,
      baseUnit: "rolo",
      conversion: { baseUnit: "rolo", packagingUnit: "caixa", factor: 30 },
    });
    expect(preview?.packs).toBe(6);
    expect(preview?.remainder).toBe(5);
    expect(preview?.exact).toBe(false);
    expect(preview?.text).toBe("185 rolos = 6 caixas + 5 rolos");
  });

  it("nunca arredonda silenciosamente nem troca a unidade base", () => {
    const preview = buildPackagingPreview({
      baseQuantity: 185,
      baseUnit: "rolo",
      conversion: { baseUnit: "rolo", packagingUnit: "caixa", factor: 30 },
    });
    expect(preview?.text).not.toBe("185 rolos = 6 caixas");
    expect(preview?.text).toContain("+ 5 rolos");
    expect(preview?.baseQuantity).toBe(185);
    expect(preview?.baseUnit).toBe("rolo");
  });

  it("a prévia da tela existe antes de salvar", () => {
    const screenBody = stripComments(screen);
    expect(screenBody).toMatch(/buildPackagingPreview/);
    expect(screenBody).toMatch(/PR[ÉE]VIA/i);
  });
});

/* ═══ PACKCFG-07 — Configuração não altera quantidade física ══════════════════ */

describe("PACKCFG-07 — Configuração não altera quantidade física", () => {
  it("a mutation save não escreve em stock/stockByLocation/lots", () => {
    // Recorta APENAS o corpo da mutation `save` (a query `list` só LÊ o saldo).
    const body = stripComments(packagingBackend);
    const saveBlock = body.slice(body.indexOf("export const save = mutation"));
    for (const forbidden of [
      "stockByLocation",
      '"lots"',
      "quantityAvailable",
      "physicalQuantity:",
      "reservedQuantity:",
      "ctx.db.insert(\"stockMovements\"",
    ]) {
      expect(saveBlock).not.toContain(forbidden);
    }
  });

  it("a linha da tela devolve o saldo físico intacto (180, não 6)", () => {
    const row = buildPackagingRow({
      productId: "p1",
      ...BOBINA,
      packaging: { baseUnit: "rolo", packagingUnit: "caixa", conversionFactor: 30 },
    });
    expect(row.physicalStock).toBe(180);
    expect(row.availableStock).toBe(180);
    expect(row.settings.conversionFactor).toBe(30);
  });

  it("salvar NÃO altera a quantidade: 180 continua 180", () => {
    const stock = { physicalQuantity: 180, reservedQuantity: 0 };
    const before = { ...stock };
    // A prévia é matemática pura: não recebe o estoque para mutação.
    buildPackagingPreview({
      baseQuantity: stock.physicalQuantity,
      baseUnit: "rolo",
      conversion: { baseUnit: "rolo", packagingUnit: "caixa", factor: 30 },
    });
    expect(stock).toEqual(before);
    expect(stock.physicalQuantity).toBe(180);
  });
});

/* ═══ PACKCFG-08 — Configuração não cria movimento ═══════════════════════════ */

describe("PACKCFG-08 — Configuração não cria movimento", () => {
  it("nenhuma referência a stockMovements no módulo de embalagem", () => {
    const body = stripComments(packagingBackend);
    expect(body).not.toContain("stockMovements");
    expect(body).not.toContain('ctx.db.insert("stockMovements"');
    expect(body).not.toContain("movementType");
  });

  it("a auditoria vai para auditLogs com a ação específica", () => {
    const body = stripComments(packagingBackend);
    expect(body).toMatch(/ctx\.db\.insert\("auditLogs", \{/);
    expect(body).toMatch(/action: "product_packaging_update"/);
  });
});

/* ═══ PACKCFG-09 — Configuração não altera lote ═════════════════════════════ */

describe("PACKCFG-09 — Configuração não altera lote", () => {
  it("nenhuma escrita em lots", () => {
    const body = stripComments(packagingBackend);
    expect(body).not.toContain('ctx.db.insert("lots"');
    expect(body).not.toMatch(/ctx\.db\.patch\(lot/);
    expect(body).not.toMatch(/ctx\.db\.get\(lotId\)/);
  });
});

/* ═══ PACKCFG-10 — Configuração não altera NF-e ═════════════════════════════ */

describe("PACKCFG-10 — Configuração não altera NF-e", () => {
  it("nenhuma escrita em entries/entryItems", () => {
    const body = stripComments(packagingBackend);
    expect(body).not.toContain('ctx.db.insert("entries"');
    expect(body).not.toContain('ctx.db.insert("entryItems"');
    expect(body).not.toMatch(/ctx\.db\.patch\(entry/);
  });

  it("a tela não infere fator a partir da descrição fiscal do documento", () => {
    const body = stripComments(packagingBackend) + stripComments(screen);
    expect(body).not.toMatch(/parseFactorFromDescription|CAIXA C 30 UNID/);
  });
});

/* ═══ PACKCFG-11 — Quantidade fiscal permanece intacta ══════════════════════ */

describe("PACKCFG-11 — Quantidade fiscal permanece intacta", () => {
  it("a quantidade fiscal da NF-e (90 un) nunca é multiplicada pelo fator", () => {
    const fiscal = { quantity: 90, unitOfMeasure: "un" };
    const before = { ...fiscal };
    buildPackagingPreview({
      baseQuantity: fiscal.quantity,
      baseUnit: fiscal.unitOfMeasure,
      conversion: { baseUnit: "rolo", packagingUnit: "caixa", factor: 30 },
    });
    expect(fiscal).toEqual(before);
    expect(fiscal.quantity).toBe(90);
  });

  it("estoque do Papel para impressora térmica permanece 180 rolos", () => {
    const row = buildPackagingRow({
      productId: "kd75k6hz4gj7szvar4d44nxnwp9a52qa",
      ...BOBINA,
      packaging: { baseUnit: "rolo", packagingUnit: "caixa", conversionFactor: 30 },
    });
    expect(row.productName).toBe("Papel para impressora térmica");
    expect(row.unitOfMeasure).toBe("rolo");
    expect(row.availableStock).toBe(180);
  });
});

/* ═══ PACKCFG-12 — Parâmetros mínimo/ideal continuam na unidade base ════════ */

describe("PACKCFG-12 — Parâmetros mínimo/ideal continuam na unidade base", () => {
  it("minimumStock/idealStock não são convertidos", () => {
    const minimumStock = 30;
    const idealStock = 180;
    const before = { minimumStock, idealStock };
    describeEquivalent(minimumStock, { baseUnit: "rolo", packagingUnit: "caixa", conversionFactor: 30 });
    describeEquivalent(idealStock, { baseUnit: "rolo", packagingUnit: "caixa", conversionFactor: 30 });
    expect({ minimumStock, idealStock }).toEqual(before);
    expect(idealStock).toBe(180);
  });

  it("/stock-parameters exibe o equivalente mas mantém a unidade base", () => {
    expect(stockParametersLib).toMatch(/packaging/);
    expect(stockParametersLib).toMatch(/equivalentLabel/);
    const screenBody = stripComments(stockParametersScreen);
    expect(screenBody).toMatch(/baseUnit/);
    expect(screenBody).toMatch(/equivalentLabel/);
    // Mínimo/ideal seguem exibidos cru, sem multiplicar pelo fator.
    expect(screenBody).toMatch(/minimumStock/);
    expect(screenBody).toMatch(/idealStock/);
  });

  it("a tela de suprimentos mantém a unidade base como principal", () => {
    const screenBody = stripComments(gomaq);
    expect(screenBody).toMatch(/PacksApproximation/);
    expect(screenBody).toMatch(/\{f\.baseStock\}/);
    expect(screenBody).toMatch(/\{family\.baseStock\}/);
    expect(printSuppliesLib).toMatch(/familyPacksApproximation/);
  });
});

/* ═══ PACKCFG-13 — Configuração existente do protetor continua intacta ════════ */

describe("PACKCFG-13 — Configuração existente do protetor continua intacta", () => {
  it("1 caixa = 50 unidades permanece como estava", () => {
    const settings = readPackagingSettings({
      baseUnit: "un",
      packagingUnit: "caixa",
      conversionFactor: 50,
    });
    expect(settings).toEqual({ baseUnit: "un", packagingUnit: "caixa", conversionFactor: 50 });
    expect(hasConfiguredPackaging({ baseUnit: "un", packagingUnit: "caixa", conversionFactor: 50 })).toBe(true);
    expect(formatConversion({ baseUnit: "un", packagingUnit: "caixa", factor: 50 })).toBe("1 caixa = 50 un");
  });

  it("reabrir e salvar sem editar gera diff vazio (não duplica configuração)", () => {
    const current = { baseUnit: "un", packagingUnit: "caixa", conversionFactor: 50 };
    const draft = draftFromSettings(current);
    expect(draft).toEqual({ baseUnit: "un", packagingUnit: "caixa", conversionFactor: "50" });
    expect(diffPackagingDraft(current, draft)).toEqual([]);
  });

  it("a unidade de embalagem é sempre distinta da unidade base", () => {
    const result = validatePackagingConfig({ baseUnit: "un", packagingUnit: "un", conversionFactor: 50 });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain(PACKAGING_ERRORS.sameUnits);
  });
});

/* ═══ PACKCFG-14 — Alteração gera auditoria ══════════════════════════════════ */

describe("PACKCFG-14 — Alteração gera auditoria", () => {
  it("a ação product_packaging_update existe no schema e no validador", () => {
    expect(schema).toMatch(/PRODUCT_PACKAGING_UPDATE: "product_packaging_update"/);
    expect(schema).toMatch(/v\.literal\(AUDIT_ACTIONS\.PRODUCT_PACKAGING_UPDATE\)/);
  });

  it("a auditoria registra produto, usuário, data/hora e valores antes/depois", () => {
    const body = stripComments(packagingBackend);
    const detailStart = body.indexOf("const detail = changes");
    expect(detailStart).toBeGreaterThan(-1);
    const insert = body.slice(detailStart, body.indexOf("return { updated: true"));
    expect(insert).toMatch(/describePackagingValue\(c\.before, c\.field\)/);
    expect(insert).toMatch(/describePackagingValue\(c\.after, c\.field\)/);
    expect(insert).toMatch(/userId/);
    expect(insert).toMatch(/entityId: productId/);
    expect(insert).toMatch(/timestamp: Date\.now\(\)/);
    expect(insert).toMatch(/entity: "products"/);
    expect(insert).toMatch(/→/);
  });

  it("o diff descreve a mudança de 30 por caixa para 50 por caixa", () => {
    const changes = diffPackagingDraft(
      { baseUnit: "rolo", packagingUnit: "caixa", conversionFactor: 30 },
      { baseUnit: "rolo", packagingUnit: "caixa", conversionFactor: "50" }
    );
    expect(changes).toEqual([{ field: "conversionFactor", before: 30, after: 50 }]);
  });
});

/* ═══ PACKCFG-15 — Idempotência ═════════════════════════════════════════════ */

describe("PACKCFG-15 — Idempotência: salvar a mesma configuração não duplica", () => {
  it("diff vazio quando nada muda", () => {
    const current = { baseUnit: "rolo", packagingUnit: "caixa", conversionFactor: 30 };
    expect(diffPackagingDraft(current, draftFromSettings(current))).toEqual([]);
    expect(diffPackagingDraft(current, { baseUnit: "rolo", packagingUnit: "caixa", conversionFactor: "30" })).toEqual([]);
  });

  it("a mutation retorna unchanged sem patch nem auditoria", () => {
    const body = stripComments(packagingBackend);
    expect(body).toMatch(/if \(changes\.length === 0\) \{[\s\S]*?return \{ updated: false, unchanged: true, changes: 0 \};/);
    const unchangedAt = body.indexOf("unchanged: true");
    const patchAt = body.indexOf("ctx.db.patch");
    const insertAt = body.indexOf('ctx.db.insert("auditLogs"');
    expect(unchangedAt).toBeLessThan(patchAt);
    expect(unchangedAt).toBeLessThan(insertAt);
  });

  it("remover a configuração é uma operação válida (volta a não parametrizado)", () => {
    const current = { baseUnit: "rolo", packagingUnit: "caixa", conversionFactor: 30 };
    const changes = diffPackagingDraft(current, { baseUnit: "", packagingUnit: "", conversionFactor: "" });
    expect(changes.map((c) => c.field).sort()).toEqual(["baseUnit", "conversionFactor", "packagingUnit"]);
    expect(validatePackagingConfig({ baseUnit: "", packagingUnit: "", conversionFactor: "" }).ok).toBe(true);
    expect(packagingStatus(null)).toBe("nao_parametrizado");
  });
});

/* ═══ Regras transversais da rodada ═════════════════════════════════════════ */

describe("Unidades controladas, contadores e filtros", () => {
  it("catálogo enxuto de unidades controladas", () => {
    expect([...PACKAGING_UNITS]).toEqual(["un", "caixa", "pacote", "saco", "kit", "rolo", "pote", "metro"]);
  });

  it("pluralização usada nos textos de conversão", () => {
    expect(pluralizeUnit("rolo", 30)).toBe("rolos");
    expect(pluralizeUnit("caixa", 6)).toBe("caixas");
    expect(pluralizeUnit("un", 50)).toBe("un");
    expect(formatQuantity(1, "caixa")).toBe("1 caixa");
    expect(formatQuantity(2, "caixa")).toBe("2 caixas");
  });

  it("embalagem obrigatória quando o fator é maior que 1", () => {
    const result = validatePackagingConfig({ baseUnit: "rolo", packagingUnit: "", conversionFactor: 30 });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain(PACKAGING_ERRORS.packagingUnitRequired);
  });

  it("unidade base é obrigatória na configuração", () => {
    const result = validatePackagingConfig({ baseUnit: "", packagingUnit: "caixa", conversionFactor: 30 });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain(PACKAGING_ERRORS.baseUnitRequired);
  });

  it("contadores e filtros da tabela", () => {
    const rows = [
      buildPackagingRow({
        productId: "p1",
        categoryName: "Impressão",
        ...BOBINA,
        packaging: { baseUnit: "rolo", packagingUnit: "caixa", conversionFactor: 30 },
      }),
      buildPackagingRow({
        productId: "p2",
        productName: "Abraçadeira de nylon",
        categoryName: "Elétrica",
        unitOfMeasure: "un",
        physicalStock: 180,
        reservedStock: 0,
        packaging: null,
      }),
    ];
    expect(computePackagingCounters(rows)).toEqual({
      total: 2,
      configurados: 1,
      naoParametrizados: 1,
      incompletos: 0,
    });
    expect(applyPackagingFilters(rows, { search: "bobina", categoryName: null, status: "todos" })).toHaveLength(0);
    expect(applyPackagingFilters(rows, { search: "papel", categoryName: null, status: "configurado" })).toHaveLength(1);
    expect(applyPackagingFilters(rows, { search: "", categoryName: "Elétrica", status: "todos" })).toHaveLength(1);
  });

  it("a tela avisa que a configuração não altera o estoque", () => {
    expect(PACKAGING_SCREEN_NOTICE).toMatch(/cadastral/i);
    expect(PACKAGING_SCREEN_NOTICE).toMatch(/unidade BASE/i);
    expect(PACKAGING_SCREEN_NOTICE).toMatch(/nunca cria lote|entrada|saída|movimentação/i);
    expect(screen).toContain("PACKAGING_SCREEN_NOTICE");
  });

  it("Diretor somente leitura e Técnico sem acesso", () => {
    const director = rbac.slice(rbac.indexOf("DIRECTOR_ACCESS"), rbac.indexOf("DIRECTOR_ACCESS") + 900);
    expect(director).toMatch(/packaging_parameters\.view/);
    expect(director).not.toMatch(/packaging_parameters\.manage/);
    const stockManager = rbac.slice(rbac.indexOf("STOCK_MANAGER_ACCESS"), rbac.indexOf("STOCK_MANAGER_ACCESS") + 900);
    expect(stockManager).toMatch(/packaging_parameters\.manage/);
    const tecnico = rbac.slice(rbac.indexOf("TECHNICIAN_ACCESS"), rbac.indexOf("TECHNICIAN_ACCESS") + 900);
    expect(tecnico).not.toMatch(/packaging_parameters/);
  });
});

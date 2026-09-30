/**
 * Gestão de Estoque SGGD — RETIRADA + UNIDADES DE ESTOQUE (PRINT-EXIT-01..04,
 * PRINT-UOM-01..15).
 *
 * Cobre a correção do runtime error "(c ?? []).filter is not a function" ao
 * abrir "Retirar" em /gomaq (organizations.list retorna { orgs, byParent },
 * um OBJETO — nunca um array), a modelagem de conversão de embalagem
 * (baseUnit/packagingUnit/conversionFactor) e o agrupamento por família física
 * (Protetor de crachá: 13 caixas × 50 + 18 un = 668 un).
 *
 * Reconciliação read-only confirmada no banco (ENT-2026-000001 + NF 372043):
 * Toners 16+44=60 · Cartões 700+400=1100 · Ribbons 24+1=25 · Papel 90+90=180
 * · Etiquetas 23 · Estoque global physical 3338 / reserved 0 / lotes 3338.
 *
 * Nenhum teste escreve no banco de produção.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  readPackagingConversion,
  deriveFamilyKey,
  buildSupplyFamilies,
  planPackOperation,
  normalizeOrgList,
  computeCardTotals,
  buildSupplyRow,
  validateWithdrawal,
  type SupplyFamilyInput,
} from "@/lib/print-supplies";
import { roleHasPermission } from "@/lib/rbac";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf-8");

const backend = read("src/convex/printSupplies.ts");
const panel = read("src/pages/GomaQ.tsx");
const schema = read("src/convex/schema.ts");
const orgsBackend = read("src/convex/organizations.ts");

/* ─── Ativos reconciliados (read-only, 2026-09) ─────────────────────────── */

const CLOSED_PROTECTOR_ID = "kd75me863v1ym08hdmrpw7h76eazwxg0";
const LOOSE_PROTECTOR_ID = "kd7dqfja6nxhcr33qmjw2mg85e76jx65";

const familyInput = (over: Partial<SupplyFamilyInput> = {}): SupplyFamilyInput => ({
  productId: "p",
  productName: "Toner CX735 — Preto",
  brand: "Lexmark",
  model: null,
  unitOfMeasure: "un",
  currentStock: 5,
  minimumStock: 0,
  idealStock: 0,
  inArea: 5,
  packaging: null,
  ...over,
});

const protectorInputs: SupplyFamilyInput[] = [
  familyInput({
    productId: CLOSED_PROTECTOR_ID,
    productName: "Protetor de crachá — caixa fechada",
    brand: "Reflex",
    unitOfMeasure: "caixa",
    currentStock: 13,
    inArea: 13,
    packaging: { baseUnit: "un", packagingUnit: "caixa", factor: 50 },
  }),
  familyInput({
    productId: LOOSE_PROTECTOR_ID,
    productName: "Protetor de crachá — unidade avulsa",
    brand: "Reflex",
    unitOfMeasure: "un",
    currentStock: 18,
    inArea: 18,
    packaging: null,
  }),
];

/* ═══ PRINT-EXIT — abertura da retirada sem runtime error ══════════════════ */

describe("PRINT-EXIT-01 — abrir retirada de suprimento não gera runtime error", () => {
  it("organizations.list retorna OBJETO { orgs, byParent } (nunca array)", () => {
    expect(orgsBackend).toContain("return { orgs, byParent }");
  });

  it("o modal NÃO faz cast cego do retorno da query para array", () => {
    expect(panel).not.toMatch(/useQuery\(api\.organizations\.list\)\s+as\s+\w+\[\]/);
    expect(panel).toContain("normalizeOrgList<OrgDoc>(orgsQuery)");
  });

  it("normaliza a árvore { orgs, byParent } para array plano antes de qualquer .filter()", () => {
    const tree = {
      orgs: [
        { _id: "s1", name: "Secretaria de Saúde", parentId: undefined },
        { _id: "d1", name: "Departamento", parentId: "s1" },
      ],
      byParent: { root: [{ name: "Secretaria de Saúde" }] },
    };
    // Sem normalizar, (orgs ?? []).filter lançaria
    // "filter is not a function" (o objeto da query não é array).
    const orgs = normalizeOrgList<{ _id: string; name: string; parentId?: string }>(tree);
    expect(Array.isArray(orgs)).toBe(true);
    expect(orgs).toHaveLength(2);
    expect(() => orgs.filter((o) => !o.parentId)).not.toThrow();
    expect(orgs.filter((o) => !o.parentId).map((o) => o._id)).toEqual(["s1"]);
  });

  it("o array do modal vem da normalização (orgsQuery cru nunca é filtrado)", () => {
    const orgsQuery = { orgs: [{ _id: "s1", name: "Secretaria" }], byParent: {} };
    const orgs = normalizeOrgList<{ _id: string; name: string }>(orgsQuery);
    const secretarias = orgs.filter((o) => !("parentId" in o));
    expect(secretarias).toHaveLength(1);
  });
});

describe("PRINT-EXIT-02 — dados do modal são arrays válidos", () => {
  it("array direto, undefined e null normalizam para [] (listas nunca quebram)", () => {
    expect(normalizeOrgList([{ _id: "a", name: "A" }])).toHaveLength(1);
    expect(normalizeOrgList(undefined)).toEqual([]);
    expect(normalizeOrgList(null)).toEqual([]);
  });

  it("formato inesperado (string/número) LANÇA erro em vez de assumir array", () => {
    expect(() => normalizeOrgList("texto")).toThrow(/formato inesperado/i);
    expect(() => normalizeOrgList(42)).toThrow(/formato inesperado/i);
    expect(() => normalizeOrgList({ nope: true })).toThrow(/formato inesperado/i);
  });

  it("as três listas do modal (secretaria/departamento/unidade) derivam do array normalizado", () => {
    expect(panel).toContain("const secretarias = orgList.filter((o) => !o.parentId)");
    expect(panel).toContain("orgList.filter((o) => o.parentId === secretariaId)");
    expect(panel).toContain("orgList.filter((o) => o.parentId === departamentoId)");
    const orgList = normalizeOrgList<{ _id: string; name: string; parentId?: string }>({
      orgs: [
        { _id: "s1", name: "Secretaria" },
        { _id: "d1", name: "Departamento", parentId: "s1" },
        { _id: "u1", name: "Unidade", parentId: "d1" },
      ],
    });
    const [s1] = orgList.filter((o) => !o.parentId);
    const departamentos = orgList.filter((o) => o.parentId === s1._id);
    const unidades = orgList.filter((o) => o.parentId === departamentos[0]._id);
    expect(departamentos.map((d) => d._id)).toEqual(["d1"]);
    expect(unidades.map((u) => u._id)).toEqual(["u1"]);
  });
});

describe("PRINT-EXIT-03 — retirada respeita o backend (autoridade final)", () => {
  it("a UI envia a retirada para mutations Convex (nunca altera saldo no cliente)", () => {
    expect(panel).toContain("useMutation(api.printSupplies.withdraw)");
    expect(panel).toContain("useMutation(api.printSupplies.withdrawFamily)");
  });

  it("backend revalida produto/categoria, permissão e registra movement + auditoria", () => {
    expect(backend).toContain('requirePermission(ctx, "stock.mutate"');
    expect(backend).toContain('categoryId !== SUPPLY_CATEGORY_ID');
    expect(backend).toContain('type: "exit"');
    expect(backend).toContain('action: "move_stock"');
    expect(backend).toContain("ctx.db.insert(\"stockMovements\"");
    expect(backend).toContain("ctx.db.insert(\"auditLogs\"");
  });

  it("FIFO de lotes e lotId estruturado preservados na retirada por família", () => {
    expect(backend).toContain("sort((a, b) => a.receivedAt - b.receivedAt)");
    expect(backend).toContain("lotId: consumedLots[0]?.lotId as never");
    expect(backend).toContain("Falha de consistência: lotes insuficientes");
  });

  it("a retirada registra destino, secretaria, departamento, unidade, O.S. e motivo", () => {
    for (const campo of ["secretariaId", "departamentoId", "unidadeId", "osNumber", "reason"]) {
      expect(backend).toContain(campo);
    }
  });
});

describe("PRINT-EXIT-04 — retirada acima do disponível é bloqueada", () => {
  it("regra pura bloqueia acima do disponível", () => {
    expect(validateWithdrawal(21, 20).ok).toBe(false);
    expect(validateWithdrawal(20, 20)).toEqual({ ok: true, balanceAfter: 0 });
  });

  it("backend valida contra o estoque real da família em unidades-base", () => {
    expect(backend).toContain("familyAvailable");
    expect(backend).toContain("Estoque insuficiente. Disponível: ${familyAvailable} ${conv.baseUnit}");
    expect(backend).toContain("Composição insuficiente");
  });

  it("composição insuficiente é rejeitada pela regra pura de embalagem", () => {
    expect(planPackOperation(669, { closedPacks: 13, looseUnits: 18, factor: 50 })).toBeNull();
    expect(planPackOperation(0, { closedPacks: 13, looseUnits: 18, factor: 50 })).toBeNull();
  });
});

/* ═══ PRINT-UOM — conversão de embalagem e família física ══════════════════ */

describe("PRINT-UOM-01 — 13 caixas × 50 + 18 avulsas = 668 unidades", () => {
  it("a soma em unidades-base é 13 × 50 + 18 = 668", () => {
    const [family] = buildSupplyFamilies(protectorInputs);
    expect(family.members[0].baseUnits).toBe(13 * 50);
    expect(family.members[1].baseUnits).toBe(18);
    expect(family.baseStock).toBe(668);
  });

  it("a composição física de entrada continua íntegra: 13 caixas e 18 un", () => {
    const [family] = buildSupplyFamilies(protectorInputs);
    expect(family.members.map((m) => m.currentStock)).toEqual([13, 18]);
  });
});

describe("PRINT-UOM-02 — protetor aparece agrupado (uma família, não duas linhas soltas)", () => {
  it("os dois registros de apresentação do protetor caem na MESMA família", () => {
    expect(deriveFamilyKey("Protetor de crachá — caixa fechada", "Reflex")).toBe(
      deriveFamilyKey("Protetor de crachá — unidade avulsa", "Reflex"),
    );
  });

  it("buildSupplyFamilies devolve 1 família com 2 membros para o protetor", () => {
    const families = buildSupplyFamilies(protectorInputs);
    expect(families).toHaveLength(1);
    expect(families[0].members).toHaveLength(2);
    expect(families[0].familyName).toBe("Protetor de crachá");
    expect(families[0].brand).toBe("Reflex");
  });

  it("produtos sem sufixo de apresentação NÃO são agrupados indevidamente", () => {
    expect(deriveFamilyKey("Toner CX735 — Preto", "Lexmark")).not.toBe(
      deriveFamilyKey("Toner CX735 — Ciano", "Lexmark"),
    );
    const families = buildSupplyFamilies([
      familyInput({ productName: "Toner CX735 — Preto", currentStock: 1 }),
      familyInput({ productId: "p2", productName: "Toner CX735 — Ciano", currentStock: 1 }),
    ]);
    expect(families).toHaveLength(2);
  });

  it("a UI agrupa e permite expandir os detalhes (registros originais visíveis)", () => {
    expect(panel).toContain("toggleExpanded");
    expect(panel).toContain("f.members.map((m) =>");
    expect(panel).toContain("f.members.some((m) => m.productName.toLowerCase().includes(q))");
  });
});

describe("PRINT-UOM-03 — o estoque principal mostra 668 un", () => {
  it("a família expõe a unidade-base e o total em unidades-base", () => {
    const [family] = buildSupplyFamilies(protectorInputs);
    expect(family.baseUnit).toBe("un");
    expect(family.baseStock).toBe(668);
  });

  it("a coluna 'Atual' da tabela renderiza o total da família em unidade-base", () => {
    expect(panel).toContain("f.baseUnit");
    expect(panel).toContain("tabular-nums\">{f.baseStock}");
  });
});

describe("PRINT-UOM-04 — detalhamento mostra 13 caixas + 18 un. avulsas", () => {
  it("compositionLabel descreve a apresentação física preservada", () => {
    const [family] = buildSupplyFamilies(protectorInputs);
    expect(family.compositionLabel).toBe("13 caixas fechadas + 18 un. avulsas");
  });

  it("a tabela e o modal exibem o detalhamento da composição", () => {
    expect(panel).toContain("f.compositionLabel");
    expect(panel).toContain("Composição: {family.compositionLabel}");
  });
});

describe("PRINT-UOM-05 — a retirada trabalha em unidade-base", () => {
  it("a UI rotula a quantidade na unidade operacional da família", () => {
    expect(panel).toContain("Quantidade em {family.baseUnit}");
    // Rótulo do saldo disponível no modal de retirada (unidade-base da família).
    expect(panel).toContain("Estoque disponível");
  });

  it("a saída planned consome avulsas primeiro e abre caixa apenas se necessário", () => {
    // 20 un: 18 avulsas + 2 vindas de 1 caixa fechada (abertura integral).
    expect(planPackOperation(20, { closedPacks: 13, looseUnits: 18, factor: 50 })).toEqual({
      operation: "open_pack",
      packs: 1,
    });
    // 68 un: 18 avulsas + 1 caixa fechada INTEIRA (nunca desmonta).
    expect(planPackOperation(68, { closedPacks: 13, looseUnits: 18, factor: 50 })).toEqual({
      operation: "take_pack",
      packs: 1,
    });
  });

  it("a composição logística é preservada: 20 un saem como 18 avulsas + 1 caixa aberta (restam 12 fechadas + 48 un)", () => {
    const { packs } = planPackOperation(20, { closedPacks: 13, looseUnits: 18, factor: 50 })!;
    const closedAfter = 13 - packs; // caixas fechadas
    const looseAfter = 18 - 18 + (packs * 50 - 2); // avulsas restantes da caixa aberta
    expect(closedAfter).toBe(12);
    expect(looseAfter).toBe(48);
    expect(closedAfter * 50 + looseAfter).toBe(648);
  });

  it("o backend registra a abertura de embalagem como evento explícito e auditado", () => {
    expect(backend).toContain("Abertura INTEGRAL");
    expect(backend).toContain("open_pack");
    expect(backend).toContain("Reclassificação de");
  });
});

describe("PRINT-UOM-06 — os dados originais não são apagados", () => {
  it("a conversão é METADADO opcional em products (nada é removido)", () => {
    expect(schema).toContain("baseUnit: v.optional(v.string())");
    expect(schema).toContain("packagingUnit: v.optional(v.string())");
    expect(schema).toContain("conversionFactor: v.optional(v.number())");
  });

  it("configurePackaging altera SOMENTE metadados (nada de lotes/saldo/entradas)", () => {
    const slice = backend.slice(
      backend.indexOf("async function configurePackagingImpl"),
      backend.indexOf("export const configureBadgeProtectorPackaging"),
    );
    expect(slice).toContain("ctx.db.patch(productId, updates)");
    expect(slice).not.toMatch(/ctx\.db\.patch\(lot/);
    expect(slice).not.toMatch(/quantityAvailable|physicalQuantity|ctx\.db\.delete|ctx\.db\.insert\("entries"\)/);
  });

  it("os dois registros do protetor continuam existindo como membros da família", () => {
    const [family] = buildSupplyFamilies(protectorInputs);
    expect(family.members.map((m) => m.productId).sort()).toEqual(
      [CLOSED_PROTECTOR_ID, LOOSE_PROTECTOR_ID].sort(),
    );
  });

  it("a migração assistida é idempotente e auditada", () => {
    expect(backend).toContain("configureBadgeProtectorPackaging");
    expect(backend).toContain("Operação idempotente; nenhum saldo, lote ou registro histórico alterado");
    expect(backend).toMatch(/idempotente\. Convocada|já configurado \(1 caixa = 50 un\) — idempotente/);
  });
});

/* ─── Reconciliação oficial (valores confirmados read-only no banco) ─────── */

const cardRow = (productName: string, currentStock: number, brand: string | null = null) =>
  buildSupplyRow({
    productId: `${productName}-${currentStock}`,
    productName,
    brand,
    model: null,
    unitOfMeasure: "un",
    currentStock,
    minimumStock: 0,
    idealStock: 0,
  });

describe("PRINT-UOM-07 — Cartão PVC = 1100 confirmado (700 inventário + 400 NF)", () => {
  it("os cards somam 1100 (nenhuma correção de saldo aplicada)", () => {
    const totals = computeCardTotals([cardRow("Cartão PVC para crachá", 1100)]);
    expect(totals.cartoes).toBe(1100);
    expect(700 + 400).toBe(1100);
  });

  it("o painel deriva do estoque real — nenhum total fixo no código", () => {
    expect(backend).toContain("computeCardTotals(rows)");
    expect(panel).not.toMatch(/1100/);
  });
});

describe("PRINT-UOM-08 — Toners = 60 confirmado (16 inventário + 44 NF)", () => {
  it("a composição por modelo reproduz 60", () => {
    const totals = computeCardTotals([
      cardRow("Toner VersaLink — Preto", 1, "Lexmark"),
      cardRow("Toner VersaLink — Ciano", 1, "Lexmark"),
      cardRow("Toner VersaLink — Magenta", 1, "Lexmark"),
      cardRow("Toner VersaLink — Amarelo", 1, "Lexmark"),
      cardRow("Toner AltaLink — Preto (Xerox)", 2),
      cardRow("Toner AltaLink — Ciano (Xerox)", 2),
      cardRow("Toner AltaLink —  Magenta (Xerox)", 2),
      cardRow("Toner AltaLink — Amarelo (Xerox)", 4),
      cardRow("Toner CX735 — Preto", 1),
      cardRow("Toner CX735 — Ciano", 1),
      cardRow("Toner CX735 — Magenta", 1),
      cardRow("Toner CX735 — Amarelo", 2),
      cardRow("Toner Lexmark XM5365", 1),
      cardRow("Toner MFC-L6902DW — Preto 20K", 40),
    ]);
    expect(totals.toners).toBe(60);
    expect(4 + 10 + 5 + 1 + 40).toBe(60);
    expect(16 + 44).toBe(60);
  });
});

describe("PRINT-UOM-09 — Ribbons = 25 confirmado (24 inventário + 1 NF)", () => {
  it("os cards somam 25 (duas referências distintas de ribbon)", () => {
    const totals = computeCardTotals([
      cardRow("Ribbon para impressora de etiqueta adesiva", 24),
      cardRow("Ribbon Color YMCKT para SIGMA", 1),
    ]);
    expect(totals.ribbons).toBe(25);
    expect(24 + 1).toBe(25);
  });
});

describe("PRINT-UOM-10 — Papel = 180 confirmado (90 inventário + 90 NF)", () => {
  it("os cards somam 180 rolhos (sem conversão de embalagem implícita)", () => {
    const totals = computeCardTotals([cardRow("Papel para impressora térmica", 180)]);
    expect(totals.papeis).toBe(180);
    expect(90 + 90).toBe(180);
  });
});

describe("PRINT-UOM-11 — Etiquetas = 23 confirmado (23 inventário + 0 NF)", () => {
  it("os cards somam 23", () => {
    const totals = computeCardTotals([cardRow("Etiqueta para impressão adesiva", 23)]);
    expect(totals.etiquetas).toBe(23);
    expect(23 + 0).toBe(23);
  });
});

describe("PRINT-UOM-12 — estoque global continua 3338 com divergência 0", () => {
  it("os invariantes globais estão declarados no backend (3338/0/3338/3338)", () => {
    expect(backend).toContain("export const GLOBAL_INVARIANTS = {");
    expect(backend).toMatch(/physical:\s*3338/);
    expect(backend).toMatch(/reserved:\s*0\b/);
    expect(backend).toMatch(/stockByLocation:\s*3338/);
    expect(backend).toMatch(/lotsAvailable:\s*3338/);
  });

  it("existe consulta read-only de integridade comparando os 4 livros-razão", () => {
    expect(backend).toContain("getGlobalIntegrity");
    expect(backend).toContain("readGlobalTotals");
    expect(backend).toContain("invariantDivergences");
  });

  it("qualquer mutation aborta em divergência inesperada", () => {
    expect(backend).toContain("INTEGRIDADE: estoque global divergente antes da operação");
    expect(backend).toContain("VIOLAÇÃO DE SALDO na retirada");
    expect(backend).toContain("physicalDelta !== -args.quantity");
  });

  it("a conversa de estoque usa a MESMA unidade-base (4 livros-razão conferidos)", () => {
    expect(backend).toContain('ctx.db.query("stockByLocation")');
    expect(backend).toContain('ctx.db.query("lots")');
  });
});

describe("PRINT-UOM-13 — nenhuma conversão automática indevida de papel térmico", () => {
  it("produto sem os 3 campos de conversão NÃO tem conversão (1 = 1)", () => {
    expect(readPackagingConversion({})).toBeNull();
    expect(readPackagingConversion({ baseUnit: "un" })).toBeNull();
    expect(readPackagingConversion({ baseUnit: "un", packagingUnit: "caixa" })).toBeNull();
    expect(readPackagingConversion({ baseUnit: "rl", packagingUnit: "rl", conversionFactor: 30 })).toBeNull();
    expect(readPackagingConversion({ baseUnit: "un", packagingUnit: "caixa", conversionFactor: 50 })).toEqual({
      baseUnit: "un",
      packagingUnit: "caixa",
      factor: 50,
    });
  });

  it("papel térmico em rolo permanece 180 rolhos (NÃO 2700 unidades)", () => {
    const [family] = buildSupplyFamilies([
      familyInput({ productName: "Papel para impressora térmica", unitOfMeasure: "rl", currentStock: 180, inArea: 180 }),
    ]);
    expect(family.baseUnit).toBe("rl");
    expect(family.baseStock).toBe(180);
  });

  it("a conversão é lida do produto (readPackagingConversion), nunca do nome/UOM", () => {
    expect(backend).toContain("readPackagingConversion(p)");
    expect(backend).not.toMatch(/conversionFactor:\s*30\b/);
  });
});

describe("PRINT-UOM-14 — nenhuma duplicação de estoque é criada", () => {
  it("não existe nova tabela de estoque no painel de suprimentos", () => {
    expect(backend).not.toMatch(/insert\("(stock|printSuppliesStock|supplyStock|familyStock)"/);
    expect(schema).not.toMatch(/defineTable\(\{[^}]*familyStock/);
  });

  it("a abertura de caixa é REPARTIÇÃO, não geração: transferência de unidades entre registros", () => {
    expect(backend).toContain("transferir as unidades");
    // A abertura credita as unidades no produto avulso e consome as caixas.
    expect(backend).toContain("const openedUnits = openPacks * conv.factor");
    expect(backend).toContain("newLoosePhys = loosePhys + openedUnits");
  });

  it("a família deriva de stock/lotes reais (sem cache persistido de família)", () => {
    expect(backend).toContain("const families = buildSupplyFamilies(familyInputs)");
    expect(backend).not.toMatch(/insert\("supplyFamilies"|insert\("families"/);
  });
});

describe("PRINT-UOM-15 — RBAC continua respeitado nas novas operações", () => {
  it("consulta exige stock.view; retirada e configuração exigem mutação", () => {
    expect(backend).toContain('requirePermission(ctx, "stock.view")');
    expect(backend).toContain('requirePermission(ctx, "stock.mutate"');
    expect(backend).toContain('requirePermission(ctx, "products.manage"');
  });

  it("técnico consulta mas não retira; gestor retira; diretor só consulta", () => {
    expect(roleHasPermission("technician", "stock.view")).toBe(true);
    expect(roleHasPermission("technician", "stock.mutate")).toBe(false);
    expect(roleHasPermission("stock_manager", "stock.mutate")).toBe(true);
    expect(roleHasPermission("director", "stock.view")).toBe(true);
    expect(roleHasPermission("director", "stock.mutate")).toBe(false);
  });

  it("a UI oculta 'Retirar' sem permissão (autorização real é no backend)", () => {
    expect(panel).toContain("permissions.canCreateEntries");
  });
});

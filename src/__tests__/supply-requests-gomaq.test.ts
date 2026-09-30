/**
 * Gestão de Estoque SGGD — SOLICITAÇÃO MENSAL DE SUPRIMENTOS (GOMAQ-01..06).
 *
 * O documento é PAPEL, não estoque. Estes testes travam as proibições:
 *  - nenhuma solicitação cria movimentação;
 *  - nenhuma solicitação altera estoque, lote ou reserva;
 *  - a quantidade solicitada NUNCA é imposta pela sugestão;
 *  - a camada de exportação Gomaq é separada da estrutura interna.
 *
 * Testes UNITÁRIOS: nenhuma chamada ao banco, nenhuma movimentação fictícia.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  SUPPLY_REQUEST_STATUS_LABELS,
  SUPPLY_REQUEST_STATUS_ORDER,
  nextSupplyRequestStatus,
  canGenerateSupplyRequest,
  buildSuggestedQuantity,
  normalizeSupplyRequestItem,
  isValidSupplyRequestItem,
  groupItemsByEquipmentModel,
  computeSupplyRequestTotals,
  buildEstimatedNeedRow,
  NEED_SOURCE_LABELS,
} from "@/lib/supply-requests";
import {
  buildGomaqExportDocument,
  gomaqDocumentToMatrix,
  formatCityUf,
  GOMAQ_TABLE_HEADERS,
  GOMAQ_DELIVERY_LABELS,
  type InternalSupplyItem,
} from "@/lib/gomaq-export";
import { roleHasPermission, type AppRole } from "@/lib/rbac";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf-8");

const backend = read("src/convex/supplyRequests.ts");
const schema = read("src/convex/schema.ts");
const exportLayer = read("src/lib/gomaq-export.ts");

/** Bloco de uma função do módulo, sem comentários. */
function code(name: string): string {
  const start = backend.indexOf(`export const ${name} =`);
  expect(start, `${name} não encontrada`).toBeGreaterThan(-1);
  const rest = backend.slice(start);
  const next = rest.slice(1).search(/\nexport const /);
  const raw = next === -1 ? rest : rest.slice(0, next + 1);
  return raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const MUTATIONS = ["create", "addItem", "setItemQuantity", "setStatus", "generate"];

// ─────────────────────────────────────────────────────────────────────────────

describe("GOMAQ — Documento de solicitação mensal", () => {
  it("GOMAQ-01: solicitação mensal possui período", () => {
    expect(schema).toContain("supplyRequests: defineTable({");
    expect(schema).toContain("periodMonth: v.number()");
    expect(schema).toContain("periodYear: v.number()");
    // Demais campos do documento.
    expect(schema).toContain("requesterUserId: v.optional(v.id(\"users\"))");
    expect(schema).toContain("supplierId: v.optional(v.id(\"suppliers\"))");
    expect(schema).toContain("generatedAt: v.optional(v.number())");
    expect(schema).toContain("observation: v.optional(v.string())");

    // Status iniciais: Rascunho · Pronta para conferência · Gerada.
    expect(SUPPLY_REQUEST_STATUS_LABELS).toEqual({
      draft: "Rascunho",
      ready_for_review: "Pronta para conferência",
      generated: "Gerada",
    });
    expect(SUPPLY_REQUEST_STATUS_ORDER).toEqual(["draft", "ready_for_review", "generated"]);
    expect(nextSupplyRequestStatus("draft")).toBe("ready_for_review");
    expect(nextSupplyRequestStatus("ready_for_review")).toBe("generated");
    expect(nextSupplyRequestStatus("generated")).toBeNull();

    // Criar valida o mês do período.
    expect(code("create")).toContain("isValidPeriodMonth(args.periodMonth)");
    expect(code("create")).toContain("status: \"draft\"");
  });

  it("GOMAQ-01b: só é possível gerar com itens e período válido", () => {
    const base = {
      status: "ready_for_review" as const,
      itemCount: 3,
      periodMonth: 3,
      periodYear: 2026,
      validMonth: true,
    };
    expect(canGenerateSupplyRequest(base)).toBe(true);
    // Sem itens → não gera.
    expect(canGenerateSupplyRequest({ ...base, itemCount: 0 })).toBe(false);
    // Já gerada → não gera de novo.
    expect(canGenerateSupplyRequest({ ...base, status: "generated" })).toBe(false);
    // Mês inválido → não gera.
    expect(canGenerateSupplyRequest({ ...base, validMonth: false })).toBe(false);
    expect(code("generate")).toContain("canGenerateSupplyRequest");
  });

  it("GOMAQ-02: itens possuem produto/equipamento/quantidade", () => {
    expect(schema).toContain("supplyRequestItems: defineTable({");
    expect(schema).toContain("productId: v.optional(v.id(\"products\"))");
    expect(schema).toContain("equipmentAssetId: v.optional(v.id(\"assets\"))");
    expect(schema).toContain("equipmentModel: v.optional(v.string())");
    expect(schema).toContain("currentStock: v.number()");
    expect(schema).toContain("emptyStock: v.number()");
    expect(schema).toContain("requestedQuantity: v.number()");
    expect(schema).toContain("suggestedQuantity: v.number()");

    // Agrupamento por modelo de equipamento (parque de impressoras).
    const grouped = groupItemsByEquipmentModel([
      { equipmentModel: "VersaLink B405", requestedQuantity: 2 },
      { equipmentModel: "MFC-L6902DW", requestedQuantity: 1 },
      { equipmentModel: "VersaLink B405", requestedQuantity: 3 },
      { equipmentModel: null, requestedQuantity: 1 },
    ]);
    expect(grouped.map((g) => g.model)).toEqual([
      "MFC-L6902DW",
      "Sem equipamento vinculado",
      "VersaLink B405",
    ]);
    expect(grouped.find((g) => g.model === "VersaLink B405")?.items).toHaveLength(2);

    // Totais do documento (informativos).
    expect(
      computeSupplyRequestTotals([
        { productId: "p1", requestedQuantity: 3 },
        { productId: "p1", requestedQuantity: 2 },
        { productId: "p2", requestedQuantity: 4 },
      ])
    ).toEqual({ itemCount: 3, requestedUnits: 9, distinctProducts: 2 });
  });

  it("GOMAQ-03: quantidade sugerida NÃO obriga a quantidade solicitada", () => {
    // Sugestão = max(ideal − estoque atual, 0).
    expect(buildSuggestedQuantity(3, 6)).toBe(3);
    expect(buildSuggestedQuantity(10, 6)).toBe(0);
    expect(buildSuggestedQuantity(3, null)).toBe(0);

    // O operador pode digitar QUALQUER valor não negativo.
    // Exemplo do requisito: estoque 3, ideal 6, sugestão 3, mas pede 2/4/6.
    for (const requested of [2, 4, 6, 0, 99]) {
      const item = normalizeSupplyRequestItem({
        currentStock: 3,
        emptyStock: 0,
        suggestedQuantity: buildSuggestedQuantity(3, 6),
        requestedQuantity: requested,
      });
      expect(item.suggestedQuantity).toBe(3);
      expect(item.requestedQuantity).toBe(requested);
    }

    // O backend guarda os DOIS números separadamente.
    expect(code("addItem")).toContain("suggestedQuantity: normalized.suggestedQuantity");
    expect(code("addItem")).toContain("requestedQuantity: normalized.requestedQuantity");
    // E a alteração manual existe como operação própria.
    expect(code("setItemQuantity")).toContain("requestedQuantity: next.requestedQuantity");

    // Valor inválido (negativo) é normalizado, mas nunca vira sugestão.
    expect(
      normalizeSupplyRequestItem({
        currentStock: 3, emptyStock: 0, suggestedQuantity: 3, requestedQuantity: -4,
      }).requestedQuantity
    ).toBe(0);
    expect(isValidSupplyRequestItem({ productId: "p1", requestedQuantity: 0 })).toBe(true);
    expect(isValidSupplyRequestItem({ productId: null, requestedQuantity: 1 })).toBe(false);
  });
});

describe("GOMAQ — Nenhuma movimentação de estoque", () => {
  it("GOMAQ-04: nenhuma solicitação cria movimentação", () => {
    for (const name of MUTATIONS) {
      const body = code(name);
      for (const forbidden of [
        'db.insert("stockMovements"',
        'db.patch("stockMovements"',
        'db.insert("lots"',
        'db.patch("lots"',
        'db.insert("entries"',
        'db.insert("entryItems"',
        'db.insert("stock"',
        'db.patch("stock"',
        'db.patch("stockByLocation"',
        'db.insert("stockByLocation"',
      ]) {
        expect(body, `${name} não pode conter ${forbidden}`).not.toContain(forbidden);
      }
    }
    // A única tabela de estoque lida é `stock` (para a sugestão), nunca escrita.
    expect(code("suggestions")).toContain('ctx.db.query("stock").collect()');
  });

  it("GOMAQ-05: nenhuma solicitação altera estoque", () => {
    for (const name of MUTATIONS) {
      const body = code(name);
      expect(body).not.toContain("physicalQuantity");
      expect(body).not.toContain("reservedQuantity");
      expect(body).not.toContain("quantityAvailable");
      // Nada de reserva: o documento não promete estoque ao fornecedor.
      expect(body).not.toContain("reserve");
    }
    // As únicas escritas possíveis são nas tabelas do próprio documento.
    const writes = new Set<string>();
    for (const name of MUTATIONS) {
      for (const m of code(name).matchAll(/db\.(insert|patch)\("([A-Za-z]+)"/g)) {
        writes.add(m[2]);
      }
    }
    expect([...writes].sort()).toEqual(
      expect.arrayContaining(["supplyRequests", "supplyRequestItems"])
    );
    for (const table of writes) {
      expect(["supplyRequests", "supplyRequestItems", "auditLogs"]).toContain(table);
    }
  });

  it("GOMAQ-04b: não envia e-mail nem cria pedido real", () => {
    for (const name of MUTATIONS) {
      const body = code(name);
      expect(body).not.toContain("fetch(");
      expect(body).not.toContain("axios");
      expect(body).not.toContain("sendEmail");
      expect(body).not.toContain("resend");
    }
    // "Gerada" carimba a data e fecha o documento — nada além disso.
    expect(code("generate")).toContain("generatedAt: now");
  });
});

describe("GOMAQ — Modelo de exportação Gomaq", () => {
  const items: InternalSupplyItem[] = [
    {
      productName: "Toner VersaLink — Preto",
      availableQuantity: 2,
      emptyQuantity: 1,
      equipmentModel: "VersaLink B405",
      equipmentSerials: ["SN001", "SN002"],
      requestedQuantity: 4,
    },
    {
      productName: "Ribbon Color",
      availableQuantity: 5,
      emptyQuantity: 0,
      equipmentModel: null,
      equipmentSerials: [],
      requestedQuantity: 1,
    },
  ];

  it("GOMAQ-06: estrutura permite exportação no formato Gomaq", () => {
    const doc = buildGomaqExportDocument({
      header: { requesterName: "Maria Souza", requesterPhone: "(11) 90000-0000", date: "2026-03-10" },
      delivery: {
        legalName: "Gomaq Suprimentos LTDA",
        cnpj: "12.345.678/0001-90",
        address: "Rua das Impressoras",
        addressComplement: "Sala 3",
        district: "Centro",
        cityUf: "Campinas/SP",
        cep: "13010-000",
        contact: "Comercial",
      },
      items,
      period: "03/2026",
    });

    // Cabeçalho do formulário.
    expect(doc.header.requesterName).toBe("Maria Souza");
    expect(doc.header.date).toBe("2026-03-10");
    // Bloco de entrega completo.
    for (const key of GOMAQ_DELIVERY_LABELS) {
      expect(doc.delivery[key], `campo de entrega ${key} ausente`).toBeTruthy();
    }
    // Tabela: modelo, estoques e quantidade solicitada.
    expect(doc.rows).toHaveLength(2);
    expect(doc.rows[0]).toMatchObject({
      equipmentModel: "VersaLink B405",
      fullStock: 2,
      emptyStock: 1,
      machineSerials: ["SN001", "SN002"],
      requestedQuantity: 4,
    });

    // Colunas na ordem do modelo original.
    expect(GOMAQ_TABLE_HEADERS).toEqual([
      "Modelo do equipamento",
      "Estoque dos suprimentos cheios",
      "Estoque dos suprimentos vazios",
      "Número de série das máquinas",
      "Quantidade solicitada",
    ]);

    // A matriz reproduz cabeçalho → entrega → tabela + a nota de rodapé.
    const matrix = gomaqDocumentToMatrix(doc);
    const flat = matrix.map((r) => r.join(" | "));
    expect(flat.some((r) => r.includes("Nome do solicitante") && r.includes("Maria Souza"))).toBe(true);
    expect(flat.some((r) => r.includes("Razão social"))).toBe(true);
    expect(flat.some((r) => r.startsWith("Modelo do equipamento | Estoque dos suprimentos cheios"))).toBe(true);
    expect(flat.some((r) => r.includes("necessidade para um mês de produção"))).toBe(true);

    // A quantidade exportada é a do OPERADOR, não a sugestão.
    expect(matrix.some((r) => r.includes("VersaLink B405") && r[r.length - 1] === 4)).toBe(true);
  });

  it("GOMAQ-06b: camada de exportação é SEPARADA da estrutura interna", () => {
    // O adaptador vive em lib/ e não conhece o schema do banco.
    expect(exportLayer).not.toContain('from "convex/values"');
    expect(exportLayer).not.toContain("_generated");
    expect(exportLayer).not.toContain("db.insert");
    expect(exportLayer).not.toContain("db.patch");
    // E o backend de estoque não conhece o formato da planilha.
    expect(backend).not.toContain("Gomaq Export");
    expect(backend).not.toContain("xlsx");
    // O SIGESGD permanece a fonte de verdade.
    expect(exportLayer).toContain("SIGESGD (fonte de verdade)");
  });

  it("GOMAQ-06c: campos ausentes viram célula vazia, nunca número inventado", () => {
    const doc = buildGomaqExportDocument({
      header: { requesterName: null, requesterPhone: null, date: null },
      delivery: {
        legalName: null, cnpj: null, address: null, addressComplement: null,
        district: null, cityUf: null, cep: null, contact: null,
      },
      items: [],
      period: null,
    });
    expect(doc.header.requesterName).toBeNull();
    expect(doc.delivery.cep).toBeNull();
    expect(doc.rows).toEqual([]);

    const matrix = gomaqDocumentToMatrix(doc);
    const headerRow = matrix.find((r) => r[0] === "Nome do solicitante");
    expect(headerRow?.[1]).toBe("");
    // Serial vazio vira string vazia, nunca "undefined".
    expect(matrix.some((r) => r.some((c) => String(c).includes("undefined")))).toBe(false);

    expect(formatCityUf("Campinas", "SP")).toBe("Campinas/SP");
    expect(formatCityUf("Campinas", null)).toBe("Campinas");
    expect(formatCityUf(null, "SP")).toBe("SP");
  });
});

describe("GOMAQ — Necessidade estimada é parâmetro manual", () => {
  it("necessidade estimada nunca é inventada", () => {
    const comParametro = buildEstimatedNeedRow({
      currentStock: 3, minimumStock: 2, idealStock: 6, monthlyConsumptionTarget: 4,
    });
    expect(comParametro.estimatedNeed).toBe(4);
    expect(comParametro.needSource).toBe("parameter");
    expect(comParametro.suggestedReplenishment).toBe(3);

    // Sem parâmetro de consumo: NADA é estimado.
    const semParametro = buildEstimatedNeedRow({
      currentStock: 3, minimumStock: 2, idealStock: 6, monthlyConsumptionTarget: null,
    });
    expect(semParametro.estimatedNeed).toBeNull();
    expect(semParametro.needSource).toBe("none");
    expect(NEED_SOURCE_LABELS.none).toBe("Não informado");
  });
});

describe("GOMAQ — RBAC da solicitação mensal", () => {
  it("Diretor consulta; Técnico não acessa", () => {
    const roles: AppRole[] = ["admin", "secretary", "stock_manager", "director", "technician"];
    expect(roles.filter((r) => roleHasPermission(r, "supply_requests.view")).sort()).toEqual([
      "admin", "director", "secretary", "stock_manager",
    ]);
    expect(roles.filter((r) => roleHasPermission(r, "supply_requests.manage")).sort()).toEqual([
      "admin", "secretary", "stock_manager",
    ]);
    expect(roleHasPermission("technician", "supply_requests.view")).toBe(false);

    // Backend coerente com a matriz.
    for (const name of ["list", "get", "suggestions"]) {
      expect(code(name)).toContain('requirePermission(ctx, "supply_requests.view"');
    }
    for (const name of MUTATIONS) {
      expect(code(name)).toContain('requirePermission(ctx, "supply_requests.manage"');
    }
  });
});

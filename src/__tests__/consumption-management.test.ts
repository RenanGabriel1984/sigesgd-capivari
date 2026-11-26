import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  aggregateConsumptionHierarchy,
  type OrganizationalMovement,
} from "@/lib/consumption-organization";
import { getConsumptionPeriod } from "@/lib/consumption-history";

function movement(overrides: Partial<OrganizationalMovement> = {}): OrganizationalMovement {
  return {
    _id: "movement-1",
    productId: "product-1",
    productName: "Papel A4",
    categoryName: "Papelaria",
    type: "exit",
    quantity: 10,
    timestamp: Date.UTC(2026, 0, 10),
    secretariaId: "secretaria-1",
    secretariaName: "Administração",
    departamentoId: "departamento-1",
    departamentoName: "Compras",
    unidadeId: "unidade-1",
    unidadeName: "Paço Municipal",
    reason: "Reposição para atendimento das equipes",
    unitOfMeasure: "resma",
    unitCost: 2.5,
    ...overrides,
  };
}

describe("Consumo gerencial — cruzamento organizacional", () => {
  it("agrega Secretaria × Departamento × Unidade × Produto sem duplicar saídas", () => {
    const rows = aggregateConsumptionHierarchy([
      movement({ _id: "m1", quantity: 10 }),
      movement({ _id: "m2", quantity: 5 }),
      movement({
        _id: "m3",
        secretariaId: "secretaria-2",
        secretariaName: "Saúde",
        quantity: 7,
        unitCost: 4,
      }),
    ]);

    expect(rows).toHaveLength(2);
    const admin = rows.find((row) => row.secretariaId === "secretaria-1");
    expect(admin?.quantity).toBe(15);
    expect(admin?.exitCount).toBe(2);
    expect(admin?.cost).toBe(37.5);
    expect(rows.find((row) => row.secretariaId === "secretaria-2")?.cost).toBe(28);
  });

  it("mantém órgãos distintos mesmo quando os nomes são iguais", () => {
    const rows = aggregateConsumptionHierarchy([
      movement({ _id: "m1", secretariaId: "secretaria-1", secretariaName: "Administração" }),
      movement({ _id: "m2", secretariaId: "secretaria-2", secretariaName: "Administração" }),
    ]);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.secretariaId))).toEqual(new Set(["secretaria-1", "secretaria-2"]));
  });

  it("não conta transferência, devolução, saída cancelada ou reversão como consumo", () => {
    const rows = aggregateConsumptionHierarchy([
      movement({ _id: "valid" }),
      movement({ _id: "transfer", type: "transfer", quantity: 100 }),
      movement({ _id: "return", type: "return", quantity: 100 }),
      movement({ _id: "canceled", canceled: true, quantity: 100 }),
      movement({ _id: "reversed-exit", exitMovementId: "original-exit", quantity: 100 }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].quantity).toBe(10);
    expect(rows[0].exitCount).toBe(1);
  });

  it("não apresenta custo parcial quando uma saída do agrupamento não tem custo confiável", () => {
    const rows = aggregateConsumptionHierarchy([
      movement({ _id: "known", quantity: 2, unitCost: 5 }),
      movement({ _id: "unknown", quantity: 3, unitCost: null }),
    ]);
    expect(rows[0].quantity).toBe(5);
    expect(rows[0].cost).toBeNull();
    expect(rows[0].costLabel).toBe("Custo não informado");
  });

  it("separa as justificativas registradas para explicar o perfil das retiradas", () => {
    const rows = aggregateConsumptionHierarchy([
      movement({ _id: "m1", reason: "Reposição de rotina" }),
      movement({ _id: "m2", reason: "Atendimento de demanda extraordinária" }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.reason).sort()).toEqual([
      "Atendimento de demanda extraordinária",
      "Reposição de rotina",
    ]);
    expect(rows.every((row) => row.unitOfMeasure === "resma")).toBe(true);
  });

  it("oferece a janela quinzenal para os relatórios de reunião", () => {
    expect(getConsumptionPeriod("15d")).toMatchObject({
      key: "15d",
      label: "Últimos 15 dias",
      days: 15,
      months: 0.5,
    });
  });

  it("não soma unidades de medida diferentes em indicadores gerenciais globais", () => {
    const component = readFileSync(resolve(__dirname, "../components/reports/ConsumptionManagement.tsx"), "utf8");
    expect(component).toContain("Produtos distintos consumidos");
    expect(component).toContain("Frequência de saídas por grupo");
    expect(component).toContain('const chartUsesQuantity = dimension === "produto"');
    expect(component).toContain('dimension === "produto" ? row.quantity : row.exits');
    expect(component).not.toContain("currentSummary.quantity");
    expect(component).not.toContain("previousSummary.quantity");
  });

  it("consulta saídas por data e usa as alocações FIFO para apurar custo", () => {
    const source = readFileSync(resolve(__dirname, "../convex/stockIntelligence.ts"), "utf8");
    const schema = readFileSync(resolve(__dirname, "../convex/schema.ts"), "utf8");
    expect(source).toContain('withIndex("by_timestamp"');
    expect(source).toContain('withIndex("by_created_at"');
    expect(source).toContain('allocation.allocationType !== "withdrawal"');
    expect(source).toContain("Math.abs(allocatedQuantity - movement.quantity)");
    expect(schema).toContain('.index("by_created_at", ["createdAt"])');
  });
});

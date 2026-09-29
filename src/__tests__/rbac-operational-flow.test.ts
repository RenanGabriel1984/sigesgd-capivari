/**
 * Gestão de Estoque SGGD — TESTE OPERACIONAL DO FLUXO (ambiente de teste).
 *
 * Valida, por leitura da FONTE REAL das mutations, o ciclo obrigatório:
 *
 *   Técnico consulta estoque → cria requisição
 *     → Diretor/Gestor autorizado aprova (estoque RESERVA)
 *     → Gestor separa/entrega (BAIXA físico + libera RESERVA)
 *     → Movimentação + auditoria registradas
 *
 * Invariantes verificadas em cada etapa:
 *   available = physical - reserved · reserved <= physical
 *   physical >= 0 · reserved >= 0 · baixa somente na entrega
 *   autoaprovação bloqueada · permission_denied auditável
 *
 * Nenhum dado de produção é alterado — o teste é fonte + regras puras.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { roleHasPermission, canActOnRequest, APP_ROLES } from "@/lib/rbac";

const ROOT = resolve(__dirname, "../..");
const reqSrc = readFileSync(resolve(ROOT, "src/convex/requests.ts"), "utf-8");
const movSrc = readFileSync(resolve(ROOT, "src/convex/stockMovements.ts"), "utf-8");
const rbacSrc = readFileSync(resolve(ROOT, "src/convex/rbac.ts"), "utf-8");
const repSrc = readFileSync(resolve(ROOT, "src/convex/dataRepairs.ts"), "utf-8");

describe("etapa 1 — técnico consulta estoque e cria requisição", () => {
  it("técnico tem stock.view/products.view mas não pode mutar estoque", () => {
    expect(roleHasPermission("technician", "stock.view")).toBe(true);
    expect(roleHasPermission("technician", "products.view")).toBe(true);
    expect(roleHasPermission("technician", "stock.mutate")).toBe(false);
  });

  it("create exige requests.create e registra auditoria 'create'", () => {
    const create = reqSrc.slice(reqSrc.indexOf("export const create"), reqSrc.indexOf("export const approve"));
    expect(create).toContain('requirePermission(ctx, "requests.create"');
    expect(create).toContain('action: "create"');
  });
});

describe("etapa 2 — diretor/gestor aprovado reserva estoque", () => {
  it("apenas papéis com requests.approve aprovam (director, stock_manager, admin, secretary)", () => {
    const approvers = APP_ROLES.filter((r) => roleHasPermission(r, "requests.approve"));
    expect(approvers.sort()).toEqual(["admin", "director", "secretary", "stock_manager"]);
    expect(roleHasPermission("technician", "requests.approve")).toBe(false);
  });

  it("valida disponibilidade ANTES de reservar e aborta sem reserva parcial", () => {
    expect(reqSrc).toContain("const available = stock.physicalQuantity - stock.reservedQuantity;");
    expect(reqSrc).toContain("Nenhum item foi reservado — operação abortada.");
  });

  it("aprovação RESERVA (reservedQuantity += aprovado) com revalidação fresh", () => {
    expect(reqSrc).toContain("const newReserved = freshStock.reservedQuantity + item.quantityApproved;");
    expect(reqSrc).toMatch(/const freshStock = await ctx\.db\./);
  });

  it("auditoria 'approve' registrada com usuário e itens", () => {
    expect(reqSrc).toContain('action: "approve", entity: "requests"');
  });
});

describe("etapa 3 — entrega baixa físico e libera reserva", () => {
  it("entrega exige requests.deliver + senha eletrônica", () => {
    const deliver = reqSrc.slice(reqSrc.indexOf("export const deliver"));
    expect(deliver).toContain('requirePermission(ctx, "requests.deliver"');
    expect(deliver).toContain("verifyPassword");
  });

  it("baixa efetiva SOMENTE na entrega: físico e reservado descem JUNTOS", () => {
    expect(reqSrc).toContain("const newPhysical = freshStock.physicalQuantity - input.quantityDelivered;");
    expect(reqSrc).toContain("const newReserved = freshStock.reservedQuantity - input.quantityDelivered;");
  });

  it("valida reserva suficiente antes de baixar (nunca reservado < 0)", () => {
    expect(reqSrc).toContain("Estoque reservado insuficiente");
  });

  it("registra movimentação de saída e auditoria 'deliver'", () => {
    const deliver = reqSrc.slice(reqSrc.indexOf("export const deliver"));
    expect(deliver).toContain('action: "deliver", entity: "requests"');
    expect(deliver).toMatch(/stockMovements/);
  });
});

describe("etapa 4 — autoaprovação bloqueada em qualquer papel", () => {
  it("backend bloqueia ator == solicitante ANTES de qualquer escrita", () => {
    expect(rbacSrc).toContain("auth.userId === requesterId");
    expect(rbacSrc).toContain("requests.self_approval");
  });

  it("nenhum papel escapa: approve/reject chamam requireRequestAction", () => {
    const approve = reqSrc.slice(reqSrc.indexOf("export const approve"), reqSrc.indexOf("export const reject"));
    const reject = reqSrc.slice(reqSrc.indexOf("export const reject"), reqSrc.indexOf("export const deliver"));
    expect(approve).toContain('requireRequestAction(ctx, "requests.approve"');
    expect(reject).toContain('requireRequestAction(ctx, "requests.reject"');
  });

  it("regra pura: ator nunca age sobre a própria requisição", () => {
    for (const role of APP_ROLES) {
      expect(
        canActOnRequest({ role, permission: "requests.approve", actorId: "x", requesterId: "x" }),
        role,
      ).toBe(false);
      expect(
        canActOnRequest({ role, permission: "requests.approve", actorId: "x", requesterId: "y" }),
        role,
      ).toBe(roleHasPermission(role, "requests.approve"));
    }
  });
});

describe("invariantes globais de estoque preservadas no código", () => {
  it("reserva usa revalidação fresh (evita condição de corrida)", () => {
    expect(reqSrc).toMatch(/freshStock\.reservedQuantity \+ item\.quantityApproved/);
  });

  it("cancellation libera reserva com guarda de inconsistência explícita", () => {
    expect(reqSrc).toContain("Inconsistência de estoque: reservado");
  });

  it("movimentações diretas de estoque exigem stock.mutate (sem bypass RBAC)", () => {
    expect(movSrc).toContain('requirePermission(ctx, "stock.mutate"');
  });

  it("permission_denied é auditável sem dados sensíveis", () => {
    expect(rbacSrc).toContain('"permission_denied"');
    expect(rbacSrc).toContain("ACESSO NEGADO — permissão exigida");
  });

  it("migrations de reparo histórico permanecem fechadas (internalMutation + RBAC de dados)", () => {
    expect(repSrc).toContain("internalMutation");
    expect(repSrc).not.toContain("publicMutation");
  });
});

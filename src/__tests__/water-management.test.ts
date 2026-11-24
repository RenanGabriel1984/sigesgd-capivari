import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  calculateWaterBalances,
  remainingWaterShare,
  splitWaterCost,
} from "@/lib/water-management";

describe("water mineral accounting", () => {
  it("calculates full and empty gallon balances from signed movements", () => {
    expect(calculateWaterBalances([
      { fullDelta: 12, emptyDelta: 4 },
      { fullDelta: -5, emptyDelta: 5 },
      { fullDelta: 6, emptyDelta: -8 },
    ])).toEqual({ full: 13, empty: 1 });
  });

  it("rejects negative balances and non-finite movement values", () => {
    expect(() => calculateWaterBalances([{ fullDelta: -1, emptyDelta: 0 }])).toThrow(/saldo negativo/i);
    expect(() => calculateWaterBalances([{ fullDelta: Number.NaN, emptyDelta: 0 }])).toThrow(/inválida/i);
  });

  it("splits costs exactly to the cent, assigning rounding remainder deterministically", () => {
    const shares = splitWaterCost(10, ["a", "b", "c"]);
    expect(shares.map((row) => row.shareAmount)).toEqual([3.33, 3.33, 3.34]);
    expect(shares.reduce((sum, row) => sum + row.shareAmount, 0)).toBe(10);
  });

  it("rejects empty and duplicate participant lists", () => {
    expect(() => splitWaterCost(10, [])).toThrow(/participantes/i);
    expect(() => splitWaterCost(10, ["a", "a"])).toThrow(/participantes/i);
  });

  it("supports partial payments and never returns a negative outstanding balance", () => {
    expect(remainingWaterShare(30, [10, 5])).toBe(15);
    expect(remainingWaterShare(30, [10, 20])).toBe(0);
  });
});


const waterBackend = readFileSync(resolve(__dirname, "../convex/water.ts"), "utf8");
const appSource = readFileSync(resolve(__dirname, "../main.tsx"), "utf8");
const shellSource = readFileSync(resolve(__dirname, "../components/AppShell.tsx"), "utf8");

function exportedBlock(source: string, exportName: string): string {
  const start = source.indexOf(`export const ${exportName} =`);
  if (start < 0) throw new Error(`Export ${exportName} não encontrado`);
  const next = source.indexOf("\nexport const ", start + 1);
  return source.slice(start, next < 0 ? source.length : next);
}

describe("integração segura da gestão de água mineral", () => {
  it("expõe o painel somente após validar a permissão de gestão do estoque", () => {
    const block = exportedBlock(waterBackend, "dashboard");
    const guard = block.indexOf("await requireWaterRead(ctx)");
    const firstRead = block.indexOf('ctx.db.query("waterParticipants")');
    expect(guard).toBeGreaterThan(-1);
    expect(firstRead).toBeGreaterThan(guard);
    expect(waterBackend).toContain('requirePermission(ctx, "stock.mutate", { entity: "waterManagement" })');
  });

  it("protege todas as mutações com a permissão central antes das escritas", () => {
    for (const mutation of [
      "createParticipant",
      "setParticipantActive",
      "recordMovement",
      "createPeriod",
      "reversePayment",
      "recordPayment",
    ]) {
      const block = exportedBlock(waterBackend, mutation);
      const guard = block.indexOf("requireWaterManage(ctx)");
      const firstWrite = Math.min(
        ...['ctx.db.insert("', "ctx.db.patch("]
          .map((needle) => block.indexOf(needle))
          .filter((index) => index >= 0),
      );
      expect(guard, `${mutation} deve validar autorização`).toBeGreaterThan(-1);
      expect(firstWrite, `${mutation} deve gravar dados`).toBeGreaterThan(guard);
    }
  });

  it("mantém o módulo de água separado do estoque geral, entradas fiscais e Gomaq", () => {
    expect(waterBackend).not.toContain('ctx.db.insert("stock"');
    expect(waterBackend).not.toContain('ctx.db.patch("stock"');
    expect(waterBackend).not.toContain('ctx.db.insert("stockMovements"');
    expect(waterBackend).not.toContain('ctx.db.insert("entries"');
    expect(waterBackend).not.toContain('ctx.db.insert("gomaq"');
  });

  it("registra auditoria em cada mutação operacional do módulo", () => {
    for (const mutation of [
      "createParticipant",
      "setParticipantActive",
      "recordMovement",
      "createPeriod",
      "reversePayment",
      "recordPayment",
    ]) {
      const block = exportedBlock(waterBackend, mutation);
      expect(block, `${mutation} deve registrar trilha de auditoria`).toContain('ctx.db.insert("auditLogs"');
    }
  });

  it("liga a rota /water à página e mostra o item no menu operacional", () => {
    expect(appSource).toContain('path="/water"');
    expect(appSource).toContain('import("./pages/WaterManagement.tsx")');
    expect(shellSource).toContain('label: "Água mineral", href: "/water"');
    expect(shellSource).toContain('permission: "canManageStock"');
  });

  it("preserva a imutabilidade das competências, exige participantes ativos e limita pagamentos ao saldo", () => {
    const period = exportedBlock(waterBackend, "createPeriod");
    const payment = exportedBlock(waterBackend, "recordPayment");
    const reverse = exportedBlock(waterBackend, "reversePayment");
    expect(period).toContain("Já existe uma competência com esse nome");
    expect(period).toContain("O período informado sobrepõe uma competência já registrada");
    expect(period).toContain("row.active === false");
    expect(payment).toContain("remainingWaterShare(charge.shareAmount, participantPayments)");
    expect(payment).toContain("normalizedAmount > remaining");
    expect(reverse).toContain("payment.reversedAt");
    expect(reverse).toContain("reversalReason: reason");
  });
});

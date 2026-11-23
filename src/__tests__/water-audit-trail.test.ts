import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const water = readFileSync(resolve(__dirname, "../convex/water.ts"), "utf-8");

function mutationBlock(name: string): string {
  const start = water.indexOf("export const " + name + " = mutation({");
  expect(start, "mutation " + name + " ausente").toBeGreaterThan(-1);
  const next = water.indexOf("\nexport const ", start + 1);
  return water.slice(start, next < 0 ? undefined : next);
}

describe("trilha de auditoria do controle de água mineral", () => {
  const mutations = [
    "createParticipant",
    "updateParticipant",
    "createPeriod",
    "setPeriodParticipants",
    "createReceipt",
    "recordContainerMovement",
    "closePeriod",
    "reverseReceipt",
    "reverseContainerMovement",
    "reversePayment",
    "recordPayment",
  ];

  it.each(mutations)("registra operador, entidade, registro e detalhes em %s", (name) => {
    const block = mutationBlock(name);
    expect(block).toContain("writeAudit(ctx, userId,");
    expect(block).toMatch(/writeAudit\(ctx, userId, "(create|update)"/);
  });

  it("helper grava usuário, ação, entidade, registro, detalhes e horário", () => {
    const helperStart = water.indexOf("async function writeAudit(");
    const helperEnd = water.indexOf("\n}", helperStart);
    const helper = water.slice(helperStart, helperEnd + 2);
    expect(helper).toContain("userId, action, entity, entityId, details");
    expect(helper).toContain("timestamp: Date.now()");
    expect(helper).toContain('ctx.db.insert("auditLogs", {');
  });

  it("estornos mantêm identificação do registro original e motivo na auditoria", () => {
    expect(mutationBlock("reverseReceipt")).toContain("ESTORNO do recebimento original. Motivo:");
    expect(mutationBlock("reverseContainerMovement")).toContain("ESTORNO da movimentação");
    expect(mutationBlock("reversePayment")).toContain("ESTORNO de pagamento");
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const requests = readFileSync(
  resolve(__dirname, "../convex/requests.ts"),
  "utf-8",
);
const deliverStart = requests.indexOf("export const deliver = mutation({");
const deliverEnd = requests.indexOf("export const cancel = mutation({", deliverStart);
const deliver = requests.slice(deliverStart, deliverEnd);

describe("segurança da entrega de solicitações", () => {
  it("nega que o próprio solicitante confirme a entrega", () => {
    expect(deliver).toContain("requireRequestAction");
    expect(deliver).toContain('"requests.deliver"');
    expect(deliver).toContain("request.requesterId");
  });

  it("confere senha do usuário autenticado antes de movimentar estoque", () => {
    expect(deliver.indexOf("verifyPassword")).toBeGreaterThan(-1);
    expect(deliver.indexOf("verifyPassword")).toBeLessThan(deliver.indexOf('ctx.db.patch(stock._id'));
  });

  it("valida o usuário recebedor como ativo", () => {
    expect(deliver).toContain("recipient.active === false");
  });
});


describe("confirmação de entrega — unicidade do registro de senha", () => {
  it("bloqueia registros de senha duplicados antes de verificar a senha ou movimentar estoque", () => {
    const start = requests.indexOf("export const deliver = mutation({");
    const end = requests.indexOf("export const cancel = mutation({", start);
    const deliver = requests.slice(start, end);
    expect(deliver).toContain('withIndex("by_user", (q: any) => q.eq("userId", userId)).collect()');
    expect(deliver).toContain("passwordRecords.length !== 1");
    expect(deliver).toContain("const passwordRecord = passwordRecords[0]");
    expect(deliver.indexOf("passwordRecords.length !== 1")).toBeLessThan(deliver.indexOf("verifyPassword"));
    expect(deliver.indexOf("passwordRecords.length !== 1")).toBeLessThan(deliver.indexOf('ctx.db.patch(stock._id'));
    expect(deliver).not.toContain('withIndex("by_user", (q: any) => q.eq("userId", userId)).first()');
  });
});

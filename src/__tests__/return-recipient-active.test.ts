import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("devoluções — usuário recebedor", () => {
  it("rejeita usuário inexistente ou inativo antes de gravar a devolução", () => {
    const source = readFileSync(resolve(__dirname, "../convex/returns.ts"), "utf8");
    const start = source.indexOf("export const create = mutation({");
    const end = source.indexOf("\n});", start);
    const mutation = source.slice(start, end < 0 ? undefined : end);

    expect(mutation).toContain("if (args.receivedByUserId)");
    expect(mutation).toContain("const recipient = await ctx.db.get(args.receivedByUserId)");
    expect(mutation).toContain("!recipient || recipient.active === false");
    expect(mutation).toContain("Usuário recebedor não encontrado ou inativo");

    const validation = mutation.indexOf("recipient.active === false");
    const firstWrite = mutation.search(/ctx\\.db\\.(insert|patch)\\(/);
    expect(validation).toBeGreaterThan(-1);
    expect(firstWrite).toBeGreaterThan(validation);
  });
});

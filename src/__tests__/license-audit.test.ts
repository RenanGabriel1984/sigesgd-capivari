import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(__dirname, "../convex/licenses.ts"), "utf-8");
const listSource = source.slice(source.indexOf("export const list = query"), source.indexOf("export const get = query"));

describe("listagem de licenças sem truncamento silencioso", () => {
  it("carrega o conjunto completo antes de filtrar e mascarar chaves", () => {
    expect(listSource).toContain('.order("desc").collect()');
    expect(listSource).not.toContain(".take(500)");
    expect(listSource).toContain("maskLicenseKey");
  });
});

const updateStart = source.indexOf("export const update = mutation({");
const assignStart = source.indexOf("export const assignToAsset = mutation({");
const removeStart = source.indexOf("export const removeFromAsset = mutation({");
const update = source.slice(updateStart, assignStart);
const remove = source.slice(removeStart);

describe("auditoria de alterações de licenças", () => {
  it("registra atualização sem incluir o conteúdo da chave no log", () => {
    expect(update).toContain('action: "update"');
    expect(update).toContain('entity: "licenses"');
    expect(update).toContain("Object.keys(updates)");
    expect(update).not.toContain("details: JSON.stringify(updates)");
  });

  it("registra a remoção de vínculo com equipamento", () => {
    expect(remove).toContain('action: "update"');
    expect(remove).toContain('entity: "licenseAssignments"');
    expect(remove).toContain("assignment.licenseId");
  });
});

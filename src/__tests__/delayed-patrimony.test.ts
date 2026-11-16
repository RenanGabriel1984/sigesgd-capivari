import { describe, expect, it } from "vitest";
import { getRolePermissions, roleHasPermission } from "@/lib/rbac";
import { validateEntryUnits } from "@/lib/material-types";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const entries = read("src/convex/entries.ts");
const schema = read("src/convex/schema.ts");
const users = read("src/convex/users.ts");
const permissionGuard = read("src/components/RequirePermission.tsx");
const route = read("src/main.tsx");
const menu = read("src/components/AppShell.tsx");

describe("recebimento de bens permanentes com tombamento posterior", () => {
  it("aceita receber cada unidade sem número oficial de patrimônio", () => {
    expect(validateEntryUnits({
      materialType: "permanent",
      quantity: 2,
      units: [{ serialNumber: "SER-001" }, { serialNumber: "SER-002" }],
    })).toBeNull();
  });

  it("preserva a exigência de série somente para produto configurado com hasSerial", () => {
    expect(validateEntryUnits({
      materialType: "permanent",
      quantity: 1,
      units: [{}],
      requireSerial: false,
    })).toBeNull();
    expect(validateEntryUnits({
      materialType: "permanent",
      quantity: 1,
      units: [{}],
      requireSerial: true,
    })).toMatch(/exige número de série/);
    expect(entries).toContain("requireSerial: product?.hasSerial === true");
  });

  it("mantém a quantidade individual exata e rejeita quantidade inválida", () => {
    expect(validateEntryUnits({
      materialType: "permanent",
      quantity: 2,
      units: [{}],
    })).toMatch(/identificação provisória/);
    expect(validateEntryUnits({
      materialType: "permanent",
      quantity: 1.5,
      units: [{}, {}],
    })).toMatch(/inteiro positivo/);
  });

  it("cria unidades pendentes no rascunho sem patrimônio oficial", () => {
    expect(entries).toContain('patrimonyRegistrationStatus: "pending"');
    expect(entries).toContain("só pode ser atribuído pelo setor de Patrimônio após a confirmação da entrada");
  });

  it("só lista pendências depois da confirmação da entrada", () => {
    expect(entries).toContain('requirePermission(ctx, "patrimony.view"');
    expect(entries).toContain('entry.status !== "confirmed"');
    expect(entries).toContain("export const listPendingPatrimony = query");
  });

  it("só atribui patrimônio pela permissão específica e depois da confirmação", () => {
    expect(entries).toContain('requirePermission(ctx, "patrimony.assign"');
    expect(entries).toContain("export const assignPatrimony = mutation");
    expect(entries).toContain('patrimonyRegistrationStatus: "registered"');
    expect(entries).toContain('action: "asset_assign"');
  });

  it("previne duplicidade de número patrimonial e conflito de número de série", () => {
    expect(entries).toContain("row.patrimonyNumber?.trim().toLocaleUpperCase");
    expect(entries).toContain("asset.patrimonyNumber?.trim().toLocaleUpperCase");
    expect(entries).toContain("const serialOwner = assets.find");
  });

  it("mantém rastreabilidade entrada → item → unidade → equipamento", () => {
    expect(schema).toContain('entryItemUnitId: v.optional(v.id("entryItemUnits"))');
    expect(schema).toContain('assetId: v.optional(v.id("assets"))');
    expect(entries).toContain("entryId: unit.entryId");
    expect(entries).toContain("entryItemId: unit.entryItemId");
    expect(entries).toContain("entryItemUnitId: args.entryItemUnitId");
  });

  it("disponibiliza o papel patrimonial no cadastro e edição de usuários", () => {
    expect(users).toContain('v.literal("patrimony_manager")');
  });

  it("dá ao perfil somente tombamento e ajustes pessoais", () => {
    const permissions = getRolePermissions("patrimony_manager");
    expect(permissions).toContain("patrimony.view");
    expect(permissions).toContain("patrimony.assign");
    expect(permissions).toContain("settings.view");
    for (const denied of [
      "dashboard.view", "stock.view", "stock.mutate", "entries.create",
      "equipment.view", "equipment.manage", "users.manage", "audit.view",
    ] as const) {
      expect(roleHasPermission("patrimony_manager", denied), denied).toBe(false);
    }
  });

  it("registra rota e menu exclusivos, com encaminhamento após login", () => {
    expect(route).toContain('path="/patrimony"');
    expect(menu).toContain('href: "/patrimony"');
    expect(menu).toContain('permission: "canViewPatrimony"');
    expect(permissionGuard).toContain('user.role === "patrimony_manager"');
    expect(permissionGuard).toContain('<Navigate to="/patrimony" replace />');
  });

  it("não altera saldo, lotes ou movimentações no tombamento posterior", () => {
    const assignBlock = entries.slice(entries.indexOf("export const assignPatrimony = mutation"));
    expect(assignBlock).not.toContain("stockMovements");
    expect(assignBlock).not.toContain("stockByLocation");
    expect(assignBlock).not.toContain('ctx.db.patch("lots"');
  });
});

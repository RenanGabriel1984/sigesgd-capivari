import { describe, expect, it } from "vitest";
import { validateEntryUnits } from "@/lib/material-types";
import { getRolePermissions, roleHasPermission } from "@/lib/rbac";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const entriesBackend = readFileSync(resolve(root, "src/convex/entries.ts"), "utf8");
const schema = readFileSync(resolve(root, "src/convex/schema.ts"), "utf8");
const usersBackend = readFileSync(resolve(root, "src/convex/users.ts"), "utf8");
const page = readFileSync(resolve(root, "src/pages/Patrimony.tsx"), "utf8");
const assetsBackend = readFileSync(resolve(root, "src/convex/assets.ts"), "utf8");
const routeGuard = readFileSync(resolve(root, "src/components/RequirePermission.tsx"), "utf8");

describe("recebimento de material permanente com tombamento posterior", () => {
  it("permite confirmar unidade recebida sem número oficial de patrimônio", () => {
    expect(validateEntryUnits({
      materialType: "permanent",
      quantity: 1,
      units: [{ serialNumber: "SERIAL-001", manufacturer: "Dell", model: "OptiPlex" }],
    })).toBeNull();
  });

  it("permite mais de uma unidade desde que exista um registro para cada equipamento", () => {
    expect(validateEntryUnits({
      materialType: "permanent",
      quantity: 3,
      units: [{}, {}, {}],
    })).toBeNull();
  });

  it("continua exigindo a quantidade exata de identificações individuais", () => {
    expect(validateEntryUnits({
      materialType: "permanent",
      quantity: 2,
      units: [{}],
    })).toMatch(/identificação provisória/);
  });

  it("rejeita quantidade fracionada ou inválida para bem permanente", () => {
    expect(validateEntryUnits({
      materialType: "permanent",
      quantity: 1.5,
      units: [{}, {}],
    })).toMatch(/número inteiro positivo/);
    expect(validateEntryUnits({
      materialType: "permanent",
      quantity: 0,
      units: [],
    })).toMatch(/número inteiro positivo/);
  });

  it("não permite unidades patrimoniais em material de consumo", () => {
    expect(validateEntryUnits({
      materialType: "consumption",
      quantity: 10,
      units: [{}],
    })).toMatch(/Material de consumo/);
  });
});

describe("perfil específico do setor de Patrimônio", () => {
  it("recebe somente permissões do fluxo de tombamento e acesso básico", () => {
    const permissions = getRolePermissions("patrimony_manager");
    expect(permissions).toContain("dashboard.view");
    expect(permissions).toContain("patrimony.view");
    expect(permissions).toContain("patrimony.assign");
    expect(permissions).toContain("settings.view");
    expect(permissions).not.toContain("stock.mutate");
    expect(permissions).not.toContain("entries.create");
    expect(permissions).not.toContain("equipment.manage");
    expect(permissions).not.toContain("users.manage");
  });

  it("nega atribuição de patrimônio para estoque e técnicos", () => {
    expect(roleHasPermission("stock_manager", "patrimony.assign")).toBe(false);
    expect(roleHasPermission("technician", "patrimony.assign")).toBe(false);
    expect(roleHasPermission("patrimony_manager", "patrimony.assign")).toBe(true);
    expect(roleHasPermission("admin", "patrimony.assign")).toBe(true);
  });
});


describe("integração do tombamento com a entrada e o cadastro de ativos", () => {
  it("mantém entrada, item e unidade ligados ao ativo patrimonial", () => {
    expect(schema).toContain('entryItemUnitId: v.optional(v.id("entryItemUnits"))');
    expect(schema).toContain('assetId: v.optional(v.id("assets"))');
    expect(entriesBackend).toContain("entryId: unit.entryId");
    expect(entriesBackend).toContain("entryItemId: unit.entryItemId");
    expect(entriesBackend).toContain("entryItemUnitId: args.entryItemUnitId");
  });

  it("libera a fila somente para quem possui permissão de visualizar Patrimônio", () => {
    expect(entriesBackend).toContain('requirePermission(ctx, "patrimony.view"');
    expect(page).toContain("api.entries.listPendingPatrimony");
    expect(page).toContain("Pendências de tombamento patrimonial");
  });

  it("somente permite atribuição pós-confirmação com permissão dedicada", () => {
    expect(entriesBackend).toContain('requirePermission(ctx, "patrimony.assign"');
    expect(entriesBackend).toContain('entry.status !== "confirmed"');
    expect(entriesBackend).toContain('patrimonyRegistrationStatus: "registered"');
    expect(entriesBackend).toContain('action: "asset_assign"');
  });

  it("bloqueia duplicidade de patrimônio em unidades e cadastros de ativos", () => {
    expect(entriesBackend).toContain("row.patrimonyNumber?.trim().toLocaleUpperCase");
    expect(entriesBackend).toContain("asset.patrimonyNumber?.trim().toLocaleUpperCase");
  });

  it("disponibiliza o perfil específico no provisionamento de usuários", () => {
    expect(usersBackend).toContain('v.literal("patrimony_manager")');
    expect(usersBackend).toContain("export const createUser = mutation");
    expect(usersBackend).toContain("role: args.role");
  });

  it("bloqueia tombamento pelo CRUD genérico de ativos sem a permissão patrimonial", () => {
    expect(assetsBackend).toContain('requirePermission(ctx, "patrimony.assign", { entity: "assets" })');
    expect(assetsBackend).toContain('entityId: String(args.assetId)');
  });

  it("direciona o perfil patrimonial à sua fila, sem abrir o dashboard de estoque", () => {
    expect(routeGuard).toContain('user.role === "patrimony_manager"');
    expect(routeGuard).toContain('<Navigate to="/patrimony" replace />');
  });
});

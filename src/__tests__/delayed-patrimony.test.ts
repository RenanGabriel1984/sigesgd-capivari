import { describe, expect, it } from "vitest";
import { validateEntryUnits } from "@/lib/material-types";
import { getRolePermissions, roleHasPermission } from "@/lib/rbac";

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

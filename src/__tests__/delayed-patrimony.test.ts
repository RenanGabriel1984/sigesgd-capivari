import { describe, expect, it } from "vitest";
import { validateEntryUnits } from "@/lib/material-types";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const entries = read("src/convex/entries.ts");
const assets = read("src/convex/assets.ts");
const schema = read("src/convex/schema.ts");
const route = read("src/lib/rbac.ts");
const menu = read("src/components/AppShell.tsx");
const page = read("src/pages/Patrimony.tsx");
const editor = read("src/components/PatrimonyUnitsEditor.tsx");
const dialog = read("src/components/EntryPatrimonyDialog.tsx");

describe("identificação de equipamentos e solicitação de baixa patrimonial", () => {
  it("permite receber material permanente sem número patrimonial", () => {
    expect(validateEntryUnits({
      materialType: "permanent",
      quantity: 2,
      units: [{ serialNumber: "SER-001" }, { serialNumber: "SER-002" }],
    })).toBeNull();
  });

  it("preserva a exigência de série somente quando o produto exige", () => {
    expect(validateEntryUnits({ materialType: "permanent", quantity: 1, units: [{}], requireSerial: false })).toBeNull();
    expect(validateEntryUnits({ materialType: "permanent", quantity: 1, units: [{}], requireSerial: true })).toMatch(/exige número de série/);
    expect(entries).toContain("requireSerial: product?.hasSerial === true");
  });

  it("registra número patrimonial opcional já conhecido sem atribuir tombamento pela TI", () => {
    const setUnits = entries.slice(entries.indexOf("export const setUnits = mutation"));
    expect(setUnits).toContain("patrimonyNumber: u.patrimonyNumber?.trim() || undefined");
    expect(setUnits).not.toContain("patrimonyRegistrationStatus");
    expect(setUnits).not.toContain("patrimonyAssignedByUserId");
    expect(setUnits).not.toContain('v.literal("disposed")');
    expect(editor).toContain("UNIT_OPERATIONAL_STATUSES");
    expect(entries).not.toContain("export const assignPatrimony");
    expect(entries).not.toContain("export const listPendingPatrimony");
    expect(dialog).toContain("patrimonyNumber: unit.patrimonyNumber?.trim() || undefined");
    expect(editor).toContain("Patrimônio (se conhecido)");
    expect(editor).toContain("a TI não realiza tombamento oficial");
  });

  it("modela as três etapas da baixa sem confundir os responsáveis", () => {
    expect(schema).toContain("disposalRequests: defineTable");
    expect(schema).toContain('v.literal("sent_to_patrimony")');
    expect(schema).toContain('v.literal("confirmed_by_patrimony")');
    expect(schema).toContain('v.literal("sent_to_warehouse")');
    expect(schema).toContain('v.literal("disposal_requested")');
    expect(schema).toContain('v.literal("disposal_confirmed")');
  });

  it("registra solicitação encaminhada pelo TI ao Departamento de Patrimônio", () => {
    expect(assets).toContain("export const requestDisposal = mutation");
    expect(assets).toContain('status: "sent_to_patrimony"');
    expect(assets).toContain('eventType: "disposal_requested"');
    expect(assets).toContain("Solicitação encaminhada ao Departamento de Patrimônio");
  });

  it("só registra baixa oficial quando há documento/protocolo e data recebidos do Patrimônio", () => {
    expect(assets).toContain("export const recordDisposalConfirmation = mutation");
    expect(assets).toContain('request.status !== "sent_to_patrimony"');
    expect(assets).toContain("confirmationReference: reference");
    expect(assets).toContain('status: "disposal_authorized"');
    expect(assets).toContain("Baixa oficial confirmada pelo Departamento de Patrimônio");
  });

  it("só permite encaminhar ao barracão depois da confirmação oficial", () => {
    expect(assets).toContain("export const markSentToWarehouse = mutation");
    expect(assets).toContain('request.status !== "confirmed_by_patrimony"');
    expect(assets).toContain('status: "sent_to_warehouse"');
    expect(assets).toContain("após a confirmação da baixa oficial");
  });

  it("impede que a alteração genérica de status simule baixa oficial", () => {
    expect(assets).toContain('["disposal_pending", "disposal_authorized", "sent_to_warehouse", "disposed"]');
    expect(assets).toContain("As etapas de baixa devem ser registradas pelo fluxo de Solicitação de baixa patrimonial");
    expect(assets).toContain('["disposal_pending", "disposal_authorized", "sent_to_warehouse", "disposed"].includes(asset.status)');
  });

  it("apresenta a tela como solicitação de baixa e não como fila de tombamento", () => {
    expect(page).toContain("Solicitações de baixa patrimonial");
    expect(page).toContain("A TI identifica o equipamento e encaminha a solicitação");
    expect(page).toContain("Registrar confirmação do Patrimônio");
    expect(menu).toContain('label: "Solicitações de baixa"');
    expect(route).toContain('"/patrimony": "equipment.view"');
  });

  it("não mistura a baixa patrimonial com movimentações de estoque", () => {
    const requestBlock = assets.slice(assets.indexOf("export const requestDisposal"), assets.indexOf("export const create = mutation"));
    expect(requestBlock).not.toContain("stockMovements");
    expect(requestBlock).not.toContain("stockByLocation");
    expect(requestBlock).not.toContain("physicalQuantity");
  });
});

import { describe, expect, it } from "vitest";
import { validateEntryUnits } from "@/lib/material-types";
import { roleHasPermission } from "@/lib/rbac";
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

describe("integração entre recebimento e cadastro de equipamentos", () => {
  it("lista somente unidades de entradas confirmadas de material permanente", () => {
    expect(assets).toContain("export const listUnlinkedEntryUnits = query");
    expect(assets).toContain('entry.status !== "confirmed" || entry.materialType !== "permanent"');
    expect(assets).toContain("!unit.assetId");
  });

  it("cria ou associa o equipamento usando vínculo reverso e identificadores existentes", () => {
    expect(assets).toContain("export const createFromEntryUnit = mutation");
    expect(assets).toContain("normalizeIdentifier(asset.patrimonyNumber)");
    expect(assets).toContain("normalizeIdentifier(asset.serialNumber)");
    expect(assets).toContain("entryItemUnitId: unit._id");
    expect(assets).toContain("await ctx.db.patch(unit._id, { assetId })");
    expect(schema).toContain('.index("by_serial", ["serialNumber"])');
  });

  it("não duplica equipamento já vinculado nem associa identificadores conflitantes", () => {
    expect(assets).toContain("if (unit.assetId)");
    expect(assets).toContain("Patrimônio e número de série apontam para equipamentos diferentes");
    expect(assets).toContain("O equipamento identificado já está vinculado a outra unidade recebida");
  });

  it("não movimenta estoque ao criar ou associar equipamento", () => {
    const block = assets.slice(assets.indexOf("export const createFromEntryUnit"), assets.indexOf("export const create = mutation"));
    expect(block).not.toContain('ctx.db.insert("stockMovements"');
    expect(block).not.toContain('ctx.db.patch("stock"');
    expect(block).not.toContain('ctx.db.insert("lots"');
  });

  it("oferece a associação na tela de equipamentos e mostra a origem da entrada", () => {
    const page = read("src/pages/Assets.tsx");
    const detail = read("src/components/EntryDetailsDialog.tsx");
    expect(page).toContain("Equipamentos recebidos ainda não vinculados");
    expect(page).toContain("Cadastrar / associar");
    expect(page).toContain("api.assets.createFromEntryUnit");
    expect(detail).toContain("Abrir cadastro do equipamento");
    expect(detail).toContain("Data de incorporação:");
  });
});

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
    expect(assets).toContain("export const assignPatrimonyNumber = mutation");
    expect(assets).toContain('requirePermission(ctx, "patrimony.assign"');
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

  it("impede a TI de atribuir número patrimonial pela criação/edição genérica", () => {
    const create = assets.slice(assets.indexOf("export const create = mutation"), assets.indexOf("export const update = mutation"));
    const update = assets.slice(assets.indexOf("export const update = mutation"), assets.indexOf("export const assign = mutation"));
    expect(create).toContain("requirePatrimonyManager(ctx)");
    expect(update).toContain("requirePatrimonyManager(ctx)");
    expect(roleHasPermission("stock_manager", "patrimony.assign")).toBe(false);
    expect(roleHasPermission("patrimony_manager", "patrimony.assign")).toBe(true);
  });

  it("só registra baixa oficial quando há documento/protocolo e data recebidos do Patrimônio", () => {
    expect(assets).toContain("export const recordDisposalConfirmation = mutation");
    const confirmation = assets.slice(assets.indexOf("export const recordDisposalConfirmation"), assets.indexOf("export const markSentToWarehouse"));
    expect(confirmation).toContain("requirePatrimonyManager(ctx)");
    expect(assets).toContain('request.status !== "sent_to_patrimony"');
    expect(assets).toContain("confirmationReference: reference");
    expect(assets).toContain('status: "disposal_authorized"');
    expect(assets).toContain("Baixa oficial confirmada pelo Departamento de Patrimônio");
  });

  it("só permite encaminhar ao barracão depois da confirmação oficial", () => {
    expect(assets).toContain("export const markSentToWarehouse = mutation");
    const warehouse = assets.slice(assets.indexOf("export const markSentToWarehouse"), assets.indexOf("export const listUnlinkedEntryUnits"));
    expect(warehouse).toContain("requirePatrimonyManager(ctx)");
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
    expect(menu).toContain('permission2: "canViewPatrimony"');
    expect(route).toContain('"/patrimony": "equipment.view"');
    expect(assets).toContain("export const assignPatrimonyNumber = mutation");
    expect(page).toContain("Equipamentos aguardando tombamento");
  });

  it("não mistura a baixa patrimonial com movimentações de estoque", () => {
    const requestBlock = assets.slice(assets.indexOf("export const requestDisposal"), assets.indexOf("export const create = mutation"));
    expect(requestBlock).not.toContain("stockMovements");
    expect(requestBlock).not.toContain("stockByLocation");
    expect(requestBlock).not.toContain("physicalQuantity");
  });
});

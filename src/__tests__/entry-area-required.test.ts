import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  NfeDestinationError,
  resolveNfeDestination,
  toEntryDestinationPayload,
} from "../lib/nfe-destination";

const root = resolve(__dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("área obrigatória nas novas entradas", () => {
  it("aceita somente destino com tipo e área escolhidos", () => {
    expect(resolveNfeDestination({
      override: { materialType: "consumption", areaId: "area-ti" },
    })).toEqual({ materialType: "consumption", areaId: "area-ti" });
  });

  it("rejeita área vazia no override e no estado persistido", () => {
    expect(() => resolveNfeDestination({
      override: { materialType: "consumption", areaId: "" },
    })).toThrow(NfeDestinationError);
    expect(() => resolveNfeDestination({
      state: { materialType: "permanent", areaId: null },
    })).toThrow(NfeDestinationError);
    expect(() => resolveNfeDestination({
      state: { materialType: "consumption", areaId: "   " },
    })).toThrow(NfeDestinationError);
  });

  it("persiste o identificador da área sem transformar armário em classificação", () => {
    expect(toEntryDestinationPayload({
      materialType: "permanent",
      areaId: " area-impressoras ",
    })).toEqual({ materialType: "permanent", areaId: "area-impressoras" });
  });
});

describe("barreiras de interface e backend para a área", () => {
  const entries = read("src/convex/entries.ts");
  const page = read("src/pages/Entries.tsx");
  const dialog = read("src/components/NfeDestinationDialog.tsx");
  const flow = read("src/lib/entry-import-flow.ts");

  it("exige areaId na criação de qualquer novo rascunho", () => {
    expect(entries).toMatch(/export const create = mutation\([\s\S]*?areaId: v\.id\("stockAreas"\)/);
    expect(entries).toContain("if (!destinationArea || !destinationArea.active)");
  });

  it("bloqueia confirmação de lote sem área ativa", () => {
    expect(entries).toContain("if (!effectiveAreaId)");
    expect(entries).toContain("if (!area || !area.active)");
  });

  it("permite classificar rascunho antigo e registra auditoria", () => {
    expect(entries).toContain("export const updateDraftArea = mutation({");
    expect(entries).toContain("Área/subestoque do rascunho");
    expect(page).toContain("api.entries.updateDraftArea");
  });

  it("exige área na entrada manual e no diálogo da NF-e", () => {
    expect(page).toContain("Selecione a área/subestoque de destino antes de registrar a entrada.");
    expect(page).toContain("label=\"Área de destino *\"");
    expect(dialog).toContain("disabled={!materialType || !areaId.trim()}");
    expect(dialog).not.toContain("Sem área definida");
  });

  it("o fluxo de importação tipa areaId como obrigatório", () => {
    expect(flow).toContain("areaId: string;");
    expect(flow).not.toContain("areaId?: string;");
  });
});

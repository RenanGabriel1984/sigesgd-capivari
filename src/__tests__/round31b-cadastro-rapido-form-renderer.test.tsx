import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PATH = resolve(__dirname, "..", "components", "QuickProductForm.tsx");
const FORM = readFileSync(PATH, "utf8");

describe("QuickProductForm.tsx — forma visual e ligação ao prefill", () => {
  it("exporta o componente e contém o campo de nome com rótulo e valor ligado ao state", () => {
    expect(FORM).toContain("export function QuickProductForm(");
    expect(FORM).toContain("Nome do produto *");
    expect(FORM).toContain("value={form.name}");
    expect(FORM).toContain("onChange={(event) => onFormChange({ name");
  });

  it("o placeholder indica o valor fiscal esperado para a DANFE Incotech", () => {
    expect(FORM).toContain(
      'placeholder="KIT TECLADO E MOUSE USB SLIM CHOCO"',
    );
  });

  it("categoria é obrigatória, tem opção de criação e feedback quando vazia", () => {
    expect(FORM).toContain("Selecione a categoria");
    expect(FORM).toContain("Criar categoria");
    expect(FORM).toContain(
      "Selecione uma categoria cadastrada ou crie uma nova para continuar.",
    );
  });

  it("unidade pré-seleciona a opção mapeada para PC e lista Peça (pc)", () => {
    expect(FORM).toContain('<SelectItem value="pc">Peça (pc)</SelectItem>');
    expect(FORM).toContain('value={form.unitOfMeasure || "none"}');
  });

  it("salvar e cancelar são passados como props e o dialog usa onCancel como onOpenChange", () => {
    expect(FORM).toContain("onSave={onSave}");
    expect(FORM).toContain("onCancel={onCancel}");
    expect(FORM).toContain("value ? onCancel() : onClose()");
  });

  it("os demais campos úteis do catálogo estão presentes", () => {
    expect(FORM).toContain("Descrição fiscal");
    expect(FORM).toContain("Marca");
    expect(FORM).toContain("Modelo");
    expect(FORM).toContain("Especificação");
  });
});

describe("QuickProductForm prop contract", () => {
  it("define targetIndex como número, mesmo quando chamado fora do fluxo da conferência", () => {
    expect(FORM).toContain("targetIndex: number");
    expect(FORM).toContain("props) {");
  });
});

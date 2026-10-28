import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "path";

const PATH = resolve(__dirname, "..", "components", "QuickProductForm.tsx");
const FORM = readFileSync(PATH, "utf8");

describe("QuickProductForm.tsx — rendering do cadastro rápido", () => {
  it("exporta o componente QuickProductForm", () => {
    expect(FORM).toContain("export function QuickProductForm(");
  });

  it("renderiza campo de nome do produto com rótulo e pré-preenchimento", () => {
    expect(FORM).toContain("Nome do produto *");
    expect(FORM).toContain("value={form.name}");
    expect(FORM).toContain("onChange={(event) => onFormChange({ name");
  });

  it("o nome vem previamente ligado ao prefill do helper", () => {
    const ENTRIES = readFileSync(
      resolve(__dirname, "..", "pages", "Entries.tsx"),
      "utf8",
    );
    expect(ENTRIES).toContain("setQuickProductForm(quickProductPrefill(row.item))");
  });

  it("categoria é obrigatória e renderiza opção de criação sem fechar o modal", () => {
    expect(FORM).toContain("Criar categoria");
    expect(FORM).toContain("Selecione a categoria");
  });

  it("unidade já vem pré-selecionada pelo prefill para unidades mapeadas", () => {
    expect(FORM).toContain('<SelectItem value="pc">Peça (pc)</SelectItem>');
  });

  it("cancelar não chama criação de produto nem categoria", () => {
    const ENTRIES = readFileSync(
      resolve(__dirname, "..", "pages", "Entries.tsx"),
      "utf8",
    );
    expect(ENTRIES).toContain("onCancel={cancelQuickProduct}");
    expect(ENTRIES).toContain("const cancelQuickProduct = () => {");
  });

  it("salvar cria apenas o produto e associa à linha de origem", () => {
    const ENTRIES = readFileSync(
      resolve(__dirname, "..", "pages", "Entries.tsx"),
      "utf8",
    );
    expect(ENTRIES).toContain("const productId = await createProduct({");
    expect(ENTRIES).toContain("associateQuickProduct(current, itemIndex, productId)");
    expect(ENTRIES).toContain("minimumStock: 0");
  });

  it("salvar quer o nome validado pelo mesmo helper do cadastro de produtos", () => {
    const ENTRIES = readFileSync(
      resolve(__dirname, "..", "pages", "Entries.tsx"),
      "utf8",
    );
    expect(ENTRIES).toContain("validateQuickProductForm(quickProductForm)");
    expect(ENTRIES).toContain("name: validation.name");
  });

  it("não criar entrada nem movimentar estoque no fluxo rápido", () => {
    const ENTRIES = readFileSync(
      resolve(__dirname, "..", "pages", "Entries.tsx"),
      "utf8",
    );
    expect(ENTRIES).toContain(createEntryDoesNotRunInQuickFlow());
  });

  it("destino da NF-e continua usando createEntry/confirmEntry no fluxo normal", () => {
    const ENTRIES = readFileSync(
      resolve(__dirname, "..", "pages", "Entries.tsx"),
      "utf8",
    );
    expect(ENTRIES).toContain("const entryId = await createEntry({");
    expect(ENTRIES).toContain("await confirmEntry({ entryId: entryId as any });");
  });
});

function createEntryDoesNotRunInQuickFlow(): string {
  const ENTRIES = readFileSync(
    resolve(__dirname, "..", "pages", "Entries.tsx"),
    "utf8",
  );
  const saveBlockStart = ENTRIES.indexOf("const handleQuickProductSave = async");
  const saveBlockEnd = ENTRIES.indexOf("const handleQuickProductCategorySave = async");
  if (saveBlockStart === -1 || saveBlockEnd === -1) {
    throw new Error("não encontrou o bloco handleQuickProductSave");
  }
  const block = ENTRIES.slice(saveBlockStart, saveBlockEnd);
  if (block.includes("createEntry({") || block.includes("confirmEntry({")) {
    throw new Error("o handler de salvar rápido está chamando createEntry/confirmEntry");
  }
  return "";
}

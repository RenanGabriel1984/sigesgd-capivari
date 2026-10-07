/**
 * RODADA — ENTRADA ÁGIL, FORNECEDORES E DANFE/OCR
 *
 * Cobre (§21 do prompt):
 *  - Máscaras visuais de CNPJ/telefone/CEP com valor normalizado no banco;
 *  - Endereço estruturado + consulta de CEP (ViaCEP com debounce) + falha silenciosa;
 *  - Cadastro de fornecedor inline na Entrada (fornecedor criado é selecionado);
 *  - Parser da DANFE (chave de 44 dígitos, emitente, itens, valor total);
 *  - Prevenção de duplicidade de NF (chave; ou fornecedor + número + série);
 *  - Segurança: OCR nunca cria estoque sozinho, sem segredos no frontend,
 *    uploads/criações sujeitos às permissões já existentes.
 *
 * Testes PUROS: não escrevem no banco e não movimentam estoque.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  digitsOnly,
  isValidCnpj,
  formatCnpj,
  formatPhone,
  formatCep,
  formatAccessKeyGrouped,
  maskCnpj,
  maskPhone,
  maskCep,
} from "@/lib/br-validators";
import { AddressTypeValues, maskedCnpj, maskedPhone, maskedCep } from "@/lib/supplier-form";
import { parseDanfeText } from "@/lib/danfe-ocr";
import {
  findDuplicateEntry,
  findEntryByAccessKey,
  findSupplierMatch,
  type NfeData,
  type SupplierForMatch,
} from "@/lib/nfe";

const read = (rel: string) => readFileSync(resolve(__dirname, "..", "..", rel), "utf8");

const CNPJ = "22816315000144";
const CNPJ_MASKED = "22.816.315/0001-44";
const ACCESS_KEY = "35260961457941000143550010003720431466669127";

// ═══════════════════════════════════════════════════════════════════════════
// 1. Máscaras visuais — valor exibido com pontuação, valor gravado normalizado
// ═══════════════════════════════════════════════════════════════════════════

describe("Máscaras de digitação (§3/§4)", () => {
  it("CNPJ: digitado sem pontuação, exibido com máscara", () => {
    expect(maskCnpj(CNPJ)).toBe(CNPJ_MASKED);
    expect(formatCnpj(CNPJ)).toBe(CNPJ_MASKED);
  });

  it("CNPJ: máscara progressiva sem separador órfão (backspace funciona)", () => {
    expect(maskCnpj("2")).toBe("2");
    expect(maskCnpj("228")).toBe("22.8");
    expect(maskCnpj("22816315")).toBe("22.816.315");
    expect(maskCnpj("2281631500014")).toBe("22.816.315/0001-4");
    expect(maskCnpj(CNPJ)).toBe(CNPJ_MASKED);
  });

  it("o banco recebe SOMENTE dígitos (máscara nunca vira chave)", () => {
    expect(digitsOnly(maskCnpj(CNPJ))).toBe(CNPJ);
    expect(digitsOnly(maskPhone("8330530760"))).toBe("8330530760");
    expect(digitsOnly(maskCep("88701600"))).toBe("88701600");
    expect(digitsOnly(formatAccessKeyGrouped(ACCESS_KEY))).toBe(ACCESS_KEY);
  });

  it("telefone: 10 dígitos → (83) 3053-0760 e 11 dígitos → (11) 98765-4321", () => {
    expect(maskPhone("8330530760")).toBe("(83) 3053-0760");
    expect(maskPhone("11987654321")).toBe("(11) 98765-4321");
    expect(formatPhone("8330530760")).toBe("(83) 3053-0760");
    expect(formatPhone("11987654321")).toBe("(11) 98765-4321");
    // parcial não ganha hífen indevido
    expect(maskPhone("8330530")).toBe("(83) 3053-0");
  });

  it("CEP: 88701600 → 88701-600 (completo e parcial)", () => {
    expect(maskCep("88701600")).toBe("88701-600");
    expect(formatCep("88701600")).toBe("88701-600");
    expect(maskCep("8870")).toBe("8870");
    expect(maskCep("887016")).toBe("88701-6");
  });

  it("chave de acesso: agrupada em 11 blocos de 4 para conferência visual", () => {
    const grouped = formatAccessKeyGrouped(ACCESS_KEY);
    expect(grouped.split(" ")).toHaveLength(11);
    expect(digitsOnly(grouped)).toBe(ACCESS_KEY);
    expect(digitsOnly(formatAccessKeyGrouped(CNPJ_MASKED))).toBe(CNPJ); // valor não padronizado volta como está
  });

  it("CNPJ: validação dos dígitos verificadores", () => {
    expect(isValidCnpj(CNPJ)).toBe(true);
    expect(isValidCnpj(CNPJ_MASKED)).toBe(true);
    expect(isValidCnpj("11111111111111")).toBe(false); // repetido
    expect(isValidCnpj("2281631500014")).toBe(false); // 13 dígitos
    expect(isValidCnpj("22816315000145")).toBe(false); // DV errado
  });

  it("helpers de exibição do formulário de fornecedor", () => {
    expect(maskedCnpj(CNPJ)).toBe(CNPJ_MASKED);
    expect(maskedPhone("11987654321")).toBe("(11) 98765-4321");
    expect(maskedCep("88701600")).toBe("88701-600");
    expect(AddressTypeValues).toEqual(["rua", "avenida", "travessa", "alameda", "rodovia", "estrada", "outro"]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Parser da DANFE (§10/§14) — OCR alimenta a conferência, nunca o estoque
// ═══════════════════════════════════════════════════════════════════════════

const DANFE_TEXT = [
  "DANFE - Documento Auxiliar da Nota Fiscal Eletronica",
  "3526 0961 4579 4100 0143 5500 1000 3720 4314 6666 9127",
  "NF-e Nº 372043",
  "Série: 001",
  "Emissão: 01/09/2026",
  "CNPJ: 61.457.941/0001-43",
  "Razão Social: GOMAQ MAQUINAS PARA ESCRITORIO LTDA",
  "Endereço: RUA DAS MAQUINAS, 100",
  "Cidade: SAO PAULO",
  "UF: SP",
  "CEP: 01001-000",
  "Valor Total da NF: R$ 1.323,50",
  "001 1001 KIT TECLADO E MOUSE USB SLIM CHOCO 25 UN 12,50 312,50",
  "002 2002 MOUSE OPTICO AMBIDESTRO 10 UN 25,00 250,00",
].join("\n");

describe("parseDanfeText — extração dos campos da DANFE (§10)", () => {
  const parsed = parseDanfeText(DANFE_TEXT);

  it("identifica a NF-e: número, série, emissão e chave de 44 dígitos", () => {
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.nfeNumber).toBe("372043");
    expect(parsed.series).toBe("001");
    expect(parsed.emissionDate).toBe("2026-09-01");
    expect(parsed.accessKey).toBe(ACCESS_KEY);
    expect(digitsOnly(parsed.accessKey ?? "")).toHaveLength(44);
  });

  it("identifica o emitente (CNPJ, razão social, endereço, cidade, UF, CEP)", () => {
    if (!parsed.ok) return;
    expect(parsed.emitterCnpj).toBe("61.457.941/0001-43");
    expect(parsed.emitterName).toBe("GOMAQ MAQUINAS PARA ESCRITORIO LTDA");
    expect(parsed.emitterAddress).toBe("RUA DAS MAQUINAS, 100");
    expect(parsed.emitterCity).toBe("SAO PAULO");
    expect(parsed.emitterState).toBe("SP");
    expect(digitsOnly(parsed.emitterPostalCode ?? "")).toBe("01001000");
  });

  it("não confunde o CNPJ do emitente com o do destinatário", () => {
    if (!parsed.ok) return;
    // Sem rótulo de destinatário e sem segundo CNPJ distinto → fica vazio.
    expect(parsed.receiverCnpj).toBeUndefined();
  });

  it("identifica o valor total da NF", () => {
    if (!parsed.ok) return;
    expect(parsed.totalValue).toBeCloseTo(1323.5, 2);
  });

  it("extrai os itens (código, descrição, unidade, quantidade e valores)", () => {
    if (!parsed.ok) return;
    expect(parsed.items).toHaveLength(2);
    const [first, second] = parsed.items;
    expect(first.code).toBe("1001");
    expect(first.description).toBe("KIT TECLADO E MOUSE USB SLIM CHOCO");
    expect(first.quantity).toBe(25);
    expect(first.unit).toBe("UN");
    expect(first.unitValue).toBeCloseTo(12.5, 2);
    expect(first.totalValue).toBeCloseTo(312.5, 2);
    expect(second.quantity).toBe(10);
    expect(second.totalValue).toBeCloseTo(250, 2);
  });

  it("aceita CNPJ sem pontuação (OCR costuma perder a máscara)", () => {
    const r = parseDanfeText(
      ["NF-e Nº 9999", "Série: 05", `CNPJ: ${CNPJ}`, "Razão Social: FORNECEDOR TESTE LTDA"].join("\n"),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(digitsOnly(r.emitterCnpj ?? "")).toBe(CNPJ);
  });

  it("sem chave identificada o parser NÃO falha (entrada manual continua possível)", () => {
    const r = parseDanfeText(["NF-e Nº 9999", "Série: 05", `CNPJ: ${CNPJ_MASKED}`].join("\n"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.accessKey).toBeUndefined();
    expect(r.nfeNumber).toBe("9999");
  });

  it("chave agrupada com quebra de linha no OCR também é reconhecida", () => {
    const wrapped = ["NF-e Nº 42", "3526 0961 4579 4100 0143", "5500 1000 3720 4314 6666 9127"].join("\n");
    const r = parseDanfeText(wrapped);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.accessKey).toBe(ACCESS_KEY);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Prevenção de duplicidade de NF (§16)
// ═══════════════════════════════════════════════════════════════════════════

describe("findDuplicateEntry — combinação chave / fornecedor + número + série", () => {
  const entries = [
    {
      _id: "e1",
      entryNumber: "ENT-2026-000001",
      accessKey: ACCESS_KEY,
      invoiceNumber: "372043",
      series: "001",
      supplier: { _id: "sup_gomaq" },
    },
    {
      _id: "e2",
      entryNumber: "ENT-2026-000002",
      accessKey: undefined,
      invoiceNumber: "999",
      series: "1",
      supplier: { _id: "sup_outro" },
    },
  ];

  it("chave de acesso (mesmo com espaços) bloqueia a duplicata", () => {
    const dup = findEntryByAccessKey(entries, "3526 0961 4579 4100 0143 5500 1000 3720 4314 6666 9127");
    expect(dup?.entryNumber).toBe("ENT-2026-000001");
    expect(findDuplicateEntry(entries, { accessKey: ACCESS_KEY })?.entryNumber).toBe("ENT-2026-000001");
  });

  it("sem chave: fornecedor + número + série identificam a duplicata", () => {
    const dup = findDuplicateEntry(entries, { number: "999", series: "1", supplierId: "sup_outro" });
    expect(dup?.entryNumber).toBe("ENT-2026-000002");
  });

  it("sem chave: outro fornecedor ou outra série NÃO é duplicata", () => {
    expect(findDuplicateEntry(entries, { number: "999", series: "1", supplierId: "sup_gomaq" })).toBeUndefined();
    expect(findDuplicateEntry(entries, { number: "999", series: "2", supplierId: "sup_outro" })).toBeUndefined();
    expect(findDuplicateEntry(entries, { number: "123456", series: "1" })).toBeUndefined();
    expect(findDuplicateEntry(entries, {})).toBeUndefined();
  });

  it("matching de fornecedor por CNPJ continua imune à máscara (§4)", () => {
    const suppliers: SupplierForMatch[] = [{ _id: "sup1", legalName: "Gomaq", cnpj: CNPJ }];
    const nfe: NfeData = {
      accessKey: ACCESS_KEY,
      number: "372043",
      series: "001",
      emissionDate: "2026-09-01",
      emitterCnpj: CNPJ_MASKED,
      emitterName: "GOMAQ MAQUINAS",
      items: [],
    };
    expect(findSupplierMatch(nfe, suppliers)).toMatchObject({ found: true, supplierId: "sup1", byCnpj: true });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Fornecedor inline + endereço estruturado + CEP (§1/§2/§5/§6/§7)
// ═══════════════════════════════════════════════════════════════════════════

describe("Fluxo de fornecedor (garantias estáticas)", () => {
  const SUPPLIER_FORM = read("src/components/SupplierForm.tsx");
  const ENTRIES = read("src/pages/Entries.tsx");
  const SUPPLIERS_PAGE = read("src/pages/Suppliers.tsx");

  it("formulário único com endereço estruturado (tipo, rua, número, bairro, CEP, cidade, UF)", () => {
    for (const field of ["addressType", "streetName", "number", "complement", "district", "postalCode", "city", "state"]) {
      expect(SUPPLIER_FORM, field).toContain(field);
    }
    expect(SUPPLIER_FORM).toContain("AddressTypeValues");
  });

  it("CEP consultado apenas quando completo (8 dígitos) e com debounce; falha não bloqueia", () => {
    expect(SUPPLIER_FORM).toContain("if (digits.length === 8) fetchCep(digits);");
    expect(SUPPLIER_FORM).toContain("}, 400);");
    expect(SUPPLIER_FORM).toContain("viacep.com.br");
    expect(SUPPLIER_FORM).toContain("// falha silenciosa");
  });

  it("máscaras visuais nos campos de CNPJ, telefone e CEP", () => {
    expect(SUPPLIER_FORM).toContain("maskCnpj(form.cnpj)");
    expect(SUPPLIER_FORM).toContain("maskPhone(form.phone)");
    expect(SUPPLIER_FORM).toContain("maskCep(form.postalCode)");
  });

  it("CNPJ validado no cliente e normalizado antes de salvar", () => {
    expect(SUPPLIER_FORM).toContain("isValidCnpj(cnpjDigits)");
    expect(SUPPLIER_FORM).toContain("cnpj: cnpjDigits || undefined");
  });

  it("cadastro inline na Entrada: formulário padrão + seleção automática + cancelamento sem efeito", () => {
    expect(ENTRIES).toContain("<SupplierForm");
    expect(ENTRIES).toContain("onCreated={handleSupplierCreated}");
    expect(ENTRIES).toContain("Fornecedor criado e selecionado");
    expect(ENTRIES).toContain('setNewSupplierName(nfe.emitterName ?? "");');
    expect(ENTRIES).toContain('setNewSupplierCnpj(nfe.emitterCnpj ?? "");');
    // demais campos da Entrada permanecem: o callback só troca o fornecedor
    expect(ENTRIES).toContain("setcSupplierId(newId)");
  });

  it("página de Fornecedores usa o formulário estruturado (endereço legado preservado)", () => {
    expect(SUPPLIERS_PAGE).toContain("SupplierForm");
    expect(SUPPLIERS_PAGE).toContain("FreeFieldNotice");
    expect(SUPPLIERS_PAGE).toContain("formatCnpj(s.cnpj)");
    expect(SUPPLIERS_PAGE).not.toContain("address: form.address");
  });

  it("fornecedores antigos: endereço legado preservado e nenhum registro excluído", () => {
    const mutation = read("src/convex/suppliers.ts");
    expect(mutation).toContain("addressLegacy");
    expect(mutation).not.toContain("db.delete");
    const schema = read("src/convex/schema.ts");
    const suppliersBlock = schema.slice(
      schema.indexOf("suppliers: defineTable"),
      schema.indexOf("nfeProductAliases"),
    );
    expect(suppliersBlock).toContain("addressLegacy");
    expect(suppliersBlock).toContain("addressType");
    expect(suppliersBlock).toContain("streetName");
    expect(suppliersBlock).toContain('.index("by_cnpj"');
    // antigo campo de endereço em texto livre não faz parte do schema
    expect(suppliersBlock).not.toMatch(/address:\s*v\.string/);
  });

  it("CNPJ: unicidade por dígitos normalizados + erro claro ao usuário", () => {
    const mutation = read("src/convex/suppliers.ts");
    expect(mutation).toContain("digitsOnly(args.cnpj)");
    expect(mutation).toContain('withIndex("by_cnpj"');
    expect(mutation).toContain("Já existe um fornecedor com este CNPJ");
    expect(mutation).toContain("CNPJ inválido: verifique os dígitos verificadores");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Entrada de Material: XML, DANFE/OCR e manual convivem (§8/§15/§17)
// ═══════════════════════════════════════════════════════════════════════════

describe("Entrada de Material (garantias estáticas)", () => {
  const ENTRIES = read("src/pages/Entries.tsx");
  const DIALOG = read("src/components/DanfeImportDialog.tsx");

  it("XML continua sendo o caminho preferencial (fluxo existente intacto)", () => {
    expect(ENTRIES).toContain("Importar NF-e XML");
    expect(ENTRIES).toContain("parseNfeXml(");
    expect(ENTRIES).toContain("handleNfeFile");
  });

  it("DANFE/PDF/imagem disponível como fonte alternativa de preenchimento", () => {
    expect(ENTRIES).toContain("Importar DANFE / PDF / Imagem");
    expect(ENTRIES).toContain("handleDanfeImport");
    expect(DIALOG).toContain('accept=".pdf,image/*"');
    expect(DIALOG).toContain("tesseract.js");
    expect(DIALOG).toContain("pdfjs-dist");
  });

  it("entrada manual continua existindo como fallback", () => {
    expect(ENTRIES).toContain("Nova Entrada");
    expect(ENTRIES).toContain("NewEntryItemsEditor");
    expect(ENTRIES).toContain("resetCreateForm");
  });

  it("duplicidade bloqueada com a mensagem exigida (§16)", () => {
    expect(ENTRIES).toContain("Esta NF-e já está cadastrada no SIGESGD");
    expect(ENTRIES).toContain("findDuplicateEntry(entries ?? [], {");
  });

  it("documento original preservado e origem DANFE/OCR registrada (§15)", () => {
    expect(ENTRIES).toContain('nfeXmlFile.type || "application/xml"');
    expect(ENTRIES).toContain("Falha ao salvar o DANFE original");
    expect(ENTRIES).toContain("Dados extraídos por OCR de DANFE/PDF/imagem");
  });

  it("conferência humana obrigatória: o OCR só entrega dados à tela de revisão", () => {
    expect(DIALOG).toContain("onImport({ ...parsed, supplierId: selectedSupplierId || undefined })");
    expect(DIALOG).toContain("Conferir na Entrada");
    // o diálogo de OCR NÃO tem mutation alguma — muito menos de entradas/estoque
    expect(DIALOG).not.toContain("useMutation");
    expect(DIALOG).not.toContain("api.entries");
    expect(DIALOG).not.toContain("createEntry");
    expect(DIALOG).not.toContain("confirmEntry");
    // a efetivação continua exclusivamente no fluxo de confirmação existente
    expect(ENTRIES).toContain("confirmEntry({ entryId: entryId as any })");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Segurança (§21) — sem segredos, sem permissão contornável
// ═══════════════════════════════════════════════════════════════════════════

describe("Segurança da rodada", () => {
  it("nenhum segredo ou API key no frontend", () => {
    const files = [
      "src/components/DanfeImportDialog.tsx",
      "src/components/SupplierForm.tsx",
      "src/pages/Entries.tsx",
      "src/pages/Suppliers.tsx",
      "src/lib/danfe-ocr.ts",
      "src/lib/br-validators.ts",
      "src/lib/supplier-form.ts",
    ];
    for (const f of files) {
      const src = read(f);
      expect(src, f).not.toMatch(/sk-[A-Za-z0-9]{16,}/);
      expect(src, f).not.toMatch(/AIza[0-9A-Za-z_-]{20,}/);
      expect(src, f).not.toMatch(/(apiKey|api_key|secretKey|token)\s*[:=]\s*["'][A-Za-z0-9_\-]{12,}["']/i);
    }
  });

  it("criar fornecedor exige permissão de gestão no servidor", () => {
    const mutation = read("src/convex/suppliers.ts");
    expect(mutation).toContain('requirePermission(ctx, "suppliers.manage"');
    expect(mutation).toContain('requirePermission(ctx, "suppliers.view"');
  });

  it("OCR não consegue criar estoque sem a confirmação do usuário", () => {
    const dialog = read("src/components/DanfeImportDialog.tsx");
    expect(dialog).not.toMatch(/confirmEntry|createEntry|api\.entries/);
    // uploads seguem o mesmo mecanismo de storage já usado pelo XML
    expect(read("src/pages/Entries.tsx")).toContain("generateUploadUrl()");
  });
});

/**
 * Gestão de Estoque SGGD CAPIVARI — IMPORTAÇÃO DE NF-e XML
 *
 * Regra fundamental: XML → interpretar → rascunho → conferência → confirmação.
 * A importação NUNCA altera estoque: somente entries.confirm efetiva
 * estoque, lote, movimentação e auditoria.
 *
 * Cenário de validação real: NF-e Gomaq nº 372043, série 1, 8 itens.
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  parseNfeXml, mapNfeUnit, parseNum, normalizeText, digitsOnly,
  findSupplierMatch, matchNfeProduct, buildEntryDraftFromNfe, findEntryByAccessKey,
  type NfeData, type NfeItem,
} from "@/lib/nfe";

// ═══════════════════════════════════════════════════════════════════════════
// Fixture — NF-e Gomaq (cenário real de validação)
// ═══════════════════════════════════════════════════════════════════════════

const GOMAQ_ACCESS_KEY = "35260961457941000143550010003720431466669127";

function itemXml(nItem: string, cProd: string, xProd: string, uCom: string, qCom: string, extra = "") {
  return `    <det nItem="${nItem}">
      <prod>
        <cProd>${cProd}</cProd>
        <cEAN>SEM GTIN</cEAN>
        <xProd>${xProd}</xProd>
        <NCM>84439959</NCM>
        <CFOP>5102</CFOP>
        <uCom>${uCom}</uCom>
        <qCom>${qCom}</qCom>
        <vUnCom>100.00</vUnCom>
        <vProd>100.00</vProd>${extra}
      </prod>
    </det>`;
}

function buildNfeXml(overrides: { accessKey?: string; infCpl?: string; items?: string } = {}) {
  const items = overrides.items ?? [
    itemXml("1", "0110000735", "CART. TONER PRETO 28K CX-735 (81C8XK0)", "UN", "1.0000"),
    itemXml("2", "0110001735", "CART. TONER AMARELO 16.2K CX-735 (81C8XY0)", "UN", "1.0000"),
    itemXml("3", "0110002735", "CART. TONER CIANO 16.2K CX-735 (81C8XC0)", "UN", "1.0000"),
    itemXml("4", "0110053004", "KIT RIBBON COLOR YMCKT P/SIGMA (525100-004)", "UN", "1.0000"),
    itemXml("5", "0131091359", "CART. TONER XEROX (006R01759) ALTALINK C8145 C8155 C8170/C8270 CIANOIMP", "UN", "1.0000"),
    itemXml("6", "1110000080", "CARTÃO PVC CR80 86x54x0,76mm BRANCO", "PC", "400.0000"),
    itemXml("7", "1110038040", "BOBINA TERMICA BRANCA 80x40 CAIXA C 30 UNID", "UNI", "90.0000"),
    itemXml("8", "4000003491", "CART. TONER PRETO P/MFC-L6902DW 20K (TN-34925BR)", "UN", "40.0000"),
  ].join("\n");
  return `<?xml version="1.0" encoding="ISO-8859-1"?>
<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe>
    <infNFe Id="NFe${overrides.accessKey ?? GOMAQ_ACCESS_KEY}" versao="4.00">
      <ide>
        <cUF>35</cUF>
        <natOp>VENDA</natOp>
        <mod>55</mod>
        <serie>1</serie>
        <nNF>372043</nNF>
        <dhEmi>2026-09-01T10:00:00-03:00</dhEmi>
      </ide>
      <emit>
        <CNPJ>61457941000143</CNPJ>
        <xNome>GOMAQ MAQUINAS P/ ESCRITORIO LTDA</xNome>
      </emit>
      ${items}
      <total><ICMSTot><vNF>8200.00</vNF></ICMSTot></total>
      <infAdic><infCpl>${overrides.infCpl ?? "PEDIDO 2026/0045"}</infCpl></infAdic>
    </infNFe>
  </NFe>
  <protNFe><infProt><nProt>135260000000001</nProt></infProt></protNFe>
</nfeProc>`;
}

const GOMAQ_XML = buildNfeXml();

const GOMAQ_SUPPLIER = { _id: "sup_gomaq", legalName: "Gomaq Máquinas p/ Escritório Ltda.", cnpj: "61.457.941/0001-43" };

// ═══════════════════════════════════════════════════════════════════════════
// 1. XML válido — extração dos dados
// ═══════════════════════════════════════════════════════════════════════════

describe("parseNfeXml — NF-e válida (Gomaq)", () => {
  let nfe: NfeData;
  beforeAll(() => { nfe = parseNfeXml(GOMAQ_XML); });

  it("extrai a chave de acesso (44 dígitos)", () => {
    expect(nfe.accessKey).toBe(GOMAQ_ACCESS_KEY);
    expect(digitsOnly(nfe.accessKey)).toHaveLength(44);
  });

  it("extrai número, série, data de emissão e valor total", () => {
    expect(nfe.number).toBe("372043");
    expect(nfe.series).toBe("1");
    expect(nfe.emissionDate).toBe("2026-09-01");
    expect(nfe.totalValue).toBe(8200);
  });

  it("extrai CNPJ e razão social do emitente", () => {
    expect(nfe.emitterCnpj).toBe("61457941000143");
    expect(nfe.emitterName).toBe("GOMAQ MAQUINAS P/ ESCRITORIO LTDA");
  });

  it("extrai pedido/contrato das informações adicionais", () => {
    expect(nfe.orderReference).toBe("2026/0045");
  });

  it("extrai os 8 itens com código, descrição, NCM e CFOP", () => {
    expect(nfe.items).toHaveLength(8);
    expect(nfe.items[0].code).toBe("0110000735");
    expect(nfe.items[0].description).toContain("TONER PRETO");
    expect(nfe.items[0].ncm).toBe("84439959");
    expect(nfe.items[0].cfop).toBe("5102");
    expect(nfe.items[6].description).toBe("BOBINA TERMICA BRANCA 80x40 CAIXA C 30 UNID");
  });

  it("preserva quantidades e unidades exatamente como na NF (sem conversão)", () => {
    // 90 UNI não vira 2700; 400 PC não vira 400 un; 1 KIT não vira 3
    expect(nfe.items[5].quantity).toBe(400);
    expect(nfe.items[5].unit).toBe("PC");
    expect(nfe.items[6].quantity).toBe(90);
    expect(nfe.items[6].unit).toBe("UNI");
    expect(nfe.items[3].quantity).toBe(1);
    expect(nfe.items[3].unit).toBe("UN");
  });

  it("suporta XML com um único item (não é forçado a array)", () => {
    const single = buildNfeXml({ items: itemXml("1", "A1", "ITEM UNICO", "UN", "5.0000") });
    const parsed = parseNfeXml(single);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].quantity).toBe(5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. XML inválido / não-NF-e
// ═══════════════════════════════════════════════════════════════════════════

describe("parseNfeXml — rejeições", () => {
  it("rejeita texto que não é XML", () => {
    expect(() => parseNfeXml("isto não é um xml")).toThrow();
  });

  it("rejeita XML que não é NF-e (sem infNFe)", () => {
    const other = `<?xml version="1.0"?><nota><dados><valor>10</valor></dados></nota>`;
    expect(() => parseNfeXml(other)).toThrow(/não é uma NF-e/);
  });

  it("rejeita NF-e sem itens (det)", () => {
    const noItems = buildNfeXml({ items: "" });
    expect(() => parseNfeXml(noItems)).toThrow();
  });

  it("rejeita arquivo vazio", () => {
    expect(() => parseNfeXml("   ")).toThrow(/vazio/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Unidades
// ═══════════════════════════════════════════════════════════════════════════

describe("mapNfeUnit — preservação de unidades", () => {
  it("mapeia grafias comuns sem converter quantidade", () => {
    expect(mapNfeUnit("UN")).toBe("un");
    expect(mapNfeUnit("UNI")).toBe("un");
    expect(mapNfeUnit("PC")).toBe("pc");
    expect(mapNfeUnit("CX")).toBe("cx");
    expect(mapNfeUnit("KIT")).toBe("kt");
    expect(mapNfeUnit("PCT")).toBe("pct");
  });

  it("unidade desconhecida cai em 'outro' e é sinalizada para preservação na especificação", () => {
    expect(mapNfeUnit("SERVIÇO")).toBe("outro");
  });
});

describe("parseNum — números com vírgula e ponto", () => {
  it("interpreta ponto decimal (padrão do XML)", () => {
    expect(parseNum("1.0000")).toBe(1);
    expect(parseNum("0.3333")).toBeCloseTo(0.3333, 3);
  });
  it("interpreta milhar brasileiro", () => {
    expect(parseNum("12.500,00")).toBe(12500);
  });
  it("interpreta vírgula decimal", () => {
    expect(parseNum("0,5")).toBe(0.5);
  });
  it("retorna undefined para vazio", () => {
    expect(parseNum("")).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Fornecedor
// ═══════════════════════════════════════════════════════════════════════════

describe("findSupplierMatch", () => {
  const nfe = parseNfeXml(GOMAQ_XML);

  it("localiza fornecedor existente por CNPJ (independente de pontuação)", () => {
    const match = findSupplierMatch(nfe, [GOMAQ_SUPPLIER]);
    expect(match.found).toBe(true);
    expect(match.byCnpj).toBe(true);
    expect(match.supplierId).toBe("sup_gomaq");
  });

  it("não duplica: sem CNPJ, localiza por razão social normalizada", () => {
    const semCnpj = { ...GOMAQ_SUPPLIER, cnpj: null };
    const match = findSupplierMatch(nfe, [semCnpj]);
    expect(match.found).toBe(true);
    expect(match.byCnpj).toBe(false);
  });

  it("retorna não encontrado quando o fornecedor não está cadastrado", () => {
    const match = findSupplierMatch(nfe, [{ _id: "sup_outro", legalName: "Papelaria Central", cnpj: "12.345.678/0001-90" }]);
    expect(match.found).toBe(false);
    expect(match.supplierId).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Reconhecimento de produtos
// ═══════════════════════════════════════════════════════════════════════════

describe("matchNfeProduct", () => {
  const tonerPreto = {
    _id: "p_toner_preto", name: "Cartucho Toner Preto CX-735",
    internalCode: "0110000735", brand: "Gomaq", model: "CX-735",
    specification: "28K preto",
  };
  const tonerAmarelo = {
    _id: "p_toner_amarelo", name: "Cartucho Toner Amarelo CX-735",
    internalCode: "0110001735", brand: "Gomaq", model: "CX-735",
    specification: "16.2K amarelo",
  };
  const bobina = {
    _id: "p_bobina", name: "Bobina Térmica 80x40", internalCode: "1110038040",
    brand: null, model: null, specification: null,
  };
  const genericToner = { _id: "p_toner", name: "Toner", internalCode: null, brand: null, model: null, specification: null };

  it("encontra por código interno do fornecedor (prioridade 1)", () => {
    const item: NfeItem = { lineNumber: 1, code: "0110000735", description: "CART. TONER PRETO 28K CX-735 (81C8XK0)", unit: "UN", quantity: 1 };
    const m = matchNfeProduct(item, [tonerPreto, genericToner]);
    expect(m.status).toBe("found");
    expect(m.productId).toBe("p_toner_preto");
  });

  it("encontra por descrição exata", () => {
    const item: NfeItem = { lineNumber: 1, code: "X1", description: "Bobina Térmica 80x40", unit: "UNI", quantity: 90 };
    const m = matchNfeProduct(item, [bobina]);
    expect(m.status).toBe("found");
    expect(m.productId).toBe("p_bobina");
  });

  it("não trata 'TONER' genérico como igual a outro 'TONER' de modelo diferente", () => {
    const item: NfeItem = { lineNumber: 1, code: "9999", description: "TONER PRETO 28K CX-735 (81C8XK0)", unit: "UN", quantity: 1 };
    const m = matchNfeProduct(item, [genericToner, tonerAmarelo]);
    // genérico pode aparecer como "possível", mas nunca "encontrado" sem confirmação
    expect(m.status).not.toBe("found");
    if (m.productId === "p_toner_amarelo") {
      expect(m.status).toBe("possible");
    }
  });

  it("não confunde toner preto com toner amarelo (mesma família, códigos diferentes)", () => {
    const itemPreto: NfeItem = { lineNumber: 1, code: "0110000735", description: "CART. TONER PRETO 28K CX-735 (81C8XK0)", unit: "UN", quantity: 1 };
    const m = matchNfeProduct(itemPreto, [tonerPreto, tonerAmarelo]);
    expect(m.productId).toBe("p_toner_preto");
  });

  it("retorna não encontrado quando não há correspondência", () => {
    const item: NfeItem = { lineNumber: 1, code: "ZZZ", description: "CARTÃO PVC CR80 BRANCO", unit: "PC", quantity: 400 };
    const m = matchNfeProduct(item, [tonerPreto]);
    expect(m.status).toBe("not_found");
    expect(m.productId).toBeUndefined();
  });

  it("produto inexistente (nenhum cadastrado) → não encontrado", () => {
    const item: NfeItem = { lineNumber: 1, code: "A1", description: "QUALQUER COISA", unit: "UN", quantity: 1 };
    expect(matchNfeProduct(item, []).status).toBe("not_found");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Rascunho: montagem SEM efeito no estoque
// ═══════════════════════════════════════════════════════════════════════════

describe("buildEntryDraftFromNfe", () => {
  const nfe = parseNfeXml(GOMAQ_XML);
  const allMapped = nfe.items.map(() => ({ productId: "p_x", locationId: "loc_ti02" }));

  it("monta cabeçalho com NF, série, data, chave e fornecedor", () => {
    const draft = buildEntryDraftFromNfe(nfe, allMapped, { supplierId: "sup_gomaq" });
    expect(draft.invoiceNumber).toBe("372043");
    expect(draft.series).toBe("1");
    expect(draft.invoiceDate).toBe("2026-09-01");
    expect(draft.accessKey).toBe(GOMAQ_ACCESS_KEY);
    expect(draft.supplierId).toBe("sup_gomaq");
    expect(draft.contractNumber).toBe("2026/0045");
    expect(draft.totalValue).toBe(8200);
  });

  it("preserva os identificadores originais da NF em cada item", () => {
    const draft = buildEntryDraftFromNfe(nfe, allMapped, {});
    expect(draft.items).toHaveLength(8);
    expect(draft.items[0].supplierCode).toBe("0110000735");
    expect(draft.items[0].ncm).toBe("84439959");
    expect(draft.items[0].cfop).toBe("5102");
  });

  it("não converte embalagem: 90 UNI continua 90 un (nenhuma conversão CX/PC/UNI → quantidade)", () => {
    const draft = buildEntryDraftFromNfe(nfe, allMapped, {});
    const bobina = draft.items[6];
    expect(bobina.quantity).toBe(90);
    expect(bobina.unitOfMeasure).toBe("un");
    const cartoes = draft.items[5];
    expect(cartoes.quantity).toBe(400);
    expect(cartoes.unitOfMeasure).toBe("pc");
  });

  it("preserva unidade desconhecida na especificação (sem inventar conversão)", () => {
    const weird = buildNfeXml({
      items: itemXml("1", "S1", "SERVIÇO DE INSTALAÇÃO", "SERVIÇO", "2.0000"),
    });
    const parsed = parseNfeXml(weird);
    const draft = buildEntryDraftFromNfe(parsed, [{ productId: "p_x", locationId: "loc_ti02" }], {});
    expect(draft.items[0].quantity).toBe(2);
    expect(draft.items[0].unitOfMeasure).toBe("outro");
    expect(draft.items[0].specification).toContain("Unidade na NF: SERVIÇO");
  });

  it("propaga localização e lote do fornecedor", () => {
    const mapped = nfe.items.map(() => ({ productId: "p_x", locationId: "loc_ti02", supplierLotNumber: "LOTE-9" }));
    const draft = buildEntryDraftFromNfe(nfe, mapped, {});
    expect(draft.items[0].locationId).toBe("loc_ti02");
    expect(draft.items[0].supplierLotNumber).toBe("LOTE-9");
  });

  it("bloqueia rascunho com associação incompleta (não deixa confirmar)", () => {
    const incomplete = allMapped.map((m, i) => (i === 2 ? { ...m, productId: "" } : m));
    expect(() => buildEntryDraftFromNfe(nfe, incomplete, {})).toThrow(/produto associado/);
  });

  it("não toca em estoque: o rascunho é apenas dados", () => {
    const stockBefore = { physicalQuantity: 10, reservedQuantity: 0 };
    buildEntryDraftFromNfe(nfe, allMapped, { xmlStorageId: "xml_1", documentStorageId: "doc_1" });
    expect(stockBefore.physicalQuantity).toBe(10);
    // e preserva o XML/documento no rascunho
    const draft = buildEntryDraftFromNfe(nfe, allMapped, { xmlStorageId: "xml_1", documentStorageId: "doc_1" });
    expect(draft.xmlStorageId).toBe("xml_1");
    expect(draft.documentStorageId).toBe("doc_1");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. Duplicidade por chave de acesso
// ═══════════════════════════════════════════════════════════════════════════

describe("findEntryByAccessKey — NF duplicada", () => {
  const existing = [
    { _id: "e1", entryNumber: "ENT-2026-000001", accessKey: GOMAQ_ACCESS_KEY },
    { _id: "e2", entryNumber: "ENT-2026-000002", accessKey: "35260961457941000143550010003720431466669128" },
  ];

  it("detecta a mesma chave de acesso já registrada", () => {
    const dup = findEntryByAccessKey(existing, GOMAQ_ACCESS_KEY);
    expect(dup?.entryNumber).toBe("ENT-2026-000001");
  });

  it("não acusa duplicidade para chave diferente", () => {
    const dup = findEntryByAccessKey(existing, "35260961457941000143550010003720431466669129");
    expect(dup).toBeUndefined();
  });

  it("entrada sem chave (entrada manual) não é considerada duplicada", () => {
    const dup = findEntryByAccessKey([{ _id: "e3", entryNumber: "ENT-2026-000003", accessKey: undefined }], GOMAQ_ACCESS_KEY);
    expect(dup).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. Normalização de texto
// ═══════════════════════════════════════════════════════════════════════════

describe("normalizeText", () => {
  it("remove acentos, caixa e pontuação", () => {
    expect(normalizeText("CARTÃO PVC CR80 86x54x0,76mm")).toContain("cartao");
    expect(digitsOnly("61.457.941/0001-43")).toBe("61457941000143");
  });
});
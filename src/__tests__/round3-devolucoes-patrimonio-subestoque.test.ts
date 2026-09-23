/**
 * SIGESGD CAPIVARI — RODADA 3
 * DEVOLUÇÕES · PATRIMÔNIO · SUBESTOQUES · TRANSFERÊNCIAS · NF-e (destino)
 *
 * Estes testes exercitam as REGRAS PURAS implementadas em:
 *   src/lib/returns-rules.ts    → devolução vinculada a saída real
 *   src/lib/material-types.ts   → consumo × permanente + unidades patrimoniais
 *   src/lib/stock-areas.ts      → área/subestoque independente de fornecedor
 *   src/lib/transfer-rules.ts   → transferência (origem, destino, lote)
 *   src/lib/nfe.ts              → destino da NF-e não é definido pelo fornecedor
 *
 * Nenhum teste escreve no banco: nada de carga inicial, nenhuma confirmação da
 * NF-e 372043, nenhuma devolução/transferência real.
 */
import { describe, it, expect } from "vitest";

import {
  RETURN_CONDITION_VALUES,
  RETURN_CONDITION_LABELS,
  returnedQuantityForExit,
  returnableQuantity,
  validateReturnQuantity,
  applyReturnToStock,
  applyReturnToLocation,
  buildReturnAuditDetail,
  formatExitLabel,
} from "@/lib/returns-rules";

import {
  MATERIAL_TYPE_VALUES,
  MATERIAL_TYPE_LABELS,
  isPermanent,
  validateEntryUnits,
  unitsSectionLabel,
} from "@/lib/material-types";

import {
  NO_AREA_LABEL,
  IMPRESSORAS_GOMAQ_AREA,
  resolveStockAreaChoice,
  suggestAreaByCategory,
} from "@/lib/stock-areas";

import { planTransfer } from "@/lib/transfer-rules";

import {
  parseNfeXml,
  buildEntryDraftFromNfe,
  findEntryByAccessKey,
  findSupplierMatch,
} from "@/lib/nfe";

// ═══════════════════════════════════════════════════════════════════════════
// 1. DEVOLUÇÃO vinculada a uma SAÍDA real
// ═══════════════════════════════════════════════════════════════════════════

const EXIT = {
  _id: "exit_sai_2026_000001",
  productId: "prod_cooler_intel",
  requestId: "req_os_1001",
  productName: "Cooler para processador Intel",
  exitQuantity: 5,
};

describe("Devolução — saldo disponível da saída original", () => {
  it("saída de 5, nada devolvido → 5 disponíveis para devolver", () => {
    expect(returnableQuantity(EXIT.exitQuantity, 0)).toBe(5);
    expect(
      validateReturnQuantity({ exitQuantity: 5, alreadyReturned: 0, requested: 5 })
    ).toBeNull();
  });

  it("devolver 2 → disponível passa a 3", () => {
    const returns = [
      { exitMovementId: EXIT._id, productId: EXIT.productId, quantity: 2 },
    ];
    const returned = returnedQuantityForExit(returns, EXIT);
    expect(returned).toBe(2);
    expect(returnableQuantity(EXIT.exitQuantity, returned)).toBe(3);
  });

  it("impede devolver 4 quando só restam 3", () => {
    const error = validateReturnQuantity({
      exitQuantity: 5,
      alreadyReturned: 2,
      requested: 4,
    });
    expect(error).toBeTruthy();
    expect(error!).toContain("excede o disponível");
  });

  it("permite a segunda devolução de 3 e fecha a saída (5 devolvido)", () => {
    const first = { exitMovementId: EXIT._id, productId: EXIT.productId, quantity: 2 };
    const returned1 = returnedQuantityForExit([first], EXIT);
    expect(
      validateReturnQuantity({ exitQuantity: 5, alreadyReturned: returned1, requested: 3 })
    ).toBeNull();

    const second = { exitMovementId: EXIT._id, productId: EXIT.productId, quantity: 3 };
    const returned2 = returnedQuantityForExit([first, second], EXIT);
    expect(returned2).toBe(5);
    expect(returnableQuantity(5, returned2)).toBe(0);
    expect(
      validateReturnQuantity({ exitQuantity: 5, alreadyReturned: returned2, requested: 1 })
    ).toBeTruthy();
  });

  it("rejeita quantidade zero, negativa ou não numérica", () => {
    for (const requested of [0, -1, NaN]) {
      expect(
        validateReturnQuantity({ exitQuantity: 5, alreadyReturned: 0, requested })
      ).toContain("maior que zero");
    }
  });

  it("não mistura devoluções de OUTRAS saídas", () => {
    const otherExit = { ...EXIT, _id: "exit_sai_2026_000002" };
    const returns = [
      { exitMovementId: otherExit._id, productId: EXIT.productId, quantity: 4 },
    ];
    expect(returnedQuantityForExit(returns, EXIT)).toBe(0);
    expect(returnedQuantityForExit(returns, otherExit)).toBe(4);
  });

  it("considera devoluções legadas (sem exitMovementId) vinculadas pela solicitação", () => {
    const legacy = [
      { exitMovementId: null, requestId: EXIT.requestId, productId: EXIT.productId, quantity: 1 },
    ];
    expect(returnedQuantityForExit(legacy, EXIT)).toBe(1);
  });

  it("recompõe o estoque físico e o saldo do local", () => {
    expect(applyReturnToStock(3, 2)).toBe(5);
    expect(applyReturnToLocation(0, 2)).toBe(2);
    // nunca deixa saldo negativo por devolução inválida
    expect(applyReturnToStock(0, -5)).toBe(0);
    expect(applyReturnToLocation(4, -1)).toBe(4);
  });

  it("registra auditoria e rótulo da saída original", () => {
    const detail = buildReturnAuditDetail({
      quantity: 2,
      productName: EXIT.productName,
      exitLabel: "SAI-2026-000001",
      condition: "unused",
      reason: "Material não utilizado",
    });
    expect(detail).toContain("Devolução de 2x Cooler para processador Intel");
    expect(detail).toContain("SAI-2026-000001");
    expect(detail).toContain(RETURN_CONDITION_LABELS.unused);
    expect(detail).toContain("Material não utilizado");

    expect(formatExitLabel({ exitNumber: "SAI-2026-000001", timestamp: 0 })).toBe(
      "SAI-2026-000001"
    );
    expect(formatExitLabel({ exitNumber: null, timestamp: 0 })).toBeTruthy();
  });

  it("mantém as condições exigidas pelo fluxo de devolução", () => {
    expect(RETURN_CONDITION_VALUES).toEqual([
      "unused",
      "partially_used",
      "defective",
      "other",
    ]);
    expect(RETURN_CONDITION_LABELS.partially_used).toBe("Utilizado parcialmente");
    expect(RETURN_CONDITION_LABELS.defective).toBe("Com defeito");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. TRANSFERÊNCIA entre áreas/locais
// ═══════════════════════════════════════════════════════════════════════════

describe("Transferência de estoque", () => {
  const base = {
    productName: "Toner AltaLink Ciano",
    quantity: 1,
    fromLocationName: "Armário TI 02",
    toLocationName: IMPRESSORAS_GOMAQ_AREA,
    lotId: "lot_nf_372043",
    lotNumber: "NF 372043",
    reason: "Reorganização de estoque",
  };

  it("reduz a origem e aumenta o destino, preservando o lote", () => {
    const plan = planTransfer({ ...base, fromQuantity: 10, toQuantity: 2 });
    expect(plan.fromQuantityAfter).toBe(9);
    expect(plan.toQuantityAfter).toBe(3);
    expect(plan.keepsLot).toBe(true);
    expect(plan.lotId).toBe("lot_nf_372043");
    expect(plan.movementType).toBe("transfer");
  });

  it("gera a auditoria/movimentação TRANSFERÊNCIA com lote e motivo", () => {
    const plan = planTransfer({ ...base, fromQuantity: 10, toQuantity: 0 });
    expect(plan.auditDetail).toContain("Transferência de 1x Toner AltaLink Ciano");
    expect(plan.auditDetail).toContain(`${base.fromLocationName} → ${base.toLocationName}`);
    expect(plan.auditDetail).toContain("motivo: Reorganização de estoque");
    expect(plan.auditDetail).toContain("lote: NF 372043");
  });

  it("usa motivo padrão quando não informado", () => {
    const plan = planTransfer({
      ...base,
      reason: "",
      fromQuantity: 2,
      toQuantity: 0,
    });
    expect(plan.auditDetail).toContain("motivo: reorganização de estoque");
  });

  it("recusa transferência acima do estoque da origem", () => {
    expect(() =>
      planTransfer({ ...base, quantity: 11, fromQuantity: 10, toQuantity: 0 })
    ).toThrow(/Estoque insuficiente na origem/);
  });

  it("recusa quantidade inválida e origem igual ao destino", () => {
    expect(() => planTransfer({ ...base, quantity: 0, fromQuantity: 5, toQuantity: 0 })).toThrow(
      /maior que zero/
    );
    expect(() =>
      planTransfer({ ...base, fromQuantity: 5, toQuantity: 5, toLocationName: base.fromLocationName })
    ).toThrow(/mesmo local/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. TIPO DE MATERIAL (consumo × permanente) e unidades patrimoniais
// ═══════════════════════════════════════════════════════════════════════════

describe("Tipo de material e patrimônio", () => {
  it("material de consumo NÃO exige patrimônio", () => {
    expect(validateEntryUnits({ materialType: "consumption", quantity: 40, units: [] })).toBeNull();
    expect(isPermanent("consumption")).toBe(false);
    expect(MATERIAL_TYPE_LABELS.consumption).toBe("Material de consumo");
  });

  it("material de consumo NÃO aceita unidades patrimoniais", () => {
    const error = validateEntryUnits({
      materialType: "consumption",
      quantity: 1,
      units: [{ patrimonyNumber: "000123" }],
      productName: "Toner CX735",
    });
    expect(error).toContain("não possui unidades patrimoniais");
  });

  it("material permanente exige uma unidade por unidade recebida", () => {
    expect(isPermanent("permanent")).toBe(true);
    expect(
      validateEntryUnits({
        materialType: "permanent",
        quantity: 2,
        units: [{ patrimonyNumber: "000001" }],
      })
    ).toContain("uma unidade patrimonial por unidade recebida");
  });

  it("material permanente exige número de patrimônio em cada unidade", () => {
    const error = validateEntryUnits({
      materialType: "permanent",
      quantity: 2,
      units: [{ patrimonyNumber: "000001" }, { serialNumber: "SN-9" }],
    });
    expect(error).toContain("precisa do número de patrimônio");
  });

  it("aceita o mesmo produto com vários patrimônios/terminais diferentes", () => {
    const units = [
      { patrimonyNumber: "000001", serialNumber: "SN-A", manufacturer: "Dell", model: "OptiPlex" },
      { patrimonyNumber: "000002", serialNumber: "SN-B", manufacturer: "Dell", model: "OptiPlex" },
    ];
    expect(validateEntryUnits({ materialType: "permanent", quantity: 2, units })).toBeNull();
    expect(unitsSectionLabel(2)).toContain("(2)");
  });

  it("mantém os dois tipos suportados", () => {
    expect(MATERIAL_TYPE_VALUES).toEqual(["consumption", "permanent"]);
    expect(MATERIAL_TYPE_LABELS.permanent).toBe("Material permanente");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. ÁREA / SUBESTOQUE independente de fornecedor e categoria
// ═══════════════════════════════════════════════════════════════════════════

describe("Área/Subestoque", () => {
  it("a área é SEMPRE a escolha do usuário", () => {
    expect(
      resolveStockAreaChoice({
        userSelectedAreaId: "area_impressoras_gomaq",
        supplierId: "supplier_gomaq",
        categoryId: "cat_suprimentos_impressao",
      })
    ).toBe("area_impressoras_gomaq");
  });

  it("fornecedor NÃO define automaticamente a área", () => {
    expect(
      resolveStockAreaChoice({
        userSelectedAreaId: null,
        supplierId: "supplier_gomaq",
        categoryId: "cat_suprimentos_impressao",
      })
    ).toBeNull();
  });

  it("categoria NÃO define sozinha o subestoque", () => {
    expect(
      resolveStockAreaChoice({ userSelectedAreaId: null, categoryId: "cat_suprimentos_impressao" })
    ).toBeNull();
    expect(suggestAreaByCategory("cat_suprimentos_impressao")).toBeNull();
  });

  it("o MESMO produto pode existir em áreas diferentes", () => {
    const tonerId = "prod_toner_cx735_preto";
    const entryA = { productId: tonerId, areaId: resolveStockAreaChoice({ userSelectedAreaId: "area_a" }) };
    const entryB = { productId: tonerId, areaId: resolveStockAreaChoice({ userSelectedAreaId: "area_b" }) };
    expect(entryA.productId).toBe(entryB.productId);
    expect(entryA.areaId).toBe("area_a");
    expect(entryB.areaId).toBe("area_b");
  });

  it("fornecedores diferentes podem entregar na MESMA área", () => {
    const area = IMPRESSORAS_GOMAQ_AREA;
    expect(
      resolveStockAreaChoice({ userSelectedAreaId: "area_impressoras", supplierId: "supplier_gomaq" })
    ).toBe("area_impressoras");
    expect(
      resolveStockAreaChoice({ userSelectedAreaId: "area_impressoras", supplierId: "supplier_outro" })
    ).toBe("area_impressoras");
    expect(area).toBe("Impressoras / Gomaq");
    expect(NO_AREA_LABEL).toBe("Sem área (estoque geral)");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. NF-e — destino, quantidade fiscal e proteção contra duplicação
// ═══════════════════════════════════════════════════════════════════════════

const GOMAQ_ACCESS_KEY = "35260961457941000143550010003720431466669127";

function buildGomaqXml(): string {
  const dets = [
    { code: "0110002735", desc: "CART. TONER CIANO 16.2K CX-735 (81C8XC0)", unit: "UN", qty: "1.0000" },
    { code: "1110000080", desc: "CARTÃO PVC CR80 86x54x0,76mm BRANCO", unit: "PC", qty: "400.0000" },
    { code: "1110038040", desc: "BOBINA TERMICA BRANCA 80x40 CAIXA C 30 UNID", unit: "UNI", qty: "90.0000" },
  ]
    .map(
      (i, idx) => `    <det nItem="${idx + 1}">
      <prod>
        <cProd>${i.code}</cProd>
        <cEAN>SEM GTIN</cEAN>
        <xProd>${i.desc}</xProd>
        <NCM>84439959</NCM>
        <CFOP>5102</CFOP>
        <uCom>${i.unit}</uCom>
        <qCom>${i.qty}</qCom>
        <vUnCom>100.00</vUnCom>
        <vProd>100.00</vProd>
      </prod>
    </det>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="ISO-8859-1"?>
<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe>
    <infNFe Id="NFe${GOMAQ_ACCESS_KEY}" versao="4.00">
      <ide>
        <cUF>35</cUF>
        <natOp>VENDA</natOp>
        <mod>55</mod>
        <serie>1</serie>
        <nNF>372043</nNF>
        <dhEmi>2026-09-01T10:00:00-03:00</dhEmi>
      </ide>
      <emit>
        <CNPJ>61.457.941/0001-43</CNPJ>
        <xNome>GOMAQ MAQUINAS PARA ESCRITORIO LTDA</xNome>
      </emit>
${dets}
      <total><ICMSTot><vNF>49100.00</vNF></ICMSTot></total>
      <infAdic><infCpl>PEDIDO 00826309</infCpl></infAdic>
    </infNFe>
  </NFe>
</nfeProc>`;
}

describe("NF-e — destino conferido pelo usuário", () => {
  const nfe = parseNfeXml(buildGomaqXml());

  it("preserva a quantidade fiscal de cada item", () => {
    expect(nfe.items).toHaveLength(3);
    expect(nfe.items[0].quantity).toBe(1);
    expect(nfe.items[1].quantity).toBe(400);
    expect(nfe.items[2].quantity).toBe(90);
    expect(nfe.number).toBe("372043");
    expect(nfe.emitterCnpj?.replace(/\D/g, "")).toBe("61457941000143");
  });

  it("identifica o fornecedor existente pelo CNPJ (com máscara ou sem)", () => {
    const suppliers = [
      { _id: "sup_renan", legalName: "Renan Raitano", cnpj: "12345678000199" },
      { _id: "sup_gomaq", legalName: "GOMAQ MAQUINAS PARA ESCRITORIO LTDA", cnpj: "61457941000143" },
    ];
    expect(findSupplierMatch(nfe, suppliers)).toMatchObject({
      supplierId: "sup_gomaq",
      found: true,
      byCnpj: true,
    });
  });

  it("o fornecedor identificado NÃO define a área/subestoque", () => {
    expect(
      resolveStockAreaChoice({
        userSelectedAreaId: null,
        supplierId: "sup_gomaq",
        categoryId: "cat_suprimentos_impressao",
      })
    ).toBeNull();
  });

  it("monta o rascunho preservando itens, lote do fornecedor e local escolhido", () => {
    const mapped = nfe.items.map((item, idx) => ({
      productId: `prod_${idx}`,
      locationId: "loc_armario_ti_02",
      supplierLotNumber: "NF 372043",
    }));
    const draft = buildEntryDraftFromNfe(nfe, mapped, {
      supplierId: "sup_gomaq",
      xmlStorageId: "storage_xml",
    });
    expect(draft.items.map((i) => i.quantity)).toEqual([1, 400, 90]);
    expect(draft.items.every((i) => i.locationId === "loc_armario_ti_02")).toBe(true);
    expect(draft.items.every((i) => i.supplierLotNumber === "NF 372043")).toBe(true);
    expect(draft.accessKey).toBe(GOMAQ_ACCESS_KEY);
    expect(draft.invoiceNumber).toBe("372043");
  });

  it("a conferência é completa: item sem produto impede o rascunho (nada parcial)", () => {
    const mapped = nfe.items.map((item, idx) => ({ productId: idx === 1 ? "" : `prod_${idx}` }));
    expect(() => buildEntryDraftFromNfe(nfe, mapped)).toThrow(/produto associado/);
  });

  it("a chave de acesso continua protegendo contra duplicação", () => {
    const entries = [
      { _id: "entry_1", entryNumber: "ENT-2026-000001", accessKey: null },
      { _id: "entry_2", entryNumber: "ENT-2026-000002", accessKey: "35260961457941000143550010003720431466669127" },
    ];
    expect(findEntryByAccessKey(entries, GOMAQ_ACCESS_KEY)?.entryNumber).toBe("ENT-2026-000002");
    // mesma NF com máscara/espaços continua sendo duplicata
    expect(findEntryByAccessKey(entries, "3526 0961 4579 4100 0143 5500 1000 3720 4314 6666 9127")).toBeTruthy();
    // NF diferente não é duplicata
    expect(findEntryByAccessKey(entries, "35260961457941000143550010003720431466669128")).toBeUndefined();
  });
});

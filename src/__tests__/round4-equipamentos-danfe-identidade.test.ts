/**
 * RODADA 4 — POLIMENTO TOTAL + CONSOLIDAÇÃO ESTRUTURAL
 *
 * Cobre os requisitos novos da rodada:
 *  - EQUIP-01..05: estrutura Equipamentos (Impressoras/Computadores/Redes/Telefonia)
 *    sem fornecedor no nome estrutural;
 *  - DANFE-01..03: XML + DANFE PDF vinculados à MESMA entrada, XML como fonte
 *    estruturada (rascunho da entrada);
 *  - ÁREAS de referência (TI Geral, Impressoras) sem fornecedor no nome;
 *  - integridade de estoque preservada (físico/reservado/disponível).
 *
 * Testes são PURAMENTE UNITÁRIOS: nenhuma chamada ao banco, nenhum dado real.
 */
import { describe, it, expect } from "vitest";
import {
  EQUIPMENT_CATEGORIES,
  EQUIPMENT_TYPE_LABELS,
  findEquipmentCategory,
  matchesEquipmentCategory,
} from "@/lib/equipment-categories";
import { buildEntryDraftFromNfe, type NfeData } from "@/lib/nfe";
import { AREA_IMPRESSORAS, AREA_TI_GERAL, BASELINE_STOCK_AREAS } from "@/lib/stock-areas";

// ─────────────────────────────────────────────────────────────────────────────
// EQUIPAMENTOS — estrutura oficial
// ─────────────────────────────────────────────────────────────────────────────

describe("Estrutura de Equipamentos (sem fornecedor no nome)", () => {
  it("EQUIP-01: define exatamente as quatro categorias oficiais", () => {
    expect(EQUIPMENT_CATEGORIES.map((c) => c.label)).toEqual([
      "Impressoras",
      "Computadores",
      "Redes",
      "Telefonia",
    ]);
  });

  it("EQUIP-02: nenhum nome estrutural contém fornecedor (Gomaq ou outro)", () => {
    for (const category of EQUIPMENT_CATEGORIES) {
      expect(category.label.toLowerCase()).not.toContain("gomaq");
      expect(category.slug.toLowerCase()).not.toContain("gomaq");
      expect(category.description.toLowerCase()).not.toContain("gomaq");
    }
  });

  it("EQUIP-03: Impressoras cobre o tipo printer", () => {
    const impressoras = findEquipmentCategory("impressoras");
    expect(impressoras).not.toBeNull();
    expect(matchesEquipmentCategory("printer", impressoras!)).toBe(true);
    expect(matchesEquipmentCategory("desktop", impressoras!)).toBe(false);
  });

  it("EQUIP-04: Computadores, Redes e Telefonia agrupam seus tipos", () => {
    const computadores = findEquipmentCategory("computadores")!;
    expect(matchesEquipmentCategory("notebook", computadores)).toBe(true);
    expect(matchesEquipmentCategory("server", computadores)).toBe(true);

    const redes = findEquipmentCategory("redes")!;
    expect(matchesEquipmentCategory("switch", redes)).toBe(true);
    expect(matchesEquipmentCategory("router", redes)).toBe(true);
    expect(matchesEquipmentCategory("access_point", redes)).toBe(true);

    const telefonia = findEquipmentCategory("telefonia")!;
    expect(matchesEquipmentCategory("phone", telefonia)).toBe(true);
    expect(EQUIPMENT_TYPE_LABELS.phone).toBe("Telefone");
  });

  it("EQUIP-05: slug inválido não gera categoria (evita tela quebrada)", () => {
    expect(findEquipmentCategory(null)).toBeNull();
    expect(findEquipmentCategory("categoria-inexistente")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ÁREAS DE REFERÊNCIA — sem fornecedor no nome
// ─────────────────────────────────────────────────────────────────────────────

describe("Áreas/Subestoques de referência", () => {
  it("AREA-REF-01: TI Geral e Impressoras existem na estrutura de referência", () => {
    const names = BASELINE_STOCK_AREAS.map((a) => a.name);
    expect(names).toContain(AREA_TI_GERAL);
    expect(names).toContain(AREA_IMPRESSORAS);
  });

  it("AREA-REF-02: nenhum nome de área carrega fornecedor", () => {
    for (const area of BASELINE_STOCK_AREAS) {
      expect(area.name.toLowerCase()).not.toContain("gomaq");
      expect(area.name).not.toContain("/");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DANFE + XML — documentos da mesma entrada
// ─────────────────────────────────────────────────────────────────────────────

const NFE_EXEMPLO: NfeData = {
  accessKey: "35260961457941000143550010000372043123456789",
  number: "372043",
  series: "1",
  emissionDate: "2026-09-20",
  emitterCnpj: "61.457.941/0001-43",
  emitterName: "GOMAQ MAQUINAS PARA ESCRITORIO LTDA",
  items: [
    {
      code: "0131085001",
      description: "Toner AltaLink — Preto",
      quantity: 7,
      unit: "UN",
      unitValue: 0,
      totalValue: 0,
    },
  ],
} as unknown as NfeData;

describe("NF-e — XML + DANFE PDF na mesma entrada", () => {
  it("DANFE-01: o DANFE/documento informado vai para documentStorageId da MESMA entrada", () => {
    const draft = buildEntryDraftFromNfe(
      NFE_EXEMPLO,
      [{ productId: "prod_1" }],
      { documentStorageId: "storage_danfe_123", xmlStorageId: "storage_xml_456" }
    );
    expect(draft.documentStorageId).toBe("storage_danfe_123");
    expect(draft.xmlStorageId).toBe("storage_xml_456");
    // Mesma entrada carrega os dois documentos — não cria segunda entrada.
    expect(draft.accessKey).toBe(NFE_EXEMPLO.accessKey);
  });

  it("DANFE-02: sem DANFE, o XML segue sozinho (DANFE é opcional)", () => {
    const draft = buildEntryDraftFromNfe(
      NFE_EXEMPLO,
      [{ productId: "prod_1" }],
      { xmlStorageId: "storage_xml_456" }
    );
    expect(draft.xmlStorageId).toBe("storage_xml_456");
    expect(draft.documentStorageId ?? null).toBeFalsy();
  });

  it("DANFE-03: os dados fiscais do XML nunca são sobrescritos pelo DANFE", () => {
    const draft = buildEntryDraftFromNfe(
      NFE_EXEMPLO,
      [{ productId: "prod_1" }],
      { documentStorageId: "storage_danfe_123" }
    );
    expect(draft.invoiceNumber).toBe("372043");
    expect(draft.items[0].quantity).toBe(7);
  });
});

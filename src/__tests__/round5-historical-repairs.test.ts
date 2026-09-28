/**
 * Gestão de Estoque SGGD — CORREÇÕES HISTÓRICAS (regras puras)
 *
 * Testa as PRÉ-CONDIÇÕES e a IDEMPOTÊNCIA das duas correções de dados
 * autorizadas, bem como o texto de auditoria gerado em cada caso.
 *
 * Estas regras são aplicadas pelas mutations em `src/convex/dataRepairs.ts`.
 * Nenhum teste aqui escreve no banco.
 */
import { describe, it, expect } from "vitest";

import {
  decideAreaRepair,
  decideLotAvailabilityRepair,
  isCoolerLotStateUnchanged,
  buildAreaRepairAuditDetail,
  buildLotAvailabilityAuditDetail,
  COOLER_LOT_INCONSISTENT_AVAILABLE,
  COOLER_LOT_EXPECTED_AVAILABLE,
} from "@/lib/data-repairs";

const AREA_IMPRESSORAS = "q97b7737gv98ajm8qqpmjmzjs18ezb58";
const AREA_TI_GERAL = "q971w9jkmz8rsqr3vsr2as0dps8eyqns";

/** Os 8 lotes reais da NF 372043 (todos criados sem área pelo bug). */
const LOTS_NF_372043 = [
  "n172h5nab411khjjch5mdbxdy18f2v1k", // CX735 Preto
  "n1707jnyahtmc1vrgv9pbm8g1n8f3z08", // CX735 Amarelo
  "n17drm4hmjjgjg2t6d5s7kmbfx8f3jeg", // CX735 Ciano
  "n179gyd557t976j2a3nf1y0jn98f2nzw", // Ribbon SIGMA
  "n17d8s4n6ct1e20gjjnagct7jx8f34eb", // AltaLink Ciano
  "n178nsmp5pjbwn52e8jqq42vn18f2sx3", // Cartão PVC
  "n176cm1d59ehjgabncnmveryd98f3b43", // Papel térmico
  "n17a09daac7max0egvda6sq82h8f2d60", // MFC-L6902DW
];

describe("Correção histórica #1 — área dos 8 lotes da NF 372043", () => {
  it("corrige os 8 lotes que estão sem área", () => {
    const { decision, lotIdsToFix } = decideAreaRepair({
      targetAreaId: AREA_IMPRESSORAS,
      lots: LOTS_NF_372043.map((lotId) => ({ lotId, areaId: null })),
    });
    expect(decision.shouldApply).toBe(true);
    expect(lotIdsToFix).toHaveLength(8);
    expect(lotIdsToFix).toEqual(expect.arrayContaining(LOTS_NF_372043));
  });

  it("trata 'sem área' e 'outra área' como pendentes de correção", () => {
    const { lotIdsToFix } = decideAreaRepair({
      targetAreaId: AREA_IMPRESSORAS,
      lots: [
        { lotId: "l1", areaId: null },
        { lotId: "l2", areaId: AREA_TI_GERAL },
      ],
    });
    expect(lotIdsToFix).toEqual(["l1", "l2"]);
  });

  it("IDEMPOTÊNCIA: com os 8 lotes já corretos, não aplica nada", () => {
    const { decision, lotIdsToFix, alreadyCorrect } = decideAreaRepair({
      targetAreaId: AREA_IMPRESSORAS,
      lots: LOTS_NF_372043.map((lotId) => ({ lotId, areaId: AREA_IMPRESSORAS })),
    });
    expect(decision.shouldApply).toBe(false);
    expect(lotIdsToFix).toHaveLength(0);
    expect(alreadyCorrect).toHaveLength(8);
    expect(decision.reason).toMatch(/já possuem a área/i);
  });

  it("IDEMPOTÊNCIA PARCIAL: reexecutar corrige só o que falta", () => {
    const alreadyFixed = LOTS_NF_372043.slice(0, 3).map((lotId) => ({
      lotId,
      areaId: AREA_IMPRESSORAS,
    }));
    const pending = LOTS_NF_372043.slice(3).map((lotId) => ({ lotId, areaId: null }));

    const { decision, lotIdsToFix, alreadyCorrect } = decideAreaRepair({
      targetAreaId: AREA_IMPRESSORAS,
      lots: [...alreadyFixed, ...pending],
    });
    expect(decision.shouldApply).toBe(true);
    expect(alreadyCorrect).toHaveLength(3);
    expect(lotIdsToFix).toHaveLength(5);
    // Nenhum lote já corrigido é tocado novamente.
    for (const id of lotIdsToFix) expect(alreadyFixed.find((l) => l.lotId === id)).toBeUndefined();
  });

  it("NUNCA altera quantidadeReceived/quantityAvailable ao corrigir a área", () => {
    // A decisão de área só produz lista de IDs; não carrega nem modifica
    // qualquer quantidade. Este teste fixa essa garantia de contrato.
    const { decision } = decideAreaRepair({
      targetAreaId: AREA_IMPRESSORAS,
      lots: [{ lotId: "l1", areaId: null }],
    });
    expect(decision.shouldApply).toBe(true);
    expect(JSON.stringify(decision)).not.toMatch(/quantity/i);
  });

  it("a auditoria registra entrada, NF, área anterior e área nova", () => {
    const detail = buildAreaRepairAuditDetail({
      entryNumber: "ENT-2026-000002",
      invoiceNumber: "372043",
      areaName: "Impressoras",
      lotNumbers: ["LOT-2026-000054", "LOT-2026-000055"],
      fixedCount: 2,
    });
    expect(detail).toContain("ENT-2026-000002");
    expect(detail).toContain("372043");
    expect(detail).toContain("Impressoras");
    expect(detail).toContain("Sem área (estoque geral)");
    expect(detail).toMatch(/stale closure/i);
    expect(detail).toMatch(/LOT-2026-000054/);
  });

  it("a auditoria declara que não houve alteração de quantidade", () => {
    const detail = buildAreaRepairAuditDetail({
      entryNumber: "ENT-2026-000002",
      invoiceNumber: "372043",
      areaName: "Impressoras",
      lotNumbers: ["LOT-2026-000054"],
      fixedCount: 1,
    });
    expect(detail).toMatch(/sem qualquer alteração de quantidade/i);
  });
});

describe("Correção histórica #2 — quantityAvailable do lote do Cooler", () => {
  it("aplica a correção 14 → 15 quando o valor é exatamente 14", () => {
    const decision = decideLotAvailabilityRepair({
      currentAvailable: 14,
      received: 15,
      expectedAvailable: COOLER_LOT_EXPECTED_AVAILABLE,
    });
    expect(decision.shouldApply).toBe(true);
    expect(decision.reason).toContain("14");
    expect(decision.reason).toContain("15");
  });

  it("IDEMPOTÊNCIA: se já está 15, não altera", () => {
    const decision = decideLotAvailabilityRepair({
      currentAvailable: 15,
      received: 15,
      expectedAvailable: COOLER_LOT_EXPECTED_AVAILABLE,
    });
    expect(decision.shouldApply).toBe(false);
    expect(decision.reason).toMatch(/já está/i);
  });

  it("NÃO altera para 16 (nunca incrementa duas vezes)", () => {
    const decision = decideLotAvailabilityRepair({
      currentAvailable: 15,
      received: 15,
      expectedAvailable: COOLER_LOT_EXPECTED_AVAILABLE,
    });
    expect(decision.shouldApply).toBe(false);
    expect(decision.reason).not.toContain("16");
  });

  it("a decisão menciona que quantityReceived permanece inalterado", () => {
    const decision = decideLotAvailabilityRepair({
      currentAvailable: 14,
      received: 15,
      expectedAvailable: 15,
    });
    expect(decision.reason).toMatch(/quantityReceived permanece 15/);
  });

  describe("pré-condição sobre o estado atual", () => {
    it("o valor inconsistente conhecido é 14", () => {
      expect(COOLER_LOT_INCONSISTENT_AVAILABLE).toBe(14);
    });

    it("o valor esperado é 15", () => {
      expect(COOLER_LOT_EXPECTED_AVAILABLE).toBe(15);
    });

    it("reconhece 14 como 'estado inalterado desde o diagnóstico'", () => {
      expect(isCoolerLotStateUnchanged(14)).toBe(true);
    });

    it("NÃO corrige quando o estado mudou inesperadamente", () => {
      // 13, 12, 16 ou qualquer outro valor = banco mudou; não sobrescrever.
      for (const unexpected of [13, 12, 11, 16, 20, 0]) {
        expect(isCoolerLotStateUnchanged(unexpected)).toBe(false);
      }
    });

    it("15 também não é 'estado inalterado' (já foi corrigido antes)", () => {
      expect(isCoolerLotStateUnchanged(15)).toBe(false);
    });
  });

  it("a auditoria cita o antes/depois, o lote, o produto e o motivo", () => {
    const detail = buildLotAvailabilityAuditDetail({
      lotNumber: "LOT-2026-000001",
      productName: "Cooler para processador Intel",
      previousAvailable: 14,
      newAvailable: 15,
      received: 15,
      exitMovementRef: "kx758yrsbatdw2yc4m09ytfapn8en7mn",
      returnMovementRef: "kx70n82skp2ph9wq5d75020wp58ez5ag",
    });
    expect(detail).toContain("LOT-2026-000001");
    expect(detail).toContain("Cooler para processador Intel");
    expect(detail).toContain("14 → 15");
    expect(detail).toMatch(/kx758yrsbatdw2yc4m09ytfapn8en7mn/);
    expect(detail).toMatch(/kx70n82skp2ph9wq5d75020wp58ez5ag/);
  });

  it("a auditoria declara que nenhuma movimentação de estoque foi criada", () => {
    const detail = buildLotAvailabilityAuditDetail({
      lotNumber: "LOT-2026-000001",
      productName: "Cooler para processador Intel",
      previousAvailable: 14,
      newAvailable: 15,
      received: 15,
      exitMovementRef: "saida",
      returnMovementRef: "devolucao",
    });
    expect(detail).toMatch(/nenhuma movimenta/i);
    expect(detail).toMatch(/quantidade física/i);
  });

  it("a auditoria preserva quantityReceived no texto", () => {
    const detail = buildLotAvailabilityAuditDetail({
      lotNumber: "LOT-2026-000001",
      productName: "Cooler",
      previousAvailable: 14,
      newAvailable: 15,
      received: 15,
      exitMovementRef: "s",
      returnMovementRef: "d",
    });
    expect(detail).toContain("quantityReceived permanece 15");
  });
});

describe("As duas correções não alteram o estoque físico global", () => {
  it("a correção de área produz apenas IDs de lote (nenhum saldo)", () => {
    const { lotIdsToFix } = decideAreaRepair({
      targetAreaId: AREA_IMPRESSORAS,
      lots: LOTS_NF_372043.map((lotId) => ({ lotId, areaId: null })),
    });
    for (const id of lotIdsToFix) expect(typeof id).toBe("string");
    expect(lotIdsToFix).toHaveLength(8);
  });

  it("a correção do Cooler só reconcilia o lote (14 → 15), sem tocar em 15 → 16", () => {
    const d = decideLotAvailabilityRepair({
      currentAvailable: 14,
      received: 15,
      expectedAvailable: 15,
    });
    expect(d.shouldApply).toBe(true);
    expect(d.reason).not.toContain("16");
  });
});

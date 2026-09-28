/**
 * Gestão de Estoque SGGD — RODADA DE RASTREABILIDADE HISTÓRICA (regras puras)
 *
 * Testa as PRÉ-CONDIÇÕES, a IDEMPOTÊNCIA e a GARANTIA DE ZERO ALTERAÇÃO DE
 * QUANTIDADES da terceira correção histórica autorizada:
 *
 *   A) entries.areaId de ENT-2026-000002 → Impressoras
 *   B) entryItems.lotId dos 8 itens da NF 372043 → LOT-2026-000054..61
 *   C/D) stockMovements.lotId dos 2 movimentos históricos do Cooler → LOT-2026-000001
 *
 * Estas regras são aplicadas pelas mutations em `src/convex/dataRepairs.ts`.
 * Nenhum teste aqui escreve no banco.
 */
import { describe, it, expect } from "vitest";

import {
  decideEntryAreaRepair,
  decideEntryItemLotLink,
  decideMovementLotLink,
  assertNoQuantityChange,
  buildEntryAreaTraceAuditDetail,
  buildEntryItemLotsTraceAuditDetail,
  buildMovementTraceAuditDetail,
  NF372043_EXPECTED_LOTS,
  TRACEABILITY_ENTRY_NUMBER,
  TRACEABILITY_INVOICE_NUMBER,
} from "@/lib/data-repairs";

const AREA_IMPRESSORAS = "q97b7737gv98ajm8qqpmjmzjs18ezb58";
const COOLER_PRODUCT = "kd765djstdgckchkpk8rgmmntd002gy4";
const COOLER_LOT = "n179kw2gk7p08rw1qjh0tygzmm4k480k";

/* ─── Estado real do banco capturado no baseline desta rodada ──────────────── */

const BASE_ENTRY = {
  entryNumber: "ENT-2026-000002",
  invoiceNumber: "372043",
  supplierLegalName: "GOMAQ MAQUINAS PARA ESCRITORIO LTDA",
  status: "confirmed",
  areaId: null,
};

/** entryItems reais (sem lotId) → lote esperado (produto → lotNumber). */
const BASE_ITEMS = [
  { productId: "kd7fjr7m20vp7p285vn02nqv9h8f3xs4", lotNumber: "LOT-2026-000054", lotId: "n172h5nab411khjjch5mdbxdy18f2v1k", quantity: 1 },
  { productId: "kd7a1824vydkd3jrpqz2vy3q6tga9k4v", lotNumber: "LOT-2026-000055", lotId: "n1707jnyahtmc1vrgv9pbm8g1n8f3z08", quantity: 1 },
  { productId: "kd70ck3e4c396bnsy529k04wkx8f25qh", lotNumber: "LOT-2026-000056", lotId: "n17drm4hmjjgjg2t6d5s7kmbfx8f3jeg", quantity: 1 },
  { productId: "kd75fnwnxdcwyvjejt14wkae718f3xah", lotNumber: "LOT-2026-000057", lotId: "n179gyd557t976j2a3nf1y0jn98f2nzw", quantity: 1 },
  { productId: "kd73hh4taw6qmfkefmdn9aw2x2d4dths", lotNumber: "LOT-2026-000058", lotId: "n17d8s4n6ct1e20gjjnagct7jx8f34eb", quantity: 1 },
  { productId: "kd79tf11zqbdtvg8sr8cq86zbtcbvs3f", lotNumber: "LOT-2026-000059", lotId: "n178nsmp5pjbwn52e8jqq42vn18f2sx3", quantity: 400 },
  { productId: "kd75k6hz4gj7szvar4d44nxnwp9a52qa", lotNumber: "LOT-2026-000060", lotId: "n176cm1d59ehjgabncnmveryd98f3b43", quantity: 90 },
  { productId: "kd7dd58stasmw3rvrsz3c0cn6h8f3vza", lotNumber: "LOT-2026-000061", lotId: "n17a09daac7max0egvda6sq82h8f2d60", quantity: 40 },
];

const ENTRY_ID = "mh72zbyhdnsgnzhytzccc7cm9d8f2yb1";

/* ═══ 1. Correção do areaId da ENTRADA ══════════════════════════════════════ */

describe("correção de rastreabilidade — areaId da ENT-2026-000002", () => {
  it("aplica quando todas as pré-condições são atendidas", () => {
    const d = decideEntryAreaRepair({ entry: BASE_ENTRY, targetAreaId: AREA_IMPRESSORAS });
    expect(d.shouldApply).toBe(true);
    expect(d.reason).toContain("ausente → Impressoras");
  });

  it("recusa se a entrada não for ENT-2026-000002", () => {
    const d = decideEntryAreaRepair({
      entry: { ...BASE_ENTRY, entryNumber: "ENT-2026-000001" },
      targetAreaId: AREA_IMPRESSORAS,
    });
    expect(d.shouldApply).toBe(false);
    expect(d.reason).toContain("ENT-2026-000001");
  });

  it("recusa se a NF não for 372043", () => {
    const d = decideEntryAreaRepair({
      entry: { ...BASE_ENTRY, invoiceNumber: "999999" },
      targetAreaId: AREA_IMPRESSORAS,
    });
    expect(d.shouldApply).toBe(false);
    expect(d.reason).toContain("999999");
  });

  it("recusa se o fornecedor não for Gomaq", () => {
    const d = decideEntryAreaRepair({
      entry: { ...BASE_ENTRY, supplierLegalName: "OUTRO FORNECEDOR LTDA" },
      targetAreaId: AREA_IMPRESSORAS,
    });
    expect(d.shouldApply).toBe(false);
    expect(d.reason).toContain("Gomaq");
  });

  it("recusa se o status não for confirmed", () => {
    const d = decideEntryAreaRepair({
      entry: { ...BASE_ENTRY, status: "draft" },
      targetAreaId: AREA_IMPRESSORAS,
    });
    expect(d.shouldApply).toBe(false);
    expect(d.reason).toContain("confirmed");
  });

  it("é idempotente quando a área já é Impressoras", () => {
    const d = decideEntryAreaRepair({
      entry: { ...BASE_ENTRY, areaId: AREA_IMPRESSORAS },
      targetAreaId: AREA_IMPRESSORAS,
    });
    expect(d.shouldApply).toBe(false);
    expect(d.reason).toContain("idempotente");
  });

  it("aborta se a área mudou para outro valor inesperado", () => {
    const d = decideEntryAreaRepair({
      entry: { ...BASE_ENTRY, areaId: "q97outra-area" },
      targetAreaId: AREA_IMPRESSORAS,
    });
    expect(d.shouldApply).toBe(false);
    expect(d.reason).toContain("inesperadamente");
  });
});

/* ═══ 2. Vínculo dos 8 entryItems → lotes ═══════════════════════════════════ */

describe("correção de rastreabilidade — lotId dos 8 entryItems da NF 372043", () => {
  it("mapeamento obrigatório cobre exatamente os lotes LOT-2026-000054..61", () => {
    expect(NF372043_EXPECTED_LOTS.map((l) => l.lotNumber)).toEqual([
      "LOT-2026-000054",
      "LOT-2026-000055",
      "LOT-2026-000056",
      "LOT-2026-000057",
      "LOT-2026-000058",
      "LOT-2026-000059",
      "LOT-2026-000060",
      "LOT-2026-000061",
    ]);
  });

  it("aplica o vínculo para cada um dos 8 itens no estado do baseline", () => {
    for (const spec of BASE_ITEMS) {
      const { decision, targetLotId } = decideEntryItemLotLink({
        item: {
          entryItemId: "ei-" + spec.productId,
          entryId: ENTRY_ID,
          productId: spec.productId,
          quantity: spec.quantity,
          lotId: null,
        },
        lot: {
          lotId: spec.lotId,
          lotNumber: spec.lotNumber,
          entryId: ENTRY_ID,
          productId: spec.productId,
          quantityReceived: spec.quantity,
        },
        entryId: ENTRY_ID,
      });
      expect(decision.shouldApply, spec.lotNumber).toBe(true);
      expect(targetLotId).toBe(spec.lotId);
      expect(decision.reason).toContain(spec.lotNumber);
    }
  });

  it("recusa quando o produto do entryItem difere do produto do lote", () => {
    const { decision } = decideEntryItemLotLink({
      item: { entryItemId: "x", entryId: ENTRY_ID, productId: "kd7fjr7m20vp7p285vn02nqv9h8f3xs4", quantity: 1, lotId: null },
      lot: { lotId: "lotX", lotNumber: "LOT-2026-000055", entryId: ENTRY_ID, productId: "kd7a1824vydkd3jrpqz2vy3q6tga9k4v", quantityReceived: 1 },
      entryId: ENTRY_ID,
    });
    expect(decision.shouldApply).toBe(false);
    expect(decision.reason).toContain("difere");
  });

  it("recusa quando a quantidade do entryItem difere do lote", () => {
    const { decision } = decideEntryItemLotLink({
      item: { entryItemId: "x", entryId: ENTRY_ID, productId: "kd79tf11zqbdtvg8sr8cq86zbtcbvs3f", quantity: 400, lotId: null },
      lot: { lotId: "lotPvc", lotNumber: "LOT-2026-000059", entryId: ENTRY_ID, productId: "kd79tf11zqbdtvg8sr8cq86zbtcbvs3f", quantityReceived: 399 },
      entryId: ENTRY_ID,
    });
    expect(decision.shouldApply).toBe(false);
    expect(decision.reason).toContain("Quantidade");
  });

  it("recusa quando o lote não pertence à entrada", () => {
    const { decision } = decideEntryItemLotLink({
      item: { entryItemId: "x", entryId: ENTRY_ID, productId: "kd7fjr7m20vp7p285vn02nqv9h8f3xs4", quantity: 1, lotId: null },
      lot: { lotId: "lotY", lotNumber: "LOT-2026-000001", entryId: "mh7394fjjzd5zymgqxegpc1h4r8swr18", productId: "kd7fjr7m20vp7p285vn02nqv9h8f3xs4", quantityReceived: 1 },
      entryId: ENTRY_ID,
    });
    expect(decision.shouldApply).toBe(false);
    expect(decision.reason).toContain("não pertence");
  });

  it("é idempotente quando o lotId já é o lote esperado", () => {
    const spec = BASE_ITEMS[0];
    const { decision, targetLotId } = decideEntryItemLotLink({
      item: { entryItemId: "x", entryId: ENTRY_ID, productId: spec.productId, quantity: spec.quantity, lotId: spec.lotId },
      lot: { lotId: spec.lotId, lotNumber: spec.lotNumber, entryId: ENTRY_ID, productId: spec.productId, quantityReceived: spec.quantity },
      entryId: ENTRY_ID,
    });
    expect(decision.shouldApply).toBe(false);
    expect(targetLotId).toBe(spec.lotId);
    expect(decision.reason).toContain("idempotente");
  });

  it("aborta quando o entryItem já aponta para outro lote", () => {
    const spec = BASE_ITEMS[0];
    const { decision } = decideEntryItemLotLink({
      item: { entryItemId: "x", entryId: ENTRY_ID, productId: spec.productId, quantity: spec.quantity, lotId: "outro-lote" },
      lot: { lotId: spec.lotId, lotNumber: spec.lotNumber, entryId: ENTRY_ID, productId: spec.productId, quantityReceived: spec.quantity },
      entryId: ENTRY_ID,
    });
    expect(decision.shouldApply).toBe(false);
    expect(decision.reason).toContain("interrompida");
  });
});

/* ═══ 3. Vínculo dos 2 movimentos históricos do Cooler ══════════════════════ */

describe("correção de rastreabilidade — lotId dos movimentos históricos do Cooler", () => {
  const exit = { movementId: "kx758yrsbatdw2yc4m09ytfapn8en7mn", type: "exit", quantity: 1, productId: COOLER_PRODUCT, lotId: null };
  const ret = { movementId: "kx70n82skp2ph9wq5d75020wp58ez5ag", type: "return", quantity: 1, productId: COOLER_PRODUCT, lotId: null };

  it("aplica o vínculo da SAÍDA (quantidade -1 registrada como 1 consumida)", () => {
    const d = decideMovementLotLink({ movement: exit, coolerProductId: COOLER_PRODUCT, coolerLotId: COOLER_LOT, expectedType: "exit" });
    expect(d.shouldApply).toBe(true);
    expect(d.reason).toContain("LOT-2026-000001");
  });

  it("aplica o vínculo da DEVOLUÇÃO (quantidade +1)", () => {
    const d = decideMovementLotLink({ movement: ret, coolerProductId: COOLER_PRODUCT, coolerLotId: COOLER_LOT, expectedType: "return" });
    expect(d.shouldApply).toBe(true);
    expect(d.reason).toContain("LOT-2026-000001");
  });

  it("recusa movimento de outro produto", () => {
    const d = decideMovementLotLink({
      movement: { ...exit, productId: "outro-produto" },
      coolerProductId: COOLER_PRODUCT,
      coolerLotId: COOLER_LOT,
      expectedType: "exit",
    });
    expect(d.shouldApply).toBe(false);
    expect(d.reason).toContain("Cooler");
  });

  it("recusa tipo divergente (saída esperada, devolução recebida)", () => {
    const d = decideMovementLotLink({ movement: exit, coolerProductId: COOLER_PRODUCT, coolerLotId: COOLER_LOT, expectedType: "return" });
    expect(d.shouldApply).toBe(false);
    expect(d.reason).toContain("esperado");
  });

  it("recusa quantidade diferente de 1", () => {
    const d = decideMovementLotLink({ movement: { ...exit, quantity: 3 }, coolerProductId: COOLER_PRODUCT, coolerLotId: COOLER_LOT, expectedType: "exit" });
    expect(d.shouldApply).toBe(false);
    expect(d.reason).toContain("Quantidade");
  });

  it("é idempotente quando o movimento já aponta para o lote", () => {
    const d = decideMovementLotLink({
      movement: { ...exit, lotId: COOLER_LOT },
      coolerProductId: COOLER_PRODUCT,
      coolerLotId: COOLER_LOT,
      expectedType: "exit",
    });
    expect(d.shouldApply).toBe(false);
    expect(d.reason).toContain("idempotente");
  });

  it("aborta quando o movimento aponta para outro lote", () => {
    const d = decideMovementLotLink({
      movement: { ...exit, lotId: "outro-lote" },
      coolerProductId: COOLER_PRODUCT,
      coolerLotId: COOLER_LOT,
      expectedType: "exit",
    });
    expect(d.shouldApply).toBe(false);
    expect(d.reason).toContain("interrompida");
  });
});

/* ═══ 4. Proteção absoluta: zero alteração de saldo ═════════════════════════ */

const BASE_TOTALS = {
  physical: 3338,
  reserved: 0,
  available: 3338,
  stockByLocation: 3338,
  lotsQuantityReceived: 3338,
  lotsQuantityAvailable: 3338,
};

describe("proteção absoluta — nenhuma quantidade pode mudar", () => {
  it("aprova quando os 6 totais permanecem idênticos", () => {
    const d = assertNoQuantityChange(BASE_TOTALS, { ...BASE_TOTALS });
    expect(d.shouldApply).toBe(true);
    expect(d.reason).toContain("Nenhuma quantidade");
  });

  it.each([
    ["physical", { ...BASE_TOTALS, physical: 3337 }],
    ["reserved", { ...BASE_TOTALS, reserved: 1 }],
    ["available", { ...BASE_TOTALS, available: 3337 }],
    ["stockByLocation", { ...BASE_TOTALS, stockByLocation: 3337 }],
    ["soma quantityReceived", { ...BASE_TOTALS, lotsQuantityReceived: 3339 }],
    ["soma quantityAvailable", { ...BASE_TOTALS, lotsQuantityAvailable: 3339 }],
  ] as const)("detecta violação em %s", (_label, after) => {
    const d = assertNoQuantityChange(BASE_TOTALS, after);
    expect(d.shouldApply).toBe(false);
    expect(d.reason).toContain("VIOLAÇÃO");
  });
});

/* ═══ 5. Textos de auditoria ════════════════════════════════════════════════ */

describe("auditoria da correção de rastreabilidade", () => {
  it("auditoria A (entrada) declara ausente → Impressoras e a frase obrigatória", () => {
    const t = buildEntryAreaTraceAuditDetail({
      entryNumber: "ENT-2026-000002",
      invoiceNumber: "372043",
      areaName: "Impressoras",
    });
    expect(t).toContain("ENT-2026-000002");
    expect(t).toContain("372043");
    expect(t).toContain("Impressoras");
    expect(t).toContain("Correção histórica de rastreabilidade. Nenhuma quantidade de estoque foi alterada.");
  });

  it("auditoria B (entryItems) lista os 8 lotes vinculados", () => {
    const t = buildEntryItemLotsTraceAuditDetail({
      entryNumber: "ENT-2026-000002",
      invoiceNumber: "372043",
      links: BASE_ITEMS.map((s) => ({ lotNumber: s.lotNumber, entryItemId: "ei-" + s.productId })),
    });
    expect(t).toContain("8 entryItem(s)");
    for (const s of BASE_ITEMS) expect(t).toContain(s.lotNumber);
    expect(t).toContain("Nenhuma quantidade de estoque foi alterada.");
  });

  it("auditorias C e D (movimentos) citam o lote e preservam tipo/quantidade", () => {
    const exitTxt = buildMovementTraceAuditDetail({
      productName: "Cooler para processador Intel",
      movementId: "kx758yrsbatdw2yc4m09ytfapn8en7mn",
      movementType: "exit",
      lotNumber: "LOT-2026-000001",
    });
    const retTxt = buildMovementTraceAuditDetail({
      productName: "Cooler para processador Intel",
      movementId: "kx70n82skp2ph9wq5d75020wp58ez5ag",
      movementType: "return",
      lotNumber: "LOT-2026-000001",
    });
    expect(exitTxt).toContain("exit");
    expect(retTxt).toContain("return");
    expect(exitTxt).toContain("LOT-2026-000001");
    expect(retTxt).toContain("LOT-2026-000001");
    expect(exitTxt).toContain("permanecem intactos");
  });
});

/* ═══ 6. Constantes de segurança ════════════════════════════════════════════ */

describe("constantes da rodada de rastreabilidade", () => {
  it("alvo é ENT-2026-000002 / NF 372043", () => {
    expect(TRACEABILITY_ENTRY_NUMBER).toBe("ENT-2026-000002");
    expect(TRACEABILITY_INVOICE_NUMBER).toBe("372043");
  });

  it("o mapeamento dos 8 lotes usa exatamente os productIds do banco", () => {
    const expected = new Map(BASE_ITEMS.map((s) => [s.productId, s.lotNumber]));
    for (const spec of NF372043_EXPECTED_LOTS) {
      expect(expected.get(spec.productId), spec.productId).toBe(spec.lotNumber);
    }
  });
});

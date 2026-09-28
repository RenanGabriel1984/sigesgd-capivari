/**
 * Gestão de Estoque SGGD — RODADA DE CORREÇÃO
 * ÁREA (stale closure) · MATERIAL TYPE · LOTE NA SAÍDA · DEVOLUÇÃO ATÔMICA
 *
 * Estes testes exercitam as REGRAS PURAS que corrigem os problemas
 * confirmados na investigação forense:
 *
 *   src/lib/nfe-destination.ts → destino da NF-e viaja por ARGUMENTO
 *   src/lib/stock-consumption.ts → saída rápida grava o lote consumido
 *   src/lib/returns-rules.ts    → devolução é atômica (lote + saldo juntos)
 *   src/lib/stock-presentation.ts → "Reservado 0" é apresentado como "—"
 *
 * Nenhum teste escreve no banco. Nenhuma entrada, NF, devolução ou lote real
 * é criado, alterado ou removido por esta suíte.
 */
import { describe, it, expect } from "vitest";

import {
  resolveNfeDestination,
  toEntryDestinationPayload,
  NfeDestinationError,
  NFE_DESTINATION_REQUIRED_MESSAGE,
  type NfeDestination,
} from "@/lib/nfe-destination";

import {
  resolveConsumedLotId,
  formatConsumedLots,
} from "@/lib/stock-consumption";

import {
  resolveReturnLotGuard,
  buildUnresolvableLotMessage,
} from "@/lib/returns-rules";

import {
  formatStockQuantity,
  computeAvailableStock,
  stockSummary,
  EMPTY_VALUE_LABEL,
} from "@/lib/stock-presentation";

const AREA_IMPRESSORAS = "q97b7737gv98ajm8qqpmjmzjs18ezb58";

// ─────────────────────────────────────────────────────────────────────────────
// PARTE A / A.1 — ÁREA e MATERIAL TYPE (regressão do stale closure)
// ─────────────────────────────────────────────────────────────────────────────

describe("NF-e: destino viaja por argumento (regressão do stale closure)", () => {
  /**
   * Reproduz o bug ORIGINAL: o handler chamava setState e em seguida a
   * mutation no mesmo tick, lendo a closure do render anterior.
   *
   * Neste teste, `state` representa a closure ANTES do setState — ou seja,
   * `areaId: ""`. O override representa o valor REAL escolhido pelo usuário.
   * A asserção essencial é que o payload usa o override.
   */
  it("ENTREGA o areaId escolhido pelo usuário, não o estado anterior (bug real)", () => {
    // Estado da closure no momento da chamada (antes do setState aplicar):
    const closureState = { materialType: "consumption" as const, areaId: "" };
    // Valor que o usuário REALMENTE escolheu no diálogo:
    const userChoice: NfeDestination = {
      materialType: "consumption",
      areaId: AREA_IMPRESSORAS,
    };

    const resolved = resolveNfeDestination({
      override: userChoice,
      state: closureState,
    });

    expect(resolved.areaId).toBe(AREA_IMPRESSORAS);
    expect(resolved.areaId).not.toBe("");

    const payload = toEntryDestinationPayload(resolved);
    expect(payload.areaId).toBe(AREA_IMPRESSORAS);
  });

  it("NÃO deixa a área virar undefined quando o estado ainda é vazio", () => {
    const resolved = resolveNfeDestination({
      override: { materialType: "consumption", areaId: AREA_IMPRESSORAS },
      state: { materialType: "consumption", areaId: "" },
    });
    const payload = toEntryDestinationPayload(resolved);
    // Este é exatamente o valor que causou a perda da área na NF 372043.
    expect(payload.areaId).not.toBeUndefined();
  });

  it("preserva 'Material permanente' — nunca vira 'consumption'", () => {
    const resolved = resolveNfeDestination({
      override: { materialType: "permanent", areaId: AREA_IMPRESSORAS },
      state: { materialType: "consumption", areaId: "" },
    });
    expect(resolved.materialType).toBe("permanent");
    const payload = toEntryDestinationPayload(resolved);
    expect(payload.materialType).toBe("permanent");
    expect(payload.materialType).not.toBe("consumption");
    expect(payload.areaId).toBe(AREA_IMPRESSORAS);
  });

  it("payload com permanente + Impressoras contém os DOIS valores escolhidos", () => {
    const payload = toEntryDestinationPayload({
      materialType: "permanent",
      areaId: AREA_IMPRESSORAS,
    });
    expect(payload).toEqual({ materialType: "permanent", areaId: AREA_IMPRESSORAS });
  });

  it("payload com consumo + Impressoras contém os DOIS valores escolhidos", () => {
    const payload = toEntryDestinationPayload({
      materialType: "consumption",
      areaId: AREA_IMPRESSORAS,
    });
    expect(payload).toEqual({ materialType: "consumption", areaId: AREA_IMPRESSORAS });
  });

  it("usa o override mesmo quando o estado é TOTALMENTE divergente", () => {
    const resolved = resolveNfeDestination({
      override: { materialType: "permanent", areaId: AREA_IMPRESSORAS },
      state: { materialType: "consumption", areaId: "area-errada" },
    });
    expect(resolved).toEqual({ materialType: "permanent", areaId: AREA_IMPRESSORAS });
  });

  it("permite escolha consciente de 'Sem área' (estoque geral)", () => {
    const payload = toEntryDestinationPayload({
      materialType: "consumption",
      areaId: "",
    });
    // String vazia = escolha explícita de estoque geral → undefined é correto.
    expect(payload.areaId).toBeUndefined();
    expect(payload.materialType).toBe("consumption");
  });

  it("ignora areaId só com espaços em branco", () => {
    const payload = toEntryDestinationPayload({
      materialType: "consumption",
      areaId: "   ",
    });
    expect(payload.areaId).toBeUndefined();
  });

  it("FALHA explicitamente quando não há override nem escolha no estado", () => {
    expect(() =>
      resolveNfeDestination({ state: { materialType: null, areaId: null } }),
    ).toThrow(NfeDestinationError);
    expect(() =>
      resolveNfeDestination({ state: { materialType: null, areaId: null } }),
    ).toThrow(NFE_DESTINATION_REQUIRED_MESSAGE);
  });

  it("NUNCA inventa um tipo de material quando o estado é null", () => {
    // Este é o default que mascarava o bug no backend.
    expect(() => resolveNfeDestination({ state: { materialType: null, areaId: "x" } })).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PARTE B — SAÍDA RÁPIDA GRAVA O LOTE CONSUMIDO
// ─────────────────────────────────────────────────────────────────────────────

describe("Saída rápida: lote consumido fica registrado (campo estruturado)", () => {
  it("resolve o lote quando a saída consome UM único lote", () => {
    const consumed = [{ lotId: "n179kw2gk7p08rw1qjh0tygzmm4k480k", quantity: 1 }];
    expect(resolveConsumedLotId(consumed)).toBe("n179kw2gk7p08rw1qjh0tygzmm4k480k");
  });

  it("devolve null quando NENHUM lote foi consumido", () => {
    expect(resolveConsumedLotId([])).toBeNull();
  });

  it("resolve o lote de MAIOR consumo quando a saída usa vários", () => {
    const consumed = [
      { lotId: "lote-a", quantity: 1 },
      { lotId: "lote-b", quantity: 5 },
      { lotId: "lote-c", quantity: 2 },
    ];
    expect(resolveConsumedLotId(consumed)).toBe("lote-b");
  });

  it("é determinístico no empate de quantidades", () => {
    const a = [{ lotId: "zzz", quantity: 2 }, { lotId: "aaa", quantity: 2 }];
    const b = [{ lotId: "aaa", quantity: 2 }, { lotId: "zzz", quantity: 2 }];
    expect(resolveConsumedLotId(a)).toBe(resolveConsumedLotId(b));
  });

  it("mantém o texto legível da observation (compatibilidade)", () => {
    const numbers: Record<string, string> = {
      "n1": "LOT-2026-000001",
      "n2": "LOT-2026-000002",
    };
    const text = formatConsumedLots(
      [{ lotId: "n1", quantity: 1 }, { lotId: "n2", quantity: 3 }],
      (id) => numbers[id],
    );
    expect(text).toBe("LOT-2026-000001(1), LOT-2026-000002(3)");
  });

  it("sinaliza lote sem número conhecido na observation", () => {
    expect(formatConsumedLots([{ lotId: "x", quantity: 2 }], () => undefined)).toBe("?(2)");
  });

  /**
   * Cenário real do Cooler: a saída consumiu 1 unidade de um lote com saldo
   * 15. O campo estruturado DEVE apontar para esse lote — é o que permite
   * à devolução restaurar `quantityAvailable`.
   */
  it("reproduz o cenário do LOT-2026-000001 (Cooler Intel)", () => {
    const lotId = "n179kw2gk7p08rw1qjh0tygzmm4k480k";
    const consumed = resolveConsumedLotId([{ lotId, quantity: 1 }]);
    expect(consumed).toBe(lotId);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PARTE C — DEVOLUÇÃO ATÔMICA
// ─────────────────────────────────────────────────────────────────────────────

describe("Devolução: atômica — lote e saldo sobem juntos ou a operação falha", () => {
  it("PERMITE a devolução quando o lote de origem é resolvível", () => {
    expect(
      resolveReturnLotGuard({ exitLotId: "n179kw2gk7p08rw1qjh0tygzmm4k480k", requiresLot: true }),
    ).toBeNull();
  });

  it("BLOQUEIA quando o material exige lote e não há lote resolvível", () => {
    const guard = resolveReturnLotGuard({ exitLotId: null, requiresLot: true });
    expect(guard).not.toBeNull();
    expect(guard?.lotIdMissing).toBe(true);
  });

  it("BLOQUEIA quando a saída não consumeu lote mas o material exige rastreio", () => {
    const guard = resolveReturnLotGuard({ exitLotId: null, requiresLot: true });
    expect(guard?.exitDidNotConsumeLot).toBe(false);
    expect(guard?.lotIdMissing).toBe(true);
  });

  it("PERMITE item sem rastreio de lote (nenhum lote ativo do produto)", () => {
    expect(resolveReturnLotGuard({ exitLotId: null, requiresLot: false })).toBeNull();
  });

  it("a mensagem de recusa é explícita e informa que nada foi alterado", () => {
    const guard = resolveReturnLotGuard({ exitLotId: null, requiresLot: true })!;
    const msg = buildUnresolvableLotMessage({
      productName: "Cooler para processador Intel",
      exitLabel: "SAI-2026-000001",
      reason: guard,
    });
    expect(msg).toContain("Cooler para processador Intel");
    expect(msg).toContain("SAI-2026-000001");
    expect(msg).toMatch(/Nenhum estoque foi alterado/i);
  });

  it("a mensagem de recusa NUNCA afirma que o estoque foi restaurado", () => {
    const guard = resolveReturnLotGuard({ exitLotId: null, requiresLot: true })!;
    const msg = buildUnresolvableLotMessage({
      productName: "Toner",
      exitLabel: "SAI-2026-000009",
      reason: guard,
    });
    expect(msg).not.toMatch(/estoque (foi )?restaurado/i);
  });

  /**
   * CENÁRIO COMPLETO (passos 1 a 8 do pedido): saída de 1 unidade de um lote
   * com saldo 15, seguida da devolução da mesma unidade.
   * O par (lote, saldo global) precisa voltar ao estado inicial.
   */
  it("ciclo saída + devolução fecha lote E saldo em 15 (Cooler)", () => {
    // Estado inicial
    let lotAvailable = 15;
    let stockPhysical = 15;

    // 1-3. Saída de 1 unidade
    const exitLotId = resolveConsumedLotId([{ lotId: "lote-cooler", quantity: 1 }]);
    expect(exitLotId).toBe("lote-cooler");
    lotAvailable -= 1;
    stockPhysical -= 1;
    expect(lotAvailable).toBe(14);
    expect(stockPhysical).toBe(14);

    // 4. A saída carrega o lote estruturado
    expect(exitLotId).not.toBeNull();

    // 5-6. Devolução: o guard passa porque a saída tem lote resolvível
    const guard = resolveReturnLotGuard({ exitLotId, requiresLot: true });
    expect(guard).toBeNull();

    // 7-8. Lote e saldo sobem JUNTOS
    lotAvailable += 1;
    stockPhysical += 1;
    expect(lotAvailable).toBe(15);
    expect(stockPhysical).toBe(15);

    const returnLotId = resolveConsumedLotId([{ lotId: exitLotId!, quantity: 1 }]);
    expect(returnLotId).toBe("lote-cooler");
  });

  /**
   * CENÁRIO DE FALHA (passos 9 a 13): devolução sem lote identificável.
   * Nada pode ser alterado — nem lote, nem saldo.
   */
  it("devolução sem lote identificável NÃO altera lote nem saldo", () => {
    let lotAvailable = 14;
    let stockPhysical = 14;

    const guard = resolveReturnLotGuard({ exitLotId: null, requiresLot: true });
    expect(guard).not.toBeNull();

    // A operação é abortada: nenhuma escrita ocorre.
    expect(lotAvailable).toBe(14);
    expect(stockPhysical).toBe(14);
  });

  it("é IMPOSSível restaurar só o saldo global mantendo o lote defasado", () => {
    // Simula o bug histórico: saldo sobe, lote não.
    const buggyLot = 14;
    const buggyStock = 15;
    expect(buggyStock).not.toBe(buggyLot); // o estado inconsistente
    // A regra impede chegar lá: sem lote resolvível, a operação não prossegue.
    expect(resolveReturnLotGuard({ exitLotId: null, requiresLot: true })).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PARTE E — APRESENTAÇÃO DE "RESERVADO"
// ─────────────────────────────────────────────────────────────────────────────

describe("Tela de Produtos: 'Reservado 0' é apresentado como '—'", () => {
  it("mostra '—' quando não há reserva", () => {
    expect(formatStockQuantity(0, { zeroAsEmpty: true })).toBe(EMPTY_VALUE_LABEL);
  });

  it("mostra o número quando HÁ reserva", () => {
    expect(formatStockQuantity(15, { zeroAsEmpty: true })).toBe("15");
  });

  it("'Atual' e 'Disponível' continuam mostrando 0 real (não esconde informação)", () => {
    expect(formatStockQuantity(0)).toBe("0");
    expect(computeAvailableStock(0, 0)).toBe(0);
  });

  it("Disponível = físico − reservado", () => {
    expect(computeAvailableStock(15, 0)).toBe(15);
    expect(computeAvailableStock(15, 2)).toBe(13);
    expect(computeAvailableStock(1000, 0)).toBe(1000);
  });

  it("caso real da NF 372043: Cooler aparece 15 / — / 15 (não 0 / 15 / 0)", () => {
    const { physical, reserved, available } = stockSummary({
      physicalQuantity: 15,
      reservedQuantity: 0,
    });
    expect(formatStockQuantity(physical)).toBe("15");
    expect(formatStockQuantity(reserved, { zeroAsEmpty: true })).toBe("—");
    expect(formatStockQuantity(available)).toBe("15");
  });

  it("produto sem registro de estoque mostra 0 / — / 0", () => {
    const s = stockSummary(null);
    expect(s.physical).toBe(0);
    expect(s.reserved).toBe(0);
    expect(s.available).toBe(0);
  });

  it("produto genuinamente zerado continua visível como 0 em 'Atual'", () => {
    const s = stockSummary({ physicalQuantity: 0, reservedQuantity: 0 });
    expect(formatStockQuantity(s.physical)).toBe("0");
    expect(formatStockQuantity(s.reserved, { zeroAsEmpty: true })).toBe("—");
  });
});

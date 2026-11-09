// @vitest-environment jsdom
/**
 * R32 — D3: conferência da NF-e EDITÁVEL.
 *
 * Este teste RENDERIZA o componente real (`NfeReviewTable`) em jsdom e digita
 * nos campos — não é leitura de texto-fonte nem réplica da regra:
 *   • quantidade, unidade, unitário e total são editáveis mesmo com valores
 *     aparentemente válidos vindos do OCR;
 *   • alterar quantidade/unitário recalcula o total do item;
 *   • valor alterado é destacado e o valor reconhecido fica visível;
 *   • divergência matemática e quantidade inválida são exibidas/bloqueadas;
 *   • a soma dos itens é comparada com o total do documento.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import {
  NfeReviewTable,
  type NfeReviewRow,
} from "@/components/NfeReviewTable";
import {
  nfeItemTotalMismatch,
  parseDecimalInput,
  parseMoneyInput,
  parseQuantityInput,
  validateNfeReviewItems,
} from "@/lib/nfe-item-edit";

beforeAll(() => {
  // Radix UI mede elementos com ResizeObserver e matchMedia, ausentes no jsdom.
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as any).ResizeObserver = ResizeObserverStub;
  (window as any).matchMedia =
    (window as any).matchMedia ??
    ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }));
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
});

afterEach(() => cleanup());

const PRODUCT = {
  _id: "product-1",
  name: "KIT TECLADO E MOUSE USB SLIM CHOCO",
  brand: "Incotech",
  category: { name: "Periféricos" },
};

function row(overrides: Partial<NfeReviewRow> = {}): NfeReviewRow {
  return {
    item: {
      lineNumber: 1,
      code: "231071",
      description: "KIT TECLADO E MOUSE USB SLIM CHOCO",
      unit: "PC",
      quantity: 25,
      unitValue: 52.94,
      totalValue: 1323.5,
    },
    originalValues: {
      quantity: 25,
      unit: "PC",
      unitValue: 52.94,
      totalValue: 1323.5,
    },
    productId: "product-1",
    matchStatus: "found",
    matchScore: 96,
    associationType: "automatic",
    ...overrides,
  };
}

function renderTable(
  rows: NfeReviewRow[],
  extra: { documentTotal?: number } = {},
) {
  const onUpdate = vi.fn<(index: number, patch: any) => void>();
  const lastPatch = () =>
    onUpdate.mock.calls[onUpdate.mock.calls.length - 1][1] as NfeReviewRow;
  const utils = render(
    <NfeReviewTable
      items={rows}
      products={[PRODUCT]}
      onUpdate={onUpdate}
      documentTotal={extra.documentTotal}
    />,
  );
  return { ...utils, onUpdate, lastPatch };
}

describe("R32/D3 — campos editáveis mesmo com valores válidos do OCR", () => {
  it("quantidade, unidade, unitário e total são editáveis (não somente leitura)", () => {
    renderTable([row()]);

    for (const label of [
      /Quantidade do item 1/,
      /Unidade do item 1/,
      /Valor unitário do item 1/,
      /Valor total do item 1/,
    ]) {
      const input = screen.getByLabelText(label) as HTMLInputElement;
      expect(input.disabled).toBe(false);
      expect(input.readOnly).toBe(false);
    }
  });

  it("corrigir a quantidade recalcula o total do item (25 → 10)", () => {
    const { onUpdate, lastPatch } = renderTable([row()]);

    fireEvent.change(screen.getByLabelText(/Quantidade do item 1/), {
      target: { value: "10" },
    });

    expect(onUpdate).toHaveBeenCalled();
    const patch = lastPatch();
    expect(patch.item.quantity).toBe(10);
    expect(patch.item.totalValue).toBe(529.4); // 10 × 52,94
  });

  it("corrigir o valor unitário recalcula o total (52,94 → 50,00)", () => {
    const { lastPatch } = renderTable([row()]);

    fireEvent.change(screen.getByLabelText(/Valor unitário do item 1/), {
      target: { value: "50,00" },
    });

    const patch = lastPatch();
    expect(patch.item.unitValue).toBe(50);
    expect(patch.item.totalValue).toBe(1250);
  });

  it("editar o total manualmente prevalece sobre o recálculo", () => {
    const { lastPatch } = renderTable([row()]);

    fireEvent.change(screen.getByLabelText(/Valor total do item 1/), {
      target: { value: "1.300,00" },
    });

    const patch = lastPatch();
    expect(patch.item.totalValue).toBe(1300);
    expect(patch.item.quantity).toBe(25);
  });

  it("corrigir a unidade de medida é permitido", () => {
    const { lastPatch } = renderTable([row()]);

    fireEvent.change(screen.getByLabelText(/Unidade do item 1/), {
      target: { value: "cx" },
    });

    const patch = lastPatch();
    expect(patch.item.unit).toBe("CX");
  });
});

describe("R32/D3 — destaque do que foi alterado", () => {
  it("mostra o selo de alteração e o valor reconhecido", () => {
    renderTable([
      row({
        item: {
          lineNumber: 1,
          code: "231071",
          description: "KIT TECLADO E MOUSE USB SLIM CHOCO",
          unit: "PC",
          quantity: 10,
          unitValue: 52.94,
          totalValue: 529.4,
        },
      }),
    ]);

    expect(screen.getByText("alterado na conferência")).toBeTruthy();
    expect(screen.getByText("reconhecido: 25")).toBeTruthy();
    expect(screen.getByText("reconhecido: R$ 1.323,50")).toBeTruthy();
  });

  it("não destaca nada quando os valores são os do documento", () => {
    renderTable([row()]);
    expect(screen.queryByText("alterado na conferência")).toBeNull();
  });
});

describe("R32/D3 — divergências explícitas", () => {
  it("total que não fecha com quantidade × unitário é exibido no item", () => {
    renderTable([
      row({
        item: {
          lineNumber: 1,
          code: "231071",
          description: "KIT",
          unit: "PC",
          quantity: 25,
          unitValue: 52.94,
          totalValue: 500,
        },
      }),
    ]);

    expect(screen.getByText(/Total não confere/)).toBeTruthy();

    const result = validateNfeReviewItems([
      {
        item: {
          lineNumber: 1,
          code: "231071",
          description: "KIT",
          unit: "PC",
          quantity: 25,
          unitValue: 52.94,
          totalValue: 500,
        },
      },
    ]);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/não confere/);
  });

  it("quantidade zerada/negativa é bloqueada e sinalizada", () => {
    renderTable([
      row({
        item: {
          lineNumber: 1,
          code: "231071",
          description: "KIT",
          unit: "PC",
          quantity: 0,
          unitValue: 52.94,
          totalValue: 0,
        },
      }),
    ]);

    expect(screen.getByText(/Preencha a quantidade real/)).toBeTruthy();
    expect(
      validateNfeReviewItems([{ item: { ...row().item, quantity: -1 } }]).ok,
    ).toBe(false);
  });

  it("soma dos itens divergente do total do documento é avisada", () => {
    renderTable([row()], { documentTotal: 1500 });
    expect(screen.getByText(/difere do total do documento/)).toBeTruthy();
  });

  it("soma igual ao documento não gera aviso", () => {
    renderTable([row()], { documentTotal: 1323.5 });
    expect(screen.queryByText(/difere do total do documento/)).toBeNull();
  });

  it("tolerância monetária evita falso positivo de arredondamento", () => {
    expect(
      nfeItemTotalMismatch({ ...row().item, totalValue: 1323.51 }),
    ).toBeNull();
  });
});

describe("R32/D3 — leitura dos valores digitados", () => {
  it("aceita formato brasileiro, ponto decimal e milhar sem centavos", () => {
    expect(parseDecimalInput("1.323,50")).toBe(1323.5);
    expect(parseDecimalInput("R$ 52,94")).toBe(52.94);
    expect(parseDecimalInput("1323.50")).toBe(1323.5);
    expect(parseDecimalInput("1.323")).toBe(1323); // não 1,323
    expect(parseDecimalInput("25")).toBe(25);
  });

  it("rejeita texto sem número, quantidade zero/negativa e valor negativo", () => {
    expect(parseDecimalInput("")).toBeNull();
    expect(parseDecimalInput("abc")).toBeNull();
    expect(parseQuantityInput("0")).toBeNull();
    expect(parseQuantityInput("-3")).toBeNull();
    expect(parseMoneyInput("-1,00")).toBeNull();
    expect(parseQuantityInput("2,5")).toBe(2.5);
  });
});

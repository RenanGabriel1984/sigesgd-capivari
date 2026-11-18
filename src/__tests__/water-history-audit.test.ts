import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf-8");
const backend = read("src/convex/water.ts");
const page = read("src/pages/Water.tsx");

describe("histórico e auditoria do controle de água", () => {
  it("preserva o nome congelado no rateio mesmo após renomear participante", () => {
    expect(backend).toContain('participantName: share.participantName ?? participantNames.get(String(share.participantId)) ?? "Participante inativo"');
    expect(backend).toContain("participantName: participant.name");
  });

  it("registra data efetiva e origem no histórico do recebimento", () => {
    expect(backend).toContain("new Date(args.receivedAt).toLocaleDateString(\"pt-BR\")");
    expect(backend).toContain('Origem: ${args.sourceName?.trim() || "não informada"}');
  });

  it("registra tipo, data e variações dos galões na auditoria", () => {
    expect(backend).toContain("Movimentação ${args.type} em ${new Date(args.date).toLocaleDateString(\"pt-BR\")}");
    expect(backend).toContain("galões cheios");
    expect(backend).toContain("vazios");
  });

  it("registra data efetiva e meio do pagamento na auditoria", () => {
    expect(backend).toContain("new Date(args.paidAt).toLocaleDateString(\"pt-BR\")");
    expect(backend).toContain('Meio: ${args.method?.trim() || "não informado"}');
  });

  it("permite informar a data efetiva do pagamento pela interface", () => {
    expect(page).toContain("paymentDates");
    expect(page).toContain('type="date"');
    expect(page).toContain("paidAt: dateToTimestamp(paymentDates[share._id] ?? localDateInput())");
    expect(page).not.toContain("paidAt: Date.now()");
  });

  it("implementa estornos lógicos com motivo, ator, data e bloqueio de reexecução", () => {
    expect(backend).toContain("export const reverseReceipt = mutation");
    expect(backend).toContain("export const reverseContainerMovement = mutation");
    expect(backend).toContain("export const reversePayment = mutation");
    expect(backend).toContain("if (receipt.reversedAt) throw new Error");
    expect(backend).toContain("if (movement.reversedAt) throw new Error");
    expect(backend).toContain("if (payment.reversedAt) throw new Error");
    expect(backend).toContain("reversalReason: reason");
    expect(backend).toContain("Não é permitido estornar recebimento após o fechamento do rateio");
  });

  it("exclui lançamentos estornados dos saldos físicos e financeiros", () => {
    expect(backend).toContain("receipts.filter((receipt: any) => !receipt.reversedAt)");
    expect(backend).toContain("movements.filter((movement: any) => !movement.reversedAt)");
    expect(backend).toContain("payments.filter((payment: any) => !payment.reversedAt)");
  });

});

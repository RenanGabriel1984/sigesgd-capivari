import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requirePermission } from "./rbac";
import { calculateWaterBalances, remainingWaterShare, splitWaterCost } from "../lib/water-management";

const movementType = v.union(
  v.literal("opening_balance"),
  v.literal("supplier_delivery"),
  v.literal("consumption"),
  v.literal("supplier_exchange"),
  v.literal("adjustment"),
);

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

async function currentBalances(ctx: any) {
  const movements = await ctx.db.query("waterMovements").collect();
  return calculateWaterBalances(movements);
}

async function requireWaterRead(ctx: any) {
  return requirePermission(ctx, "stock.view", { entity: "waterManagement" });
}

async function requireWaterManage(ctx: any) {
  return requirePermission(ctx, "stock.mutate", { entity: "waterManagement" });
}

/**
 * Painel único: posição de garrafões, compras manuais, rateios, pagamentos
 * parciais e saldo devedor. Competências e seus rateios são históricos:
 * não há fechamento mensal obrigatório nem edição retroativa.
 */
export const dashboard = query({
  args: {},
  handler: async (ctx) => {
    await requireWaterRead(ctx);
    const [participants, movements, periods, charges, payments] = await Promise.all([
      ctx.db.query("waterParticipants").collect(),
      ctx.db.query("waterMovements").collect(),
      ctx.db.query("waterPeriods").collect(),
      ctx.db.query("waterPeriodCharges").collect(),
      ctx.db.query("waterPayments").collect(),
    ]);

    const balances = calculateWaterBalances(movements);
    const paymentsByCharge = new Map<string, number>();
    for (const payment of payments) {
      const key = `${String(payment.periodId)}|${String(payment.participantId)}`;
      paymentsByCharge.set(key, (paymentsByCharge.get(key) ?? 0) + payment.amount);
    }
    const participantById = new Map(participants.map((row: any) => [String(row._id), row]));
    const chargesByPeriod = new Map<string, any[]>();
    for (const charge of charges) {
      const key = String(charge.periodId);
      const rows = chargesByPeriod.get(key) ?? [];
      rows.push(charge);
      chargesByPeriod.set(key, rows);
    }

    const periodRows = periods
      .slice()
      .sort((a: any, b: any) => b.startDate.localeCompare(a.startDate))
      .map((period: any) => {
        const periodCharges = chargesByPeriod.get(String(period._id)) ?? [];
        const rows = periodCharges.map((charge: any) => {
          const paid = paymentsByCharge.get(`${String(period._id)}|${String(charge.participantId)}`) ?? 0;
          return {
            chargeId: charge._id,
            participantId: charge.participantId,
            participantName: charge.participantNameSnapshot,
            active: participantById.get(String(charge.participantId))?.active ?? false,
            shareAmount: charge.shareAmount,
            paidAmount: paid,
            outstandingAmount: Math.max(0, Math.round((charge.shareAmount - paid) * 100) / 100),
          };
        });
        const allocatedAmount = rows.reduce((sum: number, row: any) => sum + row.shareAmount, 0);
        const paidAmount = rows.reduce((sum: number, row: any) => sum + row.paidAmount, 0);
        return {
          ...period,
          participants: rows,
          allocatedAmount,
          paidAmount,
          outstandingAmount: Math.max(0, Math.round((allocatedAmount - paidAmount) * 100) / 100),
        };
      });

    const participantRows = participants
      .slice()
      .sort((a: any, b: any) => a.name.localeCompare(b.name, "pt-BR"))
      .map((participant: any) => {
        const ownCharges = charges.filter((row: any) => row.participantId === participant._id);
        const due = ownCharges.reduce((sum: number, row: any) => sum + row.shareAmount, 0);
        const paid = ownCharges.reduce((sum: number, row: any) =>
          sum + (paymentsByCharge.get(`${String(row.periodId)}|${String(participant._id)}`) ?? 0), 0);
        return {
          ...participant,
          totalDue: due,
          totalPaid: paid,
          outstanding: Math.max(0, Math.round((due - paid) * 100) / 100),
        };
      });

    const purchasedCost = movements.reduce((sum: number, row: any) => sum + (row.costAmount ?? 0), 0);
    const allocatedCost = periods.reduce((sum: number, row: any) => sum + row.totalCost, 0);
    const paidCost = payments.reduce((sum: number, row: any) => sum + row.amount, 0);

    return {
      generatedAt: Date.now(),
      balances,
      totals: {
        purchasedCost,
        allocatedCost,
        paidCost,
        outstandingCost: Math.max(0, Math.round((allocatedCost - paidCost) * 100) / 100),
        fullGallonsReceived: movements.reduce((sum: number, row: any) => sum + Math.max(0, row.fullDelta), 0),
        emptyGallonsReturnedToSupplier: movements.reduce((sum: number, row: any) => sum + Math.max(0, -row.emptyDelta), 0),
      },
      participants: participantRows,
      periods: periodRows,
      movements: movements.slice().sort((a: any, b: any) => b.createdAt - a.createdAt).slice(0, 200),
    };
  },
});

export const createParticipant = mutation({
  args: { name: v.string(), department: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { userId } = await requireWaterManage(ctx);
    const name = args.name.trim();
    if (!name) throw new Error("Informe o nome do participante.");
    const existing = await ctx.db.query("waterParticipants").collect();
    if (existing.some((row: any) => row.name.trim().toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"))) {
      throw new Error("Já existe um participante com esse nome.");
    }
    const now = Date.now();
    const participantId = await ctx.db.insert("waterParticipants", {
      name,
      department: args.department?.trim() || undefined,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("auditLogs", {
      userId, action: "create", entity: "waterParticipants", entityId: participantId,
      details: `Participante do rateio de água cadastrado: ${name}`, timestamp: now,
    });
    return participantId;
  },
});

export const setParticipantActive = mutation({
  args: { participantId: v.id("waterParticipants"), active: v.boolean() },
  handler: async (ctx, args) => {
    const { userId } = await requireWaterManage(ctx);
    const participant = await ctx.db.get(args.participantId);
    if (!participant) throw new Error("Participante não encontrado.");
    await ctx.db.patch(args.participantId, { active: args.active, updatedAt: Date.now() });
    await ctx.db.insert("auditLogs", {
      userId, action: args.active ? "activate" : "deactivate", entity: "waterParticipants",
      entityId: args.participantId, details: `Participante ${participant.name}: ${args.active ? "ativado" : "inativado"}`,
      timestamp: Date.now(),
    });
    return args.participantId;
  },
});

export const recordMovement = mutation({
  args: {
    movementType,
    fullDelta: v.number(),
    emptyDelta: v.number(),
    supplierName: v.optional(v.string()),
    costAmount: v.optional(v.number()),
    observation: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireWaterManage(ctx);
    if (!Number.isInteger(args.fullDelta) || !Number.isInteger(args.emptyDelta)) {
      throw new Error("As quantidades de garrafões devem ser números inteiros.");
    }
    const normalizedCost = args.costAmount === undefined ? undefined : Math.round((args.costAmount + Number.EPSILON) * 100) / 100;
    if (normalizedCost !== undefined && (!Number.isFinite(normalizedCost) || normalizedCost < 0)) {
      throw new Error("O custo informado é inválido.");
    }
    if (!["supplier_delivery", "supplier_exchange"].includes(args.movementType) && normalizedCost !== undefined) {
      throw new Error("O custo de aquisição só pode ser informado em recebimentos ou trocas com fornecedor.");
    }
    if (!args.observation.trim()) throw new Error("Informe a observação da movimentação.");
    if (args.movementType === "opening_balance") {
      const existing = await ctx.db.query("waterMovements").collect();
      if (existing.length > 0) throw new Error("O saldo inicial já foi registrado. Use ajuste de contagem para correções.");
      if (args.fullDelta < 0 || args.emptyDelta < 0 || (args.fullDelta === 0 && args.emptyDelta === 0)) {
        throw new Error("O saldo inicial deve conter quantidades não negativas e ao menos um garrafão.");
      }
    } else if (args.movementType === "supplier_delivery") {
      if (args.fullDelta <= 0 || args.emptyDelta !== 0) throw new Error("Recebimento do fornecedor deve aumentar apenas os garrafões cheios.");
      if (!args.supplierName?.trim() || normalizedCost === undefined) throw new Error("Informe fornecedor e custo manual do recebimento.");
    } else if (args.movementType === "consumption") {
      if (args.fullDelta >= 0 || args.emptyDelta < 0) throw new Error("Consumo deve retirar garrafões cheios e pode registrar os vazios recebidos.");
      if (args.costAmount !== undefined && args.costAmount !== 0) throw new Error("O custo do consumo é controlado pelo rateio da competência.");
    } else if (args.movementType === "supplier_exchange") {
      if (args.fullDelta <= 0 || args.emptyDelta >= 0) throw new Error("Troca com fornecedor deve receber cheios e devolver vazios.");
      if (!args.supplierName?.trim() || args.costAmount === undefined) throw new Error("Informe fornecedor e custo manual da troca.");
    } else if (args.movementType === "adjustment") {
      if (args.fullDelta === 0 && args.emptyDelta === 0) throw new Error("O ajuste precisa alterar pelo menos um saldo.");
    }

    const current = await currentBalances(ctx);
    const nextFull = current.full + args.fullDelta;
    const nextEmpty = current.empty + args.emptyDelta;
    if (nextFull < 0 || nextEmpty < 0) {
      throw new Error(`Saldo insuficiente de garrafões. Cheios: ${current.full}; vazios: ${current.empty}.`);
    }
    const now = Date.now();
    const movementId = await ctx.db.insert("waterMovements", {
      movementType: args.movementType,
      fullDelta: args.fullDelta,
      emptyDelta: args.emptyDelta,
      supplierName: args.supplierName?.trim() || undefined,
      costAmount: normalizedCost,
      observation: args.observation.trim(),
      userId,
      createdAt: now,
    });
    await ctx.db.insert("auditLogs", {
      userId, action: "create", entity: "waterMovements", entityId: movementId,
      details: `Água mineral — ${args.movementType}: cheios ${args.fullDelta >= 0 ? "+" : ""}${args.fullDelta}, vazios ${args.emptyDelta >= 0 ? "+" : ""}${args.emptyDelta}. ${args.observation.trim()}`,
      timestamp: now,
    });
    return movementId;
  },
});

export const createPeriod = mutation({
  args: {
    label: v.string(),
    startDate: v.string(),
    endDate: v.string(),
    gallonsConsumed: v.number(),
    totalCost: v.number(),
    participantIds: v.array(v.id("waterParticipants")),
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireWaterManage(ctx);
    const label = args.label.trim();
    if (!label) throw new Error("Informe a competência ou período do rateio.");
    if (!validDate(args.startDate) || !validDate(args.endDate) || args.endDate < args.startDate) {
      throw new Error("Informe datas válidas para o período (AAAA-MM-DD).");
    }
    if (!Number.isInteger(args.gallonsConsumed) || args.gallonsConsumed <= 0) {
      throw new Error("Informe a quantidade inteira de garrafões consumidos no período.");
    }
    const normalizedTotalCost = Math.round((args.totalCost + Number.EPSILON) * 100) / 100;
    if (!Number.isFinite(normalizedTotalCost) || normalizedTotalCost <= 0) {
      throw new Error("Informe o custo total manual do período.");
    }
    const participantIds = [...new Set(args.participantIds.map(String))];
    if (participantIds.length === 0 || participantIds.length !== args.participantIds.length) {
      throw new Error("Selecione participantes ativos, sem duplicidade.");
    }
    const [existingPeriods, participants] = await Promise.all([
      ctx.db.query("waterPeriods").collect(),
      ctx.db.query("waterParticipants").collect(),
    ]);
    if (existingPeriods.some((row: any) => row.label.trim().toLocaleLowerCase("pt-BR") === label.toLocaleLowerCase("pt-BR"))) {
      throw new Error("Já existe uma competência com esse nome. Não reutilize ou reescreva competências anteriores.");
    }
    if (existingPeriods.some((row: any) => args.startDate <= row.endDate && args.endDate >= row.startDate)) {
      throw new Error("O período informado sobrepõe uma competência já registrada. Use um intervalo novo sem reescrever o histórico.");
    }
    const selected = participantIds.map((id) => participants.find((row: any) => String(row._id) === id));
    if (selected.some((row: any) => !row || row.active === false)) {
      throw new Error("Um ou mais participantes não existem ou estão inativos.");
    }

    const now = Date.now();
    const periodId = await ctx.db.insert("waterPeriods", {
      label,
      startDate: args.startDate,
      endDate: args.endDate,
      gallonsConsumed: args.gallonsConsumed,
      totalCost: normalizedTotalCost,
      observation: args.observation?.trim() || undefined,
      createdByUserId: userId,
      createdAt: now,
    });
    const shares = splitWaterCost(normalizedTotalCost, selected.map((participant: any) => String(participant._id)));
    for (const share of shares) {
      const participant: any = selected.find((row: any) => String(row._id) === share.participantId);
      await ctx.db.insert("waterPeriodCharges", {
        periodId,
        participantId: participant._id,
        participantNameSnapshot: participant.name,
        shareAmount: share.shareAmount,
        createdAt: now,
      });
    }
    await ctx.db.insert("auditLogs", {
      userId, action: "create", entity: "waterPeriods", entityId: periodId,
      details: `Rateio ${label}: ${args.gallonsConsumed} garrafões, R$ ${normalizedTotalCost.toFixed(2)}, ${selected.length} participante(s). Competência imutável.`,
      timestamp: now,
    });
    return periodId;
  },
});

export const recordPayment = mutation({
  args: {
    periodId: v.id("waterPeriods"),
    participantId: v.id("waterParticipants"),
    amount: v.number(),
    paidAt: v.number(),
    method: v.optional(v.string()),
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireWaterManage(ctx);
    const normalizedAmount = Math.round((args.amount + Number.EPSILON) * 100) / 100;
    if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) throw new Error("O pagamento deve ser de pelo menos R$ 0,01.");
    if (!Number.isFinite(args.paidAt) || args.paidAt <= 0) throw new Error("Informe uma data de pagamento válida.");
    const [period, charges, payments] = await Promise.all([
      ctx.db.get(args.periodId),
      ctx.db.query("waterPeriodCharges").withIndex("by_period", (q: any) => q.eq("periodId", args.periodId)).collect(),
      ctx.db.query("waterPayments").withIndex("by_period", (q: any) => q.eq("periodId", args.periodId)).collect(),
    ]);
    if (!period) throw new Error("Competência não encontrada.");
    const charge = charges.find((row: any) => row.participantId === args.participantId);
    if (!charge) throw new Error("Este participante não faz parte do rateio selecionado.");
    const participantPayments = payments
      .filter((row: any) => row.participantId === args.participantId)
      .map((row: any) => row.amount);
    const remaining = remainingWaterShare(charge.shareAmount, participantPayments);
    if (normalizedAmount > remaining + 0.000001) {
      throw new Error(`Pagamento excede o saldo em aberto de R$ ${remaining.toFixed(2)}.`);
    }
    const now = Date.now();
    const paymentId = await ctx.db.insert("waterPayments", {
      periodId: args.periodId,
      participantId: args.participantId,
      amount: normalizedAmount,
      paidAt: args.paidAt,
      method: args.method?.trim() || undefined,
      observation: args.observation?.trim() || undefined,
      receivedByUserId: userId,
      createdAt: now,
    });
    await ctx.db.insert("auditLogs", {
      userId, action: "deliver", entity: "waterPayments", entityId: paymentId,
      details: `Pagamento de água recebido: ${charge.participantNameSnapshot}, competência ${period.label}, R$ ${normalizedAmount.toFixed(2)}.`,
      timestamp: now,
    });
    return paymentId;
  },
});

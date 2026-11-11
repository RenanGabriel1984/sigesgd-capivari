import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requirePermission } from "./rbac";
import { splitWaterCostCents } from "../lib/water-control";

async function currentContainerBalance(ctx: any) {
  const [receipts, movements] = await Promise.all([
    ctx.db.query("waterReceipts").collect(),
    ctx.db.query("waterContainerMovements").collect(),
  ]);
  return {
    fullGallons:
      receipts.reduce((sum: number, item: any) => sum + item.gallonsReceived, 0) +
      movements.reduce((sum: number, item: any) => sum + item.fullDelta, 0),
    emptyGallons:
      movements.reduce((sum: number, item: any) => sum + item.emptyDelta, 0) -
      receipts.reduce((sum: number, item: any) => sum + item.emptyGallonsReturned, 0),
  };
}

async function writeAudit(ctx: any, userId: any, action: "create" | "update", entity: string, entityId: string, details: string) {
  await ctx.db.insert("auditLogs", {
    userId, action, entity, entityId, details, timestamp: Date.now(),
  });
}

export const dashboard = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "water.view", { entity: "water" });
    const [participants, periods, receipts, movements, balance] = await Promise.all([
      ctx.db.query("waterParticipants").collect(),
      ctx.db.query("waterPeriods").withIndex("by_startAt").order("desc").take(24),
      ctx.db.query("waterReceipts").withIndex("by_receivedAt").order("desc").take(30),
      ctx.db.query("waterContainerMovements").withIndex("by_date").order("desc").take(30),
      currentContainerBalance(ctx),
    ]);
    return {
      participants: participants.sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
      periods,
      openPeriod: periods.find((period) => period.status === "open") ?? null,
      receipts,
      movements,
      balance,
    };
  },
});

export const periodDetails = query({
  args: { periodId: v.id("waterPeriods") },
  handler: async (ctx, args) => {
    await requirePermission(ctx, "water.view", { entity: "waterPeriods", entityId: args.periodId });
    const period = await ctx.db.get(args.periodId);
    if (!period) return null;
    const [receipts, shares] = await Promise.all([
      ctx.db.query("waterReceipts").withIndex("by_period", (q) => q.eq("periodId", args.periodId)).collect(),
      ctx.db.query("waterShares").withIndex("by_period", (q) => q.eq("periodId", args.periodId)).collect(),
    ]);
    const sharesWithPayments = await Promise.all(shares.map(async (share: any) => {
      const payments = await ctx.db.query("waterPayments")
        .withIndex("by_share", (q: any) => q.eq("shareId", share._id)).collect();
      const paidCents = payments.reduce((sum: number, payment: any) => sum + payment.amountCents, 0);
      return {
        ...share,
        payments,
        paidCents,
        remainingCents: Math.max(0, share.amountDueCents - paidCents),
        paymentStatus: paidCents >= share.amountDueCents ? "paid" : paidCents > 0 ? "partial" : "pending",
      };
    }));
    const totalValueCents = receipts.reduce((sum, receipt) => sum + receipt.totalValueCents, 0);
    const totalGallonsReceived = receipts.reduce((sum, receipt) => sum + receipt.gallonsReceived, 0);
    const totalPaidCents = sharesWithPayments.reduce((sum: number, share: any) => sum + share.paidCents, 0);
    return {
      period,
      receipts: receipts.sort((a, b) => b.receivedAt - a.receivedAt),
      shares: sharesWithPayments.sort((a: any, b: any) => a.participantName.localeCompare(b.participantName, "pt-BR")),
      totalValueCents,
      totalGallonsReceived,
      totalPaidCents,
      totalOutstandingCents: Math.max(0, totalValueCents - totalPaidCents),
    };
  },
});

export const createParticipant = mutation({
  args: { name: v.string(), observation: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { userId } = await requirePermission(ctx, "water.manage", { entity: "waterParticipants" });
    const name = args.name.trim();
    if (!name) throw new Error("Informe o nome da pessoa.");
    if (name.length > 120) throw new Error("O nome deve ter no máximo 120 caracteres.");
    const existing = await ctx.db.query("waterParticipants").collect();
    if (existing.some((person: any) => person.name.toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"))) {
      throw new Error("Essa pessoa já está cadastrada.");
    }
    const now = Date.now();
    const id = await ctx.db.insert("waterParticipants", {
      name, observation: args.observation?.trim() || undefined, active: true, createdAt: now, updatedAt: now,
    });
    await writeAudit(ctx, userId, "create", "waterParticipants", String(id), `Participante "${name}" cadastrado.`);
    return id;
  },
});

export const updateParticipant = mutation({
  args: {
    participantId: v.id("waterParticipants"),
    name: v.optional(v.string()),
    active: v.optional(v.boolean()),
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requirePermission(ctx, "water.manage", { entity: "waterParticipants", entityId: args.participantId });
    const participant = await ctx.db.get(args.participantId);
    if (!participant) throw new Error("Participante não encontrado.");
    const updates: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.name !== undefined) {
      const name = args.name.trim();
      if (!name) throw new Error("O nome não pode ficar vazio.");
      const all = await ctx.db.query("waterParticipants").collect();
      if (all.some((person: any) => person._id !== args.participantId && person.name.toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"))) {
        throw new Error("Já existe uma pessoa cadastrada com esse nome.");
      }
      updates.name = name;
    }
    if (args.active !== undefined) updates.active = args.active;
    if (args.observation !== undefined) updates.observation = args.observation.trim() || undefined;
    await ctx.db.patch(args.participantId, updates);
    await writeAudit(ctx, userId, "update", "waterParticipants", String(args.participantId), JSON.stringify(updates));
    return args.participantId;
  },
});

export const createPeriod = mutation({
  args: {
    title: v.string(),
    cadence: v.union(v.literal("monthly"), v.literal("bimonthly"), v.literal("custom")),
    startAt: v.number(),
    endAt: v.number(),
    participantIds: v.array(v.id("waterParticipants")),
  },
  handler: async (ctx, args) => {
    const { userId } = await requirePermission(ctx, "water.manage", { entity: "waterPeriods" });
    const title = args.title.trim();
    if (!title) throw new Error("Informe o nome do período.");
    if (args.endAt < args.startAt) throw new Error("A data final não pode ser anterior à inicial.");
    const open = await ctx.db.query("waterPeriods").withIndex("by_status", (q) => q.eq("status", "open")).first();
    if (open) throw new Error("Feche o período atual antes de abrir outro.");
    const participantIds = [...new Set(args.participantIds)];
    for (const participantId of participantIds) {
      const participant = await ctx.db.get(participantId);
      if (!participant || !participant.active) throw new Error("O período só pode incluir participantes ativos.");
    }
    const now = Date.now();
    const id = await ctx.db.insert("waterPeriods", {
      title, cadence: args.cadence, startAt: args.startAt, endAt: args.endAt,
      participantIds, status: "open", createdBy: userId, createdAt: now,
    });
    await writeAudit(ctx, userId, "create", "waterPeriods", String(id), `Período "${title}" aberto com ${participantIds.length} participante(s).`);
    return id;
  },
});

export const setPeriodParticipants = mutation({
  args: { periodId: v.id("waterPeriods"), participantIds: v.array(v.id("waterParticipants")) },
  handler: async (ctx, args) => {
    const { userId } = await requirePermission(ctx, "water.manage", { entity: "waterPeriods", entityId: args.periodId });
    const period = await ctx.db.get(args.periodId);
    if (!period || period.status !== "open") throw new Error("Somente um período aberto pode ter participantes alterados.");
    const participantIds = [...new Set(args.participantIds)];
    for (const participantId of participantIds) {
      const participant = await ctx.db.get(participantId);
      if (!participant || !participant.active) throw new Error("O período só pode incluir participantes ativos.");
    }
    await ctx.db.patch(args.periodId, { participantIds });
    await writeAudit(ctx, userId, "update", "waterPeriods", String(args.periodId), `Participantes atualizados: ${participantIds.length}.`);
    return participantIds.length;
  },
});

export const createReceipt = mutation({
  args: {
    periodId: v.id("waterPeriods"),
    receivedAt: v.number(),
    gallonsReceived: v.number(),
    emptyGallonsReturned: v.number(),
    totalValueCents: v.number(),
    sourceName: v.optional(v.string()),
    paidByName: v.optional(v.string()),
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requirePermission(ctx, "water.manage", { entity: "waterReceipts" });
    const period = await ctx.db.get(args.periodId);
    if (!period || period.status !== "open") throw new Error("Selecione um período de rateio aberto.");
    if (!Number.isSafeInteger(args.gallonsReceived) || args.gallonsReceived <= 0) throw new Error("A quantidade de galões recebidos deve ser um inteiro maior que zero.");
    if (!Number.isSafeInteger(args.emptyGallonsReturned) || args.emptyGallonsReturned < 0) throw new Error("A quantidade de vazios devolvidos deve ser um inteiro não negativo.");
    if (!Number.isSafeInteger(args.totalValueCents) || args.totalValueCents < 0) throw new Error("Informe um valor válido.");
    const balance = await currentContainerBalance(ctx);
    if (args.emptyGallonsReturned > balance.emptyGallons) throw new Error(`Há apenas ${balance.emptyGallons} galão(ões) vazio(s) disponível(is) para devolver.`);
    const now = Date.now();
    const id = await ctx.db.insert("waterReceipts", {
      periodId: args.periodId,
      receivedAt: args.receivedAt,
      gallonsReceived: args.gallonsReceived,
      emptyGallonsReturned: args.emptyGallonsReturned,
      totalValueCents: args.totalValueCents,
      sourceName: args.sourceName?.trim() || undefined,
      paidByName: args.paidByName?.trim() || undefined,
      observation: args.observation?.trim() || undefined,
      createdBy: userId,
      createdAt: now,
    });
    await writeAudit(ctx, userId, "create", "waterReceipts", String(id), `Recebimento manual: ${args.gallonsReceived} galão(ões), ${args.emptyGallonsReturned} vazio(s) devolvido(s), total R$ ${(args.totalValueCents / 100).toFixed(2)}. Sem nota fiscal.`);
    return id;
  },
});

export const recordContainerMovement = mutation({
  args: {
    type: v.union(v.literal("consumption"), v.literal("return"), v.literal("adjustment")),
    date: v.number(),
    fullDelta: v.number(),
    emptyDelta: v.number(),
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requirePermission(ctx, "water.manage", { entity: "waterContainerMovements" });
    if (!Number.isSafeInteger(args.fullDelta) || !Number.isSafeInteger(args.emptyDelta)) throw new Error("As quantidades devem ser números inteiros.");
    if (args.type === "consumption" && (args.fullDelta >= 0 || args.emptyDelta !== -args.fullDelta)) {
      throw new Error("No consumo, galões cheios saem e a mesma quantidade entra como vazios.");
    }
    if (args.type === "return" && (args.fullDelta > 0 || args.emptyDelta > 0 || (args.fullDelta === 0 && args.emptyDelta === 0))) {
      throw new Error("Na devolução, informe quantos galões cheios e/ou vazios saíram para o fornecedor.");
    }
    if (args.type === "adjustment" && args.fullDelta === 0 && args.emptyDelta === 0) throw new Error("Informe ao menos uma quantidade para ajustar.");
    const balance = await currentContainerBalance(ctx);
    if (balance.fullGallons + args.fullDelta < 0) throw new Error("A movimentação deixaria o saldo de galões cheios negativo.");
    if (balance.emptyGallons + args.emptyDelta < 0) throw new Error("A movimentação deixaria o saldo de galões vazios negativo.");
    const id = await ctx.db.insert("waterContainerMovements", {
      type: args.type, date: args.date, fullDelta: args.fullDelta, emptyDelta: args.emptyDelta,
      observation: args.observation?.trim() || undefined, createdBy: userId, createdAt: Date.now(),
    });
    await writeAudit(ctx, userId, "create", "waterContainerMovements", String(id), `Galões: cheios ${args.fullDelta >= 0 ? "+" : ""}${args.fullDelta}, vazios ${args.emptyDelta >= 0 ? "+" : ""}${args.emptyDelta}.`);
    return id;
  },
});

export const closePeriod = mutation({
  args: { periodId: v.id("waterPeriods") },
  handler: async (ctx, args) => {
    const { userId } = await requirePermission(ctx, "water.manage", { entity: "waterPeriods", entityId: args.periodId });
    const period = await ctx.db.get(args.periodId);
    if (!period || period.status !== "open") throw new Error("O período não está aberto.");
    const [receipts, existingShares] = await Promise.all([
      ctx.db.query("waterReceipts").withIndex("by_period", (q) => q.eq("periodId", args.periodId)).collect(),
      ctx.db.query("waterShares").withIndex("by_period", (q) => q.eq("periodId", args.periodId)).collect(),
    ]);
    if (existingShares.length) throw new Error("Este período já possui rateio calculado.");
    const totalCents = receipts.reduce((sum, receipt) => sum + receipt.totalValueCents, 0);
    const participants = await Promise.all(period.participantIds.map((id) => ctx.db.get(id)));
    if (participants.some((participant) => !participant)) throw new Error("Há participante inválido no período.");
    const participantData = (participants.filter(Boolean) as Array<{ _id: any; name: string }>)
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    const allocations = splitWaterCostCents(totalCents, participantData.map((person) => String(person._id)));
    for (const allocation of allocations) {
      const participant = participantData.find((person) => String(person._id) === allocation.participantId);
      if (participant) {
        await ctx.db.insert("waterShares", {
          periodId: args.periodId,
          participantId: participant._id,
          participantName: participant.name,
          amountDueCents: allocation.amountDueCents,
          createdAt: Date.now(),
        });
      }
    }
    await ctx.db.patch(args.periodId, { status: "closed", closedAt: Date.now(), totalValueCents: totalCents });
    await writeAudit(ctx, userId, "update", "waterPeriods", String(args.periodId), `Período fechado. Total R$ ${(totalCents / 100).toFixed(2)} dividido entre ${participantData.length} participante(s).`);
    return { totalCents, participants: participantData.length, sharesCreated: allocations.length };
  },
});

export const recordPayment = mutation({
  args: {
    shareId: v.id("waterShares"),
    amountCents: v.number(),
    paidAt: v.number(),
    method: v.optional(v.string()),
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requirePermission(ctx, "water.manage", { entity: "waterPayments", entityId: args.shareId });
    if (!Number.isSafeInteger(args.amountCents) || args.amountCents <= 0) throw new Error("O valor do pagamento deve ser maior que zero.");
    const share = await ctx.db.get(args.shareId);
    if (!share) throw new Error("Parcela de rateio não encontrada.");
    const payments = await ctx.db.query("waterPayments").withIndex("by_share", (q) => q.eq("shareId", args.shareId)).collect();
    const paid = payments.reduce((sum, payment) => sum + payment.amountCents, 0);
    const remaining = share.amountDueCents - paid;
    if (args.amountCents > remaining) throw new Error(`O pagamento excede o saldo pendente de R$ ${(remaining / 100).toFixed(2)}.`);
    const id = await ctx.db.insert("waterPayments", {
      shareId: args.shareId, amountCents: args.amountCents, paidAt: args.paidAt,
      method: args.method?.trim() || undefined, observation: args.observation?.trim() || undefined,
      createdBy: userId, createdAt: Date.now(),
    });
    await writeAudit(ctx, userId, "create", "waterPayments", String(id), `Pagamento de R$ ${(args.amountCents / 100).toFixed(2)} registrado para ${share.participantName}.`);
    return id;
  },
});

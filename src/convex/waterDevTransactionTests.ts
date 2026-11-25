import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { calculateWaterBalances } from "../lib/water-management";

const HOST = "first-herring-264.convex.cloud";
const PREFIX = "__SIGESGD_WATER_DEV__";

function assertDev() {
  if (!(process.env.CONVEX_CLOUD_URL ?? "").includes(HOST)) {
    throw new Error("Fixture de água bloqueada: deployment diferente do Convex DEV autorizado.");
  }
}
function validateRunId(runId: string) {
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(runId)) throw new Error("Identificador de fixture inválido.");
}
function name(runId: string, suffix: string) { return `${PREFIX}${runId}__${suffix}`; }

export const seed = internalMutation({
  args: { runId: v.string() },
  handler: async (ctx, { runId }) => {
    assertDev(); validateRunId(runId);
    const users = await ctx.db.query("users").collect();
    const operator = ["admin", "stock_manager", "secretary"]
      .map((role) => users.find((u) => u.role === role && u.active !== false && u.isAnonymous !== true))
      .find(Boolean);
    if (!operator) throw new Error("Nenhum operador DEV ativo autorizado para água mineral.");
    const movements = await ctx.db.query("waterMovements").collect();
    const periods = await ctx.db.query("waterPeriods").collect();
    let start = "2099-01-01";
    const overlaps = (date: string) => periods.some((p) => date >= p.startDate && date <= p.endDate);
    while (overlaps(start)) {
      const d = new Date(`${start}T00:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      start = d.toISOString().slice(0, 10);
    }
    return { runId, operatorId: operator._id, operatorRole: operator.role,
      baseline: calculateWaterBalances(movements), periodDate: start };
  },
});

export const inspect = internalQuery({
  args: { runId: v.string() },
  handler: async (ctx, { runId }) => {
    assertDev(); validateRunId(runId);
    const [participants, movements, periods, payments] = await Promise.all([
      ctx.db.query("waterParticipants").collect(),
      ctx.db.query("waterMovements").collect(),
      ctx.db.query("waterPeriods").collect(),
      ctx.db.query("waterPayments").collect(),
    ]);
    const fixtureParticipants = participants.filter((p) => p.name.startsWith(PREFIX + runId + "__"));
    const fixtureMovements = movements.filter((m) => (m.observation ?? "").startsWith(PREFIX + runId + "__"));
    const period = periods.find((p) => p.label === name(runId, "PERIOD"));
    const periodPayments = period ? payments.filter((p) => p.periodId === period._id) : [];
    const charges = period ? await ctx.db.query("waterPeriodCharges")
      .withIndex("by_period", (q) => q.eq("periodId", period._id)).collect() : [];
    return {
      balances: calculateWaterBalances(movements),
      fixtureParticipants,
      fixtureMovements,
      period,
      charges,
      payments: periodPayments,
      audit: { participants: fixtureParticipants.length, movements: fixtureMovements.length,
        period: Boolean(period), charges: charges.length, payments: periodPayments.length },
    };
  },
});

export const cleanup = internalMutation({
  args: { runId: v.string() },
  handler: async (ctx, { runId }) => {
    assertDev(); validateRunId(runId);
    const [participants, movements, periods, payments] = await Promise.all([
      ctx.db.query("waterParticipants").collect(),
      ctx.db.query("waterMovements").collect(),
      ctx.db.query("waterPeriods").collect(),
      ctx.db.query("waterPayments").collect(),
    ]);
    const fixtureParticipants = participants.filter((p) => p.name.startsWith(PREFIX + runId + "__"));
    const fixtureMovements = movements.filter((m) => (m.observation ?? "").startsWith(PREFIX + runId + "__"));
    const period = periods.find((p) => p.label === name(runId, "PERIOD"));
    const periodPayments = period ? payments.filter((p) => p.periodId === period._id) : [];
    const charges = period ? await ctx.db.query("waterPeriodCharges")
      .withIndex("by_period", (q) => q.eq("periodId", period._id)).collect() : [];
    const ids = new Set<string>([
      ...fixtureParticipants.map((p) => String(p._id)),
      ...fixtureMovements.map((m) => String(m._id)),
      ...(period ? [String(period._id)] : []),
      ...periodPayments.map((p) => String(p._id)),
    ]);
    const entities = ["waterParticipants", "waterMovements", "waterPeriods", "waterPayments"];
    const auditRows = (await Promise.all(entities.map((entity) =>
      ctx.db.query("auditLogs").withIndex("by_entity", (q) => q.eq("entity", entity)).collect()
    ))).flat();
    for (const row of auditRows) if (row.entityId && ids.has(row.entityId)) await ctx.db.delete(row._id);
    for (const row of periodPayments) await ctx.db.delete(row._id);
    for (const row of charges) await ctx.db.delete(row._id);
    if (period) await ctx.db.delete(period._id);
    for (const row of fixtureMovements) await ctx.db.delete(row._id);
    for (const row of fixtureParticipants) await ctx.db.delete(row._id);
    const [p2, m2, period2] = await Promise.all([
      ctx.db.query("waterParticipants").collect().then((rows) => rows.some((p) => p.name.startsWith(PREFIX + runId + "__"))),
      ctx.db.query("waterMovements").collect().then((rows) => rows.some((m) => (m.observation ?? "").startsWith(PREFIX + runId + "__"))),
      ctx.db.query("waterPeriods").withIndex("by_label", (q) => q.eq("label", name(runId, "PERIOD"))).first(),
    ]);
    if (p2 || m2 || period2) throw new Error("A limpeza da fixture de água não foi concluída.");
    return { runId, fixtureRemaining: false, deleted: { participants: fixtureParticipants.length,
      movements: fixtureMovements.length, periods: Number(Boolean(period)), charges: charges.length,
      payments: periodPayments.length } };
  },
});

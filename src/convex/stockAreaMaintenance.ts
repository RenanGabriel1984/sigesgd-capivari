/**
 * Inclusão controlada das três áreas operacionais pendentes.
 *
 * Escopo fechado: cria somente Limpeza, Copa e Cozinha e Água Mineral.
 * Não altera áreas existentes, produtos, lotes, saldos, locais ou movimentos.
 */
import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

const REQUIRED_CONFIRMATION = "CRIAR-3-AREAS-OPERACIONAIS-FIRST-HERRING";
const EXPECTED_EXISTING = ["Impressoras", "TI Geral"];
const AREAS_TO_CREATE = [
  {
    name: "Limpeza",
    description: "Materiais de limpeza e higiene, com unidade de medida e validade quando aplicável.",
  },
  {
    name: "Copa e Cozinha",
    description: "Alimentos, bebidas, descartáveis e utensílios de copa e cozinha.",
  },
  {
    name: "Água Mineral",
    description: "Controle físico e financeiro de água mineral, com compras, galões cheios e vazios e rateio próprio.",
  },
] as const;

export const ensureOfficialOperationalAreasInternal = internalMutation({
  args: { confirmation: v.string() },
  handler: async (ctx, args) => {
    if (args.confirmation !== REQUIRED_CONFIRMATION) {
      throw new Error("Confirmação inválida. Nenhuma área foi criada.");
    }

    const existing = await ctx.db.query("stockAreas").collect();
    const normalized = (name: string) => name.trim().toLocaleLowerCase("pt-BR");
    const counts = new Map<string, number>();
    for (const area of existing) {
      const key = normalized(area.name);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    // Abortagem conservadora: o estado precisa corresponder ao retrato
    // auditado antes da autorização. Não tenta corrigir nem renomear registros.
    if (existing.length !== EXPECTED_EXISTING.length) {
      throw new Error(
        `Pré-condição alterada: esperadas exatamente 2 áreas existentes; encontradas ${existing.length}. Nada foi alterado.`,
      );
    }
    for (const name of EXPECTED_EXISTING) {
      if (counts.get(normalized(name)) !== 1) {
        throw new Error(`Pré-condição alterada para "${name}". Nada foi alterado.`);
      }
    }
    for (const area of AREAS_TO_CREATE) {
      if (counts.has(normalized(area.name))) {
        throw new Error(`A área "${area.name}" já existe ou está duplicada. Nada foi alterado.`);
      }
    }

    const created: Array<{ id: string; name: string }> = [];
    const timestamp = Date.now();
    for (const area of AREAS_TO_CREATE) {
      const id = await ctx.db.insert("stockAreas", {
        name: area.name,
        description: area.description,
        active: true,
      });
      await ctx.db.insert("auditLogs", {
        action: "create",
        entity: "stockAreas",
        entityId: String(id),
        details: JSON.stringify({
          operation: "authorized_operational_area_creation",
          actor: "automated_maintenance_internal",
          actorUserId: null,
          source: "explicit_user_authorization",
          areaName: area.name,
          scope: "create_area_only_no_stock_changes",
        }),
        timestamp,
      });
      created.push({ id: String(id), name: area.name });
    }

    return {
      applied: true,
      deployment: "dev:first-herring-264",
      created,
      createdCount: created.length,
      auditLogsCreated: created.length,
      existingAreasChanged: 0,
      productsChanged: 0,
      lotsChanged: 0,
      balancesChanged: 0,
      locationsChanged: 0,
      movementsChanged: 0,
    };
  },
});

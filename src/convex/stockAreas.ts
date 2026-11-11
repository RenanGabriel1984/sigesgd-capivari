import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { BASELINE_STOCK_AREAS, NO_AREA_LABEL } from "../lib/stock-areas";
import { requirePermission } from "./rbac";

type UserRole = "admin" | "stock_manager" | "director" | "secretary" | "technician";

async function requireUser(ctx: any) {
  // RBAC central: visualização de áreas/subestoques.
  return requirePermission(ctx, "areas.view");
}

async function requireStockManagerOrAdmin(ctx: any) {
  // RBAC central: gerenciamento de áreas/subestoques.
  return requirePermission(ctx, "areas.manage", { entity: "stockAreas" });
}

/**
 * ÁREAS / SUBESTOQUES — conceito INDEPENDENTE de fornecedor e categoria.
 *
 * A área "Impressoras", por exemplo, pode receber material de QUALQUER
 * fornecedor: o nome da área nunca contém fornecedor, o mesmo produto pode
 * existir em áreas diferentes e o fornecedor de cada entrada permanece no
 * histórico (nova licitação ≠ nova estrutura).
 */

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return await ctx.db.query("stockAreas").order("asc").collect();
  },
});

export const listActive = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return await ctx.db
      .query("stockAreas")
      .withIndex("by_active", (q: any) => q.eq("active", true))
      .order("asc")
      .collect();
  },
});

/**
 * Resumo (SOMENTE LEITURA) do estoque disponível por área/subestoque.
 *
 * Deriva dos lotes existentes (lots.areaId) — não cria saldo paralelo nem
 * duplica a fonte da verdade: o saldo continua sendo o dos lotes/estoque.
 * Lotes sem área aparecem como estoque geral ("Sem área").
 */
export const summary = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const areas = await ctx.db.query("stockAreas").collect();
    const lots = await ctx.db.query("lots").collect();
    const reservationsByLot = new Map<string, number>();
    for (const lot of lots) {
      const reservations = await ctx.db.query("requestItemReservations")
        .withIndex("by_lot", (q: any) => q.eq("lotId", lot._id)).collect();
      reservationsByLot.set(lot._id as string,
        reservations.reduce((sum: number, reservation: any) => sum + reservation.quantityRemaining, 0));
    }

    const buckets = new Map<
      string,
      { areaId: string | null; name: string; active: boolean; description: string | null; lots: number; quantityAvailable: number; quantityReserved: number; quantityReceived: number }
    >();

    for (const area of areas) {
      buckets.set(area._id as string, {
        areaId: area._id as string,
        name: area.name,
        active: area.active,
        description: area.description ?? null,
        lots: 0,
        quantityAvailable: 0,
        quantityReserved: 0,
        quantityReceived: 0,
      });
    }

    for (const lot of lots) {
      // Área classifica o material; localização informa somente onde está guardado.
      // Um mesmo armário pode conter lotes de áreas diferentes.
      const key = lot.areaId && buckets.has(lot.areaId as string)
        ? lot.areaId as string
        : "none";
      const current =
        buckets.get(key) ??
        {
          areaId: null,
          name: NO_AREA_LABEL,
          active: true,
          description: null,
          lots: 0,
          quantityAvailable: 0,
          quantityReserved: 0,
          quantityReceived: 0,
        };
      current.lots += 1;
      const reserved = reservationsByLot.get(lot._id as string) ?? 0;
      current.quantityReserved += reserved;
      current.quantityAvailable += Math.max(0, lot.quantityAvailable - reserved);
      current.quantityReceived += lot.quantityReceived;
      buckets.set(key, current);
    }

    return Array.from(buckets.values()).sort((a, b) => {
      if (a.areaId === null) return 1;
      if (b.areaId === null) return -1;
      return a.name.localeCompare(b.name, "pt-BR");
    });
  },
});

/**
 * Garante as áreas de referência da estrutura oficial (TI Geral, Impressoras).
 *
 * IDEMPOTENTE: só cria o que ainda não existe pelo nome; nunca renomeia,
 * nunca apaga e nunca toca em estoque, lotes ou movimentações. Cada criação
 * gera registro de auditoria.
 */
/**
 * Lotes com saldo que ainda não têm uma combinação consistente de área e local.
 * A consulta é somente leitura e fornece contexto para classificação manual.
 */
export const unclassifiedLots = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const lots = await ctx.db.query("lots").collect();
    const pending = [];
    for (const lot of lots) {
      if (!lot.active || lot.quantityAvailable <= 0) continue;
      const location = lot.locationId ? await ctx.db.get(lot.locationId) : null;
      const area = lot.areaId ? await ctx.db.get(lot.areaId) : null;
      const consistent = !!area?.active && !!lot.locationId && !!location?.active;
      if (consistent) continue;

      const product = await ctx.db.get(lot.productId);
      const entry = await ctx.db.get(lot.entryId);
      const entryItems = await ctx.db.query("entryItems")
        .withIndex("by_entry", (q: any) => q.eq("entryId", lot.entryId)).collect();
      const entryItem = entryItems.find((item: any) =>
        item.lotId === lot._id || item.lotId === lot.lotNumber
      ) ?? null;
      const currentArea = lot.areaId ? await ctx.db.get(lot.areaId) : null;
      const suggestedLocationId = lot.locationId ?? entryItem?.locationId ?? null;
      // Nunca inferir a área a partir do armário. A entrada/item pode fornecer
      // a área de negócio; caso contrário, a classificação exige escolha explícita.
      const suggestedAreaId = lot.areaId ?? entryItem?.areaId ?? entry?.areaId ?? null;

      pending.push({
        lotId: lot._id,
        lotNumber: lot.lotNumber,
        productId: lot.productId,
        productName: product?.name ?? "Produto não encontrado",
        quantityAvailable: lot.quantityAvailable,
        quantityReceived: lot.quantityReceived,
        entryNumber: entry?.entryNumber ?? null,
        invoiceNumber: lot.invoiceNumber ?? entry?.invoiceNumber ?? null,
        currentAreaName: currentArea?.name ?? null,
        currentLocationName: location?.name ?? null,
        suggestedAreaId,
        suggestedLocationId,
        areaMissing: !lot.areaId || !currentArea?.active,
        locationMissing: !lot.locationId || !location?.active,
      });
    }
    return pending.sort((a, b) => a.productName.localeCompare(b.productName, "pt-BR") ||
      a.lotNumber.localeCompare(b.lotNumber));
  },
});

/**
 * Classifica explicitamente um lote legado na área/local selecionados.
 * O saldo global não muda. A quantidade é retirada do saldo local legado
 * (sem área) e adicionada ao saldo da área somente quando a conferência fecha.
 */
export const classifyLot = mutation({
  args: {
    lotId: v.id("lots"),
    areaId: v.id("stockAreas"),
    locationId: v.id("storageLocations"),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireStockManagerOrAdmin(ctx);
    const lot = await ctx.db.get(args.lotId);
    if (!lot || !lot.active) throw new Error("Lote não encontrado ou inativo.");
    if (!Number.isFinite(lot.quantityAvailable) || lot.quantityAvailable <= 0) {
      throw new Error("O lote não possui saldo disponível para classificação.");
    }
    const area = await ctx.db.get(args.areaId);
    const location = await ctx.db.get(args.locationId);
    if (!area || !area.active || !location || !location.active) {
      throw new Error("Selecione uma área/subestoque e um local físico ativos.");
    }
    if (lot.areaId && lot.areaId !== args.areaId) {
      throw new Error("O lote já possui outra área. Use uma transferência de estoque para mudar de área.");
    }
    if (lot.locationId && lot.locationId !== args.locationId) {
      throw new Error("O lote já possui outro local físico. Use uma transferência para mudar o local.");
    }

    const reservations = await ctx.db.query("requestItemReservations")
      .withIndex("by_lot", (q: any) => q.eq("lotId", lot._id)).collect();
    const reserved = reservations.reduce((sum: number, item: any) => sum + item.quantityRemaining, 0);
    if (reserved > 0) {
      throw new Error("Este lote possui unidades reservadas por solicitações. Conclua ou cancele essas solicitações antes de classificá-lo.");
    }

    const entryItems = await ctx.db.query("entryItems")
      .withIndex("by_entry", (q: any) => q.eq("entryId", lot.entryId)).collect();
    const linkedEntryItem = entryItems.find((item: any) =>
      item.lotId === lot._id || item.lotId === lot.lotNumber
    );
    const sourceLocationId = lot.locationId ?? linkedEntryItem?.locationId ?? args.locationId;
    if (sourceLocationId !== args.locationId) {
      throw new Error("O local registrado para este lote difere do local selecionado. Faça uma transferência física auditável antes da classificação.");
    }
    if (linkedEntryItem?.areaId && linkedEntryItem.areaId !== args.areaId) {
      throw new Error("O item da entrada já possui outra área registrada. Confira a origem documental antes de reclassificar o lote.");
    }

    const lotMovements = (await ctx.db.query("stockMovements")
      .withIndex("by_product", (q: any) => q.eq("productId", lot.productId))
      .collect())
      .filter((movement: any) => movement.lotId === lot._id || movement.lotId === lot.lotNumber);
    if (lotMovements.some((movement: any) =>
      (movement.areaId && movement.areaId !== args.areaId) ||
      (movement.locationId && movement.locationId !== args.locationId)
    )) {
      throw new Error("Há movimentação histórica com área/local divergente deste lote. Regularize a trilha documental antes de classificar.");
    }
    const movementLotLinks = await ctx.db.query("stockMovementLots")
      .withIndex("by_lot", (q: any) => q.eq("lotId", lot._id)).collect();
    if (movementLotLinks.some((link: any) =>
      (link.areaId && link.areaId !== args.areaId) ||
      (link.locationId && link.locationId !== args.locationId)
    )) {
      throw new Error("Há vínculo de movimentação por lote com área/local divergente. Regularize a trilha antes de classificar.");
    }

    const productStock = await ctx.db.query("stock")
      .withIndex("by_product", (q: any) => q.eq("productId", lot.productId)).first();
    if (!productStock) throw new Error("Registro global de estoque não encontrado; classificação cancelada.");
    const productReservations = await ctx.db.query("requestItemReservations")
      .withIndex("by_product", (q: any) => q.eq("productId", lot.productId)).collect();
    const areaReserved = productReservations.reduce((sum: number, item: any) => sum + item.quantityRemaining, 0);
    const legacyReserved = Math.max(0, productStock.reservedQuantity - areaReserved);
    if (legacyReserved > 0) {
      throw new Error("Há solicitações antigas aprovadas sem reserva por lote para este produto. Conclua ou cancele essas solicitações antes de classificar o saldo.");
    }

    const rows = await ctx.db.query("stockByLocation")
      .withIndex("by_product", (q: any) => q.eq("productId", lot.productId)).collect();
    const targetRow = rows.find((row: any) =>
      row.locationId === args.locationId && row.areaId === args.areaId
    );
    const alreadyClassifiedRow = rows.find((row: any) =>
      row.locationId === args.locationId && row.areaId === lot.areaId && !!lot.areaId
    );
    const legacyRows = rows.filter((row: any) =>
      row.locationId === args.locationId && !row.areaId
    );
    const legacyQuantity = legacyRows.reduce((sum: number, row: any) => sum + row.quantity, 0);

    // Se o lote já possuía área e faltava somente a localização, o saldo pode
    // já estar no bucket classificado. Caso contrário, precisa existir saldo legado.
    const balanceAlreadyClassified = !!lot.areaId && !!alreadyClassifiedRow &&
      alreadyClassifiedRow.quantity >= lot.quantityAvailable && legacyQuantity === 0;
    if (targetRow && legacyQuantity > 0) {
      throw new Error("Existem saldos legados e classificados simultaneamente neste produto/local. A classificação automática é ambígua; confira o inventário antes de prosseguir.");
    }
    if (!balanceAlreadyClassified && legacyQuantity < lot.quantityAvailable) {
      throw new Error(
        `O saldo legado deste produto/local (${legacyQuantity}) é menor que o saldo do lote (${lot.quantityAvailable}). Nenhuma classificação foi aplicada.`
      );
    }

    if (!balanceAlreadyClassified) {
      let amountToMove = lot.quantityAvailable;
      for (const legacyRow of legacyRows) {
        if (amountToMove <= 0) break;
        const move = Math.min(legacyRow.quantity, amountToMove);
        await ctx.db.patch(legacyRow._id, { quantity: legacyRow.quantity - move });
        amountToMove -= move;
      }
      if (targetRow) {
        await ctx.db.patch(targetRow._id, { quantity: targetRow.quantity + lot.quantityAvailable });
      } else {
        await ctx.db.insert("stockByLocation", {
          productId: lot.productId,
          locationId: args.locationId,
          areaId: args.areaId,
          quantity: lot.quantityAvailable,
        });
      }
    }

    await ctx.db.patch(lot._id, { areaId: args.areaId, locationId: args.locationId });
    if (linkedEntryItem && linkedEntryItem.areaId !== args.areaId) {
      await ctx.db.patch(linkedEntryItem._id, { areaId: args.areaId });
    }
    for (const movement of lotMovements) {
      if (movement.areaId !== args.areaId || movement.locationId !== args.locationId) {
        await ctx.db.patch(movement._id, {
          areaId: args.areaId,
          locationId: args.locationId,
        });
      }
    }
    for (const link of movementLotLinks) {
      if (link.areaId !== args.areaId || link.locationId !== args.locationId) {
        await ctx.db.patch(link._id, {
          areaId: args.areaId,
          locationId: args.locationId,
        });
      }
    }

    // Movimentos multi-lote não têm um único lotId. Só recebem área/local
    // quando TODOS os lotes vinculados já concordam com a mesma combinação.
    const relatedMovementIds = [...new Set(movementLotLinks.map((link: any) => link.movementId as string))];
    for (const movementId of relatedMovementIds) {
      const allLinks = await ctx.db.query("stockMovementLots")
        .withIndex("by_movement", (q: any) => q.eq("movementId", movementId as any)).collect();
      const linkedPairs: Array<{ areaId: string; locationId: string }> = [];
      for (const link of allLinks) {
        const isCurrentLot = link.lotId === lot._id;
        const linkedLot: any = isCurrentLot ? lot : await ctx.db.get(link.lotId);
        const linkedAreaId = isCurrentLot ? args.areaId : linkedLot?.areaId;
        const linkedLocationId = isCurrentLot ? args.locationId : linkedLot?.locationId;
        if (!linkedAreaId || !linkedLocationId) continue;
        linkedPairs.push({
          areaId: linkedAreaId as string,
          locationId: linkedLocationId as string,
        });
      }
      if (linkedPairs.length !== allLinks.length || linkedPairs.length === 0) continue;
      const common = linkedPairs[0];
      if (linkedPairs.some((pair) => pair.areaId !== common.areaId || pair.locationId !== common.locationId)) continue;
      const movement: any = await ctx.db.get(movementId as any);
      if (!movement) continue;
      if (
        (movement.areaId && movement.areaId !== common.areaId) ||
        (movement.locationId && movement.locationId !== common.locationId)
      ) {
        throw new Error("A movimentação multi-lote possui área/local divergente dos lotes vinculados.");
      }
      if (movement.areaId !== common.areaId || movement.locationId !== common.locationId) {
        await ctx.db.patch(movement._id, {
          areaId: common.areaId as any,
          locationId: common.locationId as any,
        });
      }
    }
    await ctx.db.insert("auditLogs", {
      userId,
      action: "update",
      entity: "lots",
      entityId: lot._id,
      details: `Classificação manual do lote ${lot.lotNumber}: ${lot.quantityAvailable} unidade(s) → ${area.name} / ${location.name}. Item de entrada e ${lotMovements.length} movimentação(ões) vinculados; saldo global inalterado.`,
      timestamp: Date.now(),
    });
    return lot._id;
  },
});

export const ensureBaselineAreas = mutation({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireStockManagerOrAdmin(ctx);
    const created: string[] = [];
    const skipped: string[] = [];

    for (const area of BASELINE_STOCK_AREAS) {
      const existing = await ctx.db
        .query("stockAreas")
        .withIndex("by_name", (q: any) => q.eq("name", area.name))
        .first();
      if (existing) {
        skipped.push(area.name);
        continue;
      }
      const id = await ctx.db.insert("stockAreas", {
        name: area.name,
        description: area.description,
        active: true,
      });
      await ctx.db.insert("auditLogs", {
        userId,
        action: "create",
        entity: "stockAreas",
        entityId: id as string,
        details: `Área/Subestoque "${area.name}" garantida pela estrutura oficial (sem fornecedor no nome)`,
        timestamp: Date.now(),
      });
      created.push(area.name);
    }

    return { created, skipped };
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireStockManagerOrAdmin(ctx);
    const name = args.name.trim();
    if (!name) throw new Error("Nome da área é obrigatório");

    const existing = await ctx.db
      .query("stockAreas")
      .withIndex("by_name", (q: any) => q.eq("name", name))
      .first();
    if (existing) throw new Error(`Já existe uma área/subestoque chamado "${name}"`);

    const id = await ctx.db.insert("stockAreas", {
      name,
      description: args.description?.trim() || undefined,
      active: true,
    });
    await ctx.db.insert("auditLogs", {
      userId,
      action: "create",
      entity: "stockAreas",
      entityId: id,
      details: `Área/Subestoque "${name}" criada`,
      timestamp: Date.now(),
    });
    return id;
  },
});

export const update = mutation({
  args: {
    id: v.id("stockAreas"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireStockManagerOrAdmin(ctx);
    const area = await ctx.db.get(args.id);
    if (!area) throw new Error("Área não encontrada");

    const updates: Record<string, unknown> = {};
    if (args.name !== undefined) {
      const name = args.name.trim();
      if (!name) throw new Error("Nome da área é obrigatório");
      if (name !== area.name) {
        const dup = await ctx.db
          .query("stockAreas")
          .withIndex("by_name", (q: any) => q.eq("name", name))
          .first();
        if (dup) throw new Error(`Já existe uma área/subestoque chamado "${name}"`);
      }
      updates.name = name;
    }
    if (args.description !== undefined) updates.description = args.description.trim() || undefined;
    if (args.active !== undefined) {
      if (args.active === false) {
        const lots = await ctx.db.query("lots").collect();
        if (lots.some((lot: any) => lot.areaId === args.id && lot.active && lot.quantityAvailable > 0)) {
          throw new Error("Não é possível desativar uma área que ainda possui lotes com saldo. Transfira ou regularize o estoque primeiro.");
        }
      }
      updates.active = args.active;
    }

    await ctx.db.patch(args.id, updates);
    const action = args.active === false ? "deactivate" : args.active === true ? "activate" : "update";
    await ctx.db.insert("auditLogs", {
      userId,
      action,
      entity: "stockAreas",
      entityId: args.id,
      details: `Área/Subestoque "${updates.name ?? area.name}" — ${JSON.stringify(updates)}`,
      timestamp: Date.now(),
    });
    return args.id;
  },
});

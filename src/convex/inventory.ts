import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requirePermission } from "./rbac";

type UserRole = "admin" | "stock_manager" | "director" | "secretary" | "technician";

async function requireUser(ctx: any) {
  // RBAC central: consultas de inventário.
  return requirePermission(ctx, "stock.view");
}

async function requireStockManagerOrAdmin(ctx: any) {
  // RBAC central: operações de inventário (abrir, contar, fechar).
  return requirePermission(ctx, "inventory.manage", { entity: "inventories" });
}

/** Generate sequential inventory number: INV-ANO-SEQUENCIAL */
async function generateInventoryNumber(ctx: any): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;
  const existing = await ctx.db.query("inventories").collect();
  const maxNum = existing.reduce((max: number, inv: any) => {
    const match = inv.inventoryNumber.match(/^INV-\d{4}-(\d+)$/);
    if (match) {
      const num = parseInt(match[1], 10);
      return num > max ? num : max;
    }
    return max;
  }, 0);
  return `INV-${year}-${String(maxNum + 1).padStart(4, "0")}`;
}

// ─── Queries ─────────────────────────────────────────────────────────────────

async function decorateInventory(ctx: any, inv: any) {
  const responsible = await ctx.db.get(inv.responsibleUserId);
  const closedBy = inv.closedByUserId ? await ctx.db.get(inv.closedByUserId) : null;
  const location = inv.locationId ? await ctx.db.get(inv.locationId) : null;
  const area = inv.areaId ? await ctx.db.get(inv.areaId) : null;
  const category = inv.categoryId ? await ctx.db.get(inv.categoryId) : null;
  const counts = await ctx.db.query("inventoryCounts").withIndex("by_inventory", (q: any) => q.eq("inventoryId", inv._id)).collect();
  const countsWithProduct = await Promise.all(counts.map(async (c: any) => {
    const product = await ctx.db.get(c.productId);
    return { ...c, product };
  }));
  return { ...inv, responsible, closedBy, location, area, category, counts: countsWithProduct };
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const inventories = await ctx.db.query("inventories").withIndex("by_date").order("desc").collect();
    return Promise.all(inventories.map((inv) => decorateInventory(ctx, inv)));
  },
});

export const get = query({
  args: { inventoryId: v.id("inventories") },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const inv = await ctx.db.get(args.inventoryId);
    if (!inv) return null;
    return decorateInventory(ctx, inv);
  },
});

// ─── Mutations ───────────────────────────────────────────────────────────────

async function generateInventoryAdjustmentEntryNumber(ctx: any): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `ENT-${year}-`;
  const existing = await ctx.db.query("entries")
    .withIndex("by_number", (q: any) => q.gte("entryNumber", prefix)).collect();
  const max = existing.reduce((value: number, entry: any) => {
    const match = /^ENT-\d{4}-(\d+)$/.exec(entry.entryNumber);
    if (!match || !entry.entryNumber.startsWith(prefix)) return value;
    const n = Number(match[1]);
    return Number.isSafeInteger(n) && n > value ? n : value;
  }, 0);
  return `${prefix}${String(max + 1).padStart(6, "0")}`;
}

async function generateInventoryAdjustmentLotNumber(ctx: any): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `LOT-${year}-`;
  const existing = await ctx.db.query("lots")
    .withIndex("by_number", (q: any) => q.gte("lotNumber", prefix)).collect();
  const max = existing.reduce((value: number, lot: any) => {
    const match = /^LOT-\d{4}-(\d+)$/.exec(lot.lotNumber);
    if (!match || !lot.lotNumber.startsWith(prefix)) return value;
    const n = Number(match[1]);
    return Number.isSafeInteger(n) && n > value ? n : value;
  }, 0);
  return `${prefix}${String(max + 1).padStart(6, "0")}`;
}

/** Create a new inventory in DRAFT status. Populates counts with all active products. */
export const create = mutation({
  args: {
    observation: v.optional(v.string()),
    locationId: v.optional(v.id("storageLocations")),
    areaId: v.optional(v.id("stockAreas")),
    categoryId: v.optional(v.id("categories")),
    productIds: v.optional(v.array(v.id("products"))),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireStockManagerOrAdmin(ctx);

    // Check no active inventory exists
    const allInventories = await ctx.db.query("inventories").collect();
    const nonClosed = allInventories.filter((i) => i.status !== "cancelled" && i.status !== "closed");
    if (nonClosed.length > 0) {
      throw new Error("Já existe um inventário ativo. Finalize ou cancele o inventário anterior antes de criar um novo.");
    }

    // ── Validar escopo ──
    if (!!args.locationId !== !!args.areaId) {
      throw new Error("Para inventário por localização, selecione a área e o local físico. Para inventário geral, deixe ambos vazios.");
    }
    if (args.locationId) {
      const location = await ctx.db.get(args.locationId);
      if (!location) throw new Error("Local de armazenamento não encontrado");
      if (!location.active) throw new Error("O local de armazenamento selecionado está inativo");
      const area = await ctx.db.get(args.areaId!);
      if (!area || !area.active) throw new Error("A área/subestoque selecionada está inativa ou não existe.");
    }
    if (args.categoryId) {
      const category = await ctx.db.get(args.categoryId);
      if (!category) throw new Error("Categoria não encontrada");
      if (!category.active) throw new Error("A categoria selecionada está inativa");
    }

    const now = Date.now();
    const inventoryNumber = await generateInventoryNumber(ctx);

    const inventoryId = await ctx.db.insert("inventories", {
      inventoryNumber,
      date: now,
      responsibleUserId: userId,
      status: "draft",
      observation: args.observation || undefined,
      locationId: args.locationId,
      areaId: args.areaId,
      categoryId: args.categoryId,
      productIds: args.productIds && args.productIds.length > 0 ? args.productIds : undefined,
      createdAt: now,
      updatedAt: now,
    });

    // ── Populate counts conforme o escopo ──
    let products = await ctx.db.query("products").withIndex("by_active", (q) => q.eq("active", true)).collect();
    if (args.categoryId) products = products.filter((p) => p.categoryId === args.categoryId);
    if (args.productIds && args.productIds.length > 0) {
      const selected = new Set(args.productIds);
      products = products.filter((p) => selected.has(p._id));
    }

    const scopeLabel = [
      args.locationId ? `área ${args.areaId} / local ${args.locationId}` : "todos os locais e áreas",
      args.categoryId ? `categoria ${args.categoryId}` : "",
      args.productIds && args.productIds.length > 0 ? `${args.productIds.length} produto(s) selecionado(s)` : "",
    ].filter(Boolean).join(", ");

    for (const product of products) {
      const stock = await ctx.db.query("stock").withIndex("by_product", (q: any) => q.eq("productId", product._id)).first();
      let systemQuantity = stock?.physicalQuantity ?? 0;
      if (args.locationId) {
        const sbls = await ctx.db.query("stockByLocation").withIndex("by_product", (q: any) => q.eq("productId", product._id)).collect();
        systemQuantity = sbls
          .filter((s: any) => s.locationId === args.locationId && s.areaId === args.areaId)
          .reduce((sum: number, s: any) => sum + s.quantity, 0);
      }
      await ctx.db.insert("inventoryCounts", {
        inventoryId,
        productId: product._id,
        systemQuantity,
      });
    }

    await ctx.db.insert("auditLogs", {
      userId, action: "open_inventory", entity: "inventories", entityId: inventoryId,
      details: `Inventário ${inventoryNumber} aberto com ${products.length} itens para contagem (${scopeLabel})`,
      timestamp: now,
    });

    return inventoryId;
  },
});

/** Update inventory status to COUNTING. */
export const startCounting = mutation({
  args: { inventoryId: v.id("inventories") },
  handler: async (ctx, args) => {
    const { userId } = await requireStockManagerOrAdmin(ctx);
    const inv = await ctx.db.get(args.inventoryId);
    if (!inv) throw new Error("Inventário não encontrado");
    if (inv.status !== "draft") throw new Error("Inventário deve estar em rascunho para iniciar contagem");

    await ctx.db.patch(args.inventoryId, { status: "counting", updatedAt: Date.now() });

    await ctx.db.insert("auditLogs", {
      userId, action: "count_inventory", entity: "inventories", entityId: args.inventoryId,
      details: `Inventário ${inv.inventoryNumber} — contagem iniciada`, timestamp: Date.now(),
    });
  },
});

/** Save a count for a specific product in the inventory. */
export const saveCount = mutation({
  args: {
    countId: v.id("inventoryCounts"),
    countedQuantity: v.number(),
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireStockManagerOrAdmin(ctx);
    const count = await ctx.db.get(args.countId);
    if (!count) throw new Error("Registro de contagem não encontrado");

    const inv = await ctx.db.get(count.inventoryId);
    if (!inv) throw new Error("Inventário não encontrado");
    if (inv.status !== "counting" && inv.status !== "review") {
      throw new Error("Inventário deve estar em contagem ou revisão para registrar contagem");
    }

    if (args.countedQuantity < 0) throw new Error("A quantidade contada não pode ser negativa");

    const difference = args.countedQuantity - count.systemQuantity;

    await ctx.db.patch(args.countId, {
      countedQuantity: args.countedQuantity,
      difference,
      observation: args.observation || undefined,
    });

    await ctx.db.insert("auditLogs", {
      userId, action: "count_inventory", entity: "inventoryCounts", entityId: args.countId,
      details: `Contagem: produto ${count.productId}, sistema ${count.systemQuantity}, contado ${args.countedQuantity}, diferença ${difference >= 0 ? "+" : ""}${difference}`,
      timestamp: Date.now(),
    });
  },
});

/** Move inventory to REVIEW status. */
export const startReview = mutation({
  args: { inventoryId: v.id("inventories") },
  handler: async (ctx, args) => {
    const { userId } = await requireStockManagerOrAdmin(ctx);
    const inv = await ctx.db.get(args.inventoryId);
    if (!inv) throw new Error("Inventário não encontrado");
    if (inv.status !== "counting") throw new Error("Inventário deve estar em contagem para iniciar revisão");

    // Validate all counts have been filled
    const counts = await ctx.db.query("inventoryCounts").withIndex("by_inventory", (q: any) => q.eq("inventoryId", args.inventoryId)).collect();
    const uncounted = counts.filter((c) => c.countedQuantity === null || c.countedQuantity === undefined);
    if (uncounted.length > 0) {
      throw new Error(`${uncounted.length} item(ns) ainda não foram contados. Registre a contagem de todos os itens antes de revisar.`);
    }

    await ctx.db.patch(args.inventoryId, { status: "review", updatedAt: Date.now() });
  },
});

/**
 * Close inventory: generate adjustment movements for all differences.
 * This is an atomic operation.
 */
export const close = mutation({
  args: {
    inventoryId: v.id("inventories"),
    justification: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId, user } = await requireStockManagerOrAdmin(ctx);
    const role = (user.role ?? "technician") as UserRole;
    if (role !== "admin" && role !== "stock_manager") {
      throw new Error("Apenas administradores e responsáveis pelo estoque podem fechar inventário");
    }

    const justification = (args.justification ?? "").trim();
    if (!justification) throw new Error("A justificativa do fechamento é obrigatória (ajuste de saldo auditável)");

    const inv = await ctx.db.get(args.inventoryId);
    if (!inv) throw new Error("Inventário não encontrado");
    if (inv.status !== "review") throw new Error("Inventário deve estar em revisão para ser fechado");
    if (inv.locationId && !inv.areaId) {
      throw new Error("Este inventário foi criado antes do escopo por área. Cancele-o e abra outro selecionando área e local físico.");
    }

    const counts = await ctx.db.query("inventoryCounts")
      .withIndex("by_inventory", (q: any) => q.eq("inventoryId", args.inventoryId)).collect();
    const changedCounts = counts.filter((count: any) =>
      count.countedQuantity !== undefined &&
      count.countedQuantity !== null &&
      Number(count.countedQuantity) !== Number(count.systemQuantity),
    );
    const now = Date.now();
    const locationScope = inv.locationId ? await ctx.db.get(inv.locationId) : null;
    if (inv.locationId && (!locationScope || !locationScope.active)) {
      throw new Error("O local físico deste inventário não existe ou está inativo.");
    }
    const scopeSuffix = locationScope ? ` no local "${locationScope.name}"` : "";
    const adjustmentDetails: string[] = [];

    for (const count of changedCounts as any[]) {
      const product: any = await ctx.db.get(count.productId);
      if (!product) throw new Error("Produto do inventário não encontrado.");
      const counted = Number(count.countedQuantity);
      const snapshot = Number(count.systemQuantity);
      if (!Number.isFinite(counted) || counted < 0 || !Number.isFinite(snapshot) || snapshot < 0) {
        throw new Error(`Contagem inválida para "${product.name}".`);
      }
      const delta = counted - snapshot;
      if (Math.abs(Number(count.difference ?? 0) - delta) > 1e-9) {
        throw new Error(`A contagem de "${product.name}" mudou após o cálculo da diferença. Salve a contagem novamente antes de fechar.`);
      }

      const [stock, lots, locationRows, reservations] = await Promise.all([
        ctx.db.query("stock").withIndex("by_product", (q: any) => q.eq("productId", count.productId)).first(),
        ctx.db.query("lots").withIndex("by_product", (q: any) => q.eq("productId", count.productId)).collect(),
        ctx.db.query("stockByLocation").withIndex("by_product", (q: any) => q.eq("productId", count.productId)).collect(),
        ctx.db.query("requestItemReservations").withIndex("by_product", (q: any) => q.eq("productId", count.productId)).collect(),
      ]);

      const previousPhysical = Number(stock?.physicalQuantity ?? 0);
      const previousReserved = Number(stock?.reservedQuantity ?? 0);
      const lotById = new Map<string, any>();
      for (const lot of lots as any[]) {
        const quantityAvailable = Number(lot.quantityAvailable);
        if (!Number.isFinite(quantityAvailable) || quantityAvailable < 0) {
          throw new Error(`Lote inválido encontrado para "${product.name}".`);
        }
        if (lot.active === false && quantityAvailable > 0) {
          throw new Error(`Há lote inativo com saldo positivo para "${product.name}". Regularize antes do inventário.`);
        }
        lotById.set(String(lot._id), lot);
      }
      const materialType = (lots as any[]).find((lot: any) => lot.materialType)?.materialType;
      if (product.hasSerial === true || materialType === "permanent") {
        throw new Error(`O produto "${product.name}" exige controle patrimonial individual. Faça a conferência/regularização pelo cadastro de equipamentos, não por ajuste agregado de estoque.`);
      }
      const lotTotal = lots.reduce((sum: number, lot: any) => sum + Number(lot.quantityAvailable), 0);
      if (Math.abs(lotTotal - previousPhysical) > 1e-9) {
        throw new Error(`Integridade de "${product.name}": saldo global (${previousPhysical}) diverge dos lotes (${lotTotal}). Regularize antes de fechar o inventário.`);
      }

      const reservationTotal = reservations.reduce((sum: number, reservation: any) => {
        const remaining = Number(reservation.quantityRemaining);
        const reservedLot = lotById.get(String(reservation.lotId));
        if (!Number.isFinite(remaining) || remaining < 0 || !reservedLot || reservedLot.productId !== count.productId) {
          throw new Error(`Há reserva inválida ou sem lote correspondente para "${product.name}".`);
        }
        if (remaining > 0 && (
          reservation.areaId !== reservedLot.areaId ||
          reservation.locationId !== reservedLot.locationId ||
          remaining > Number(reservedLot.quantityAvailable)
        )) {
          throw new Error(`A reserva de "${product.name}" não corresponde à área/local ou excede o saldo do lote.`);
        }
        return sum + remaining;
      }, 0);
      if (Math.abs(reservationTotal - previousReserved) > 1e-9) {
        throw new Error(`As reservas por lote de "${product.name}" divergem do saldo reservado global. Regularize as solicitações antes do inventário.`);
      }

      // Confere a representação por área/local antes de permitir qualquer ajuste.
      const rowGroups = new Map<string, any[]>();
      for (const row of locationRows as any[]) {
        const key = `${String(row.areaId ?? "")}|${String(row.locationId)}`;
        const group = rowGroups.get(key) ?? [];
        group.push(row);
        rowGroups.set(key, group);
      }
      for (const [key, rows] of rowGroups) {
        if (rows.length !== 1) {
          throw new Error(`Há saldos duplicados de "${product.name}" para uma combinação de área/local (${key}). Regularize antes do inventário.`);
        }
      }
      const lotsByScope = new Map<string, number>();
      for (const lot of lots as any[]) {
        if (!lot.locationId) continue;
        const key = `${String(lot.areaId ?? "")}|${String(lot.locationId)}`;
        lotsByScope.set(key, (lotsByScope.get(key) ?? 0) + Number(lot.quantityAvailable));
      }
      for (const [key, rows] of rowGroups) {
        const expected = lotsByScope.get(key) ?? 0;
        if (Math.abs(Number(rows[0].quantity) - expected) > 1e-9) {
          throw new Error(`Integridade de "${product.name}" no local (${key}): saldo físico (${rows[0].quantity}) diverge dos lotes (${expected}). Regularize antes do inventário.`);
        }
      }
      for (const [key, quantity] of lotsByScope) {
        if (quantity > 1e-9 && !rowGroups.has(key)) {
          throw new Error(`Há lotes de "${product.name}" sem saldo por local físico (${key}). Regularize antes do inventário.`);
        }
      }

      const reservedByLot = new Map<string, number>();
      for (const reservation of reservations as any[]) {
        const key = String(reservation.lotId);
        reservedByLot.set(key, (reservedByLot.get(key) ?? 0) + Number(reservation.quantityRemaining));
      }

      let targetLocationStock: any = null;
      let eligibleLots = lots as any[];
      let reservedInScope = previousReserved;
      if (inv.locationId) {
        const targetRows = locationRows.filter((row: any) =>
          row.locationId === inv.locationId && row.areaId === inv.areaId
        );
        if (targetRows.length > 1) throw new Error("Há linhas duplicadas de saldo para o produto/área/local.");
        targetLocationStock = targetRows[0] ?? null;
        const currentScope = Number(targetLocationStock?.quantity ?? 0);
        if (Math.abs(currentScope - snapshot) > 1e-9) {
          throw new Error(`O saldo de "${product.name}" no local mudou depois da abertura do inventário. Atualize o inventário antes de fechar.`);
        }
        eligibleLots = (lots as any[]).filter((lot: any) =>
          lot.areaId === inv.areaId && lot.locationId === inv.locationId
        );
        const scopeTotal = eligibleLots.reduce((sum: number, lot: any) => sum + Number(lot.quantityAvailable), 0);
        if (Math.abs(scopeTotal - currentScope) > 1e-9) {
          throw new Error(`Lotes de "${product.name}" não conferem com o saldo da área/local selecionado.`);
        }
        reservedInScope = (reservations as any[])
          .filter((reservation: any) => reservation.areaId === inv.areaId && reservation.locationId === inv.locationId)
          .reduce((sum: number, reservation: any) => sum + Number(reservation.quantityRemaining), 0);
        if (counted < reservedInScope) {
          throw new Error(`A contagem de "${product.name}" (${counted}) ficaria abaixo das ${reservedInScope} unidade(s) reservada(s) nesta área/local.`);
        }
      } else {
        if (Math.abs(previousPhysical - snapshot) > 1e-9) {
          throw new Error(`O saldo global de "${product.name}" mudou depois da abertura do inventário. Atualize o inventário antes de fechar.`);
        }
        if (counted < previousReserved) {
          throw new Error(`A contagem de "${product.name}" ficaria abaixo das ${previousReserved} unidade(s) reservada(s).`);
        }
        // Inventário geral não consegue atribuir reservas legadas sem trilha por lote.
        if (Math.abs(reservationTotal - previousReserved) > 1e-9) {
          throw new Error(`Há reservas sem rastreabilidade por lote para "${product.name}".`);
        }
      }

      const plannedReductions: Array<{ lot: any; quantity: number }> = [];
      if (delta < 0) {
        let remaining = -delta;
        const candidates = eligibleLots
          .filter((lot: any) => lot.active !== false && Number(lot.quantityAvailable) > 0)
          .sort((a: any, b: any) => a.receivedAt - b.receivedAt || a.lotNumber.localeCompare(b.lotNumber));
        for (const lot of candidates) {
          if (remaining <= 1e-9) break;
          const reserved = reservedByLot.get(String(lot._id)) ?? 0;
          const free = Number(lot.quantityAvailable) - reserved;
          if (free <= 1e-9) continue;
          const reduction = Math.min(free, remaining);
          plannedReductions.push({ lot, quantity: reduction });
          remaining -= reduction;
        }
        if (remaining > 1e-9) {
          throw new Error(`A diferença negativa de "${product.name}" excede os lotes livres, desconsiderando as reservas.`);
        }
      }

      const newPhysical = previousPhysical + delta;
      if (newPhysical < previousReserved) {
        throw new Error(`Ajuste de "${product.name}" deixaria o estoque abaixo das unidades reservadas.`);
      }

      // A diferença positiva gera um lote próprio de ajuste. A diferença negativa
      // é distribuída entre lotes livres FIFO, mantendo a origem de cada redução.
      let adjustmentEntryId: any = undefined;
      let adjustmentLotId: any = undefined;
      if (delta > 0) {
        const entryNumber = await generateInventoryAdjustmentEntryNumber(ctx);
        adjustmentEntryId = await ctx.db.insert("entries", {
          entryNumber,
          receivedAt: now,
          originType: "other",
          responsibleUserId: userId,
          observation: `Ajuste positivo de inventário ${inv.inventoryNumber}. ${justification}`,
          areaId: inv.locationId ? inv.areaId : undefined,
          status: "confirmed",
          createdAt: now,
          updatedAt: now,
        });
        const lotNumber = await generateInventoryAdjustmentLotNumber(ctx);
        adjustmentLotId = await ctx.db.insert("lots", {
          lotNumber,
          productId: count.productId,
          entryId: adjustmentEntryId,
          brand: product.brand ?? undefined,
          model: product.model ?? undefined,
          specification: product.specification ?? undefined,
          quantityReceived: delta,
          quantityAvailable: delta,
          receivedAt: now,
          active: true,
          materialType: lots.find((lot: any) => lot.materialType)?.materialType,
          areaId: inv.locationId ? inv.areaId : undefined,
          locationId: inv.locationId ?? undefined,
          observation: `Ajuste positivo do inventário ${inv.inventoryNumber}. ${justification}`,
        });
        const itemId = await ctx.db.insert("entryItems", {
          entryId: adjustmentEntryId,
          productId: count.productId,
          quantity: delta,
          unitOfMeasure: product.unitOfMeasure,
          brand: product.brand ?? undefined,
          model: product.model ?? undefined,
          specification: product.specification ?? undefined,
          lotId: adjustmentLotId as string,
          areaId: inv.locationId ? inv.areaId : undefined,
          locationId: inv.locationId ?? undefined,
          observation: `Ajuste positivo do inventário ${inv.inventoryNumber}. ${justification}`,
        });
        await ctx.db.insert("auditLogs", {
          userId, action: "confirm_entry", entity: "entries", entityId: adjustmentEntryId,
          details: `Entrada de ajuste ${entryNumber} criada pelo inventário ${inv.inventoryNumber} para "${product.name}" (+${delta}).`,
          timestamp: now,
        });
        void itemId;
      }

      if (delta < 0) {
        for (const reduction of plannedReductions) {
          const nextQuantity = Number(reduction.lot.quantityAvailable) - reduction.quantity;
          await ctx.db.patch(reduction.lot._id, {
            quantityAvailable: nextQuantity,
            active: nextQuantity > 0,
          });
        }
      }

      if (inv.locationId) {
        if (targetLocationStock) {
          await ctx.db.patch(targetLocationStock._id, { quantity: counted });
        } else if (counted > 0) {
          await ctx.db.insert("stockByLocation", {
            productId: count.productId,
            locationId: inv.locationId,
            areaId: inv.areaId,
            quantity: counted,
          });
        }
      } else if (delta < 0) {
        // Inventário geral pode reduzir lotes de vários locais; mantém cada bucket
        // físico sincronizado com a redução aplicada ao respectivo lote.
        const reductionsByScope = new Map<string, number>();
        for (const reduction of plannedReductions) {
          const lot = reduction.lot;
          if (!lot.locationId) continue;
          const key = `${String(lot.areaId ?? "")}|${String(lot.locationId)}`;
          reductionsByScope.set(key, (reductionsByScope.get(key) ?? 0) + reduction.quantity);
        }
        for (const [key, reduction] of reductionsByScope) {
          const row = rowGroups.get(key)?.[0];
          if (!row || Number(row.quantity) < reduction) {
            throw new Error(`Saldo por local insuficiente para o ajuste de "${product.name}" no escopo ${key}.`);
          }
          await ctx.db.patch(row._id, { quantity: Number(row.quantity) - reduction });
        }
      }

      if (!stock) {
        await ctx.db.insert("stock", {
          productId: count.productId,
          physicalQuantity: newPhysical,
          reservedQuantity: 0,
        });
      } else {
        await ctx.db.patch(stock._id, { physicalQuantity: newPhysical });
      }

      const movementId = await ctx.db.insert("stockMovements", {
        productId: count.productId,
        type: "adjustment",
        quantity: Math.abs(delta),
        previousPhysical,
        newPhysical,
        previousReserved,
        newReserved: previousReserved,
        userId,
        entryId: adjustmentEntryId,
        lotId: adjustmentLotId ? String(adjustmentLotId) : plannedReductions[0]?.lot._id as string | undefined,
        areaId: inv.locationId ? inv.areaId : undefined,
        locationId: inv.locationId ?? undefined,
        observation:
          `Ajuste via inventário ${inv.inventoryNumber}${scopeSuffix}. Área: ${inv.areaId ?? "geral"}. ` +
          `Diferença: ${delta >= 0 ? "+" : ""}${delta}. Justificativa: ${justification}`,
        timestamp: now,
      });
      if (adjustmentLotId) {
        await ctx.db.insert("stockMovementLots", {
          movementId, lotId: adjustmentLotId, quantity: delta,
          areaId: inv.locationId ? inv.areaId : undefined,
          locationId: inv.locationId ?? undefined,
        });
      } else {
        for (const reduction of plannedReductions) {
          await ctx.db.insert("stockMovementLots", {
            movementId,
            lotId: reduction.lot._id,
            quantity: reduction.quantity,
            areaId: reduction.lot.areaId,
            locationId: reduction.lot.locationId,
          });
        }
      }

      adjustmentDetails.push(
        `${product.name}: ${snapshot} → ${counted} (${delta >= 0 ? "+" : ""}${delta})${scopeSuffix}`,
      );
    }

    await ctx.db.patch(args.inventoryId, {
      status: "closed",
      closedAt: now,
      closedByUserId: userId,
      updatedAt: now,
    });
    await ctx.db.insert("auditLogs", {
      userId,
      action: "close_inventory",
      entity: "inventories",
      entityId: args.inventoryId,
      details: `Inventário ${inv.inventoryNumber} fechado${scopeSuffix}. ${changedCounts.length} ajuste(s): ${adjustmentDetails.join("; ") || "nenhum"}. Justificativa: ${justification}`,
      timestamp: now,
    });

    return { adjustments: changedCounts.length, details: adjustmentDetails };
  },
});

/** Cancel an inventory (only draft or counting). */
export const cancel = mutation({
  args: { inventoryId: v.id("inventories") },
  handler: async (ctx, args) => {
    const { userId } = await requireStockManagerOrAdmin(ctx);
    const inv = await ctx.db.get(args.inventoryId);
    if (!inv) throw new Error("Inventário não encontrado");
    if (inv.status === "closed") throw new Error("Inventário já fechado não pode ser cancelado");
    if (inv.status === "cancelled") throw new Error("Inventário já está cancelado");

    await ctx.db.patch(args.inventoryId, { status: "cancelled", updatedAt: Date.now() });

    await ctx.db.insert("auditLogs", {
      userId, action: "cancel", entity: "inventories", entityId: args.inventoryId,
      details: `Inventário ${inv.inventoryNumber} cancelado`, timestamp: Date.now(),
    });
  },
});

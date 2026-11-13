import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requirePermission } from "./rbac";
import { getOptionalSingleValidGlobalStock, validateUniqueScopedStockRows } from "../lib/stock-read-integrity";

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
  const category = inv.categoryId ? await ctx.db.get(inv.categoryId) : null;
  const counts = await ctx.db.query("inventoryCounts").withIndex("by_inventory", (q: any) => q.eq("inventoryId", inv._id)).collect();
  const countsWithProduct = await Promise.all(counts.map(async (c: any) => {
    const product = await ctx.db.get(c.productId);
    const lot = c.lotId ? await ctx.db.get(c.lotId as any) : null;
    const countLocation = c.locationId ? await ctx.db.get(c.locationId) : null;
    return { ...c, product, lot, countLocation };
  }));
  return { ...inv, responsible, closedBy, location, category, counts: countsWithProduct };
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

/** Create a new inventory in DRAFT status. Populates counts with all active products. */
export const create = mutation({
  args: {
    observation: v.optional(v.string()),
    locationId: v.optional(v.id("storageLocations")),
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
    if (args.locationId) {
      const location = await ctx.db.get(args.locationId);
      if (!location) throw new Error("Local de armazenamento não encontrado");
      if (!location.active) throw new Error("O local de armazenamento selecionado está inativo");
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
      args.locationId ? `local ${args.locationId}` : "todos os locais",
      args.categoryId ? `categoria ${args.categoryId}` : "",
      args.productIds && args.productIds.length > 0 ? `${args.productIds.length} produto(s) selecionado(s)` : "",
    ].filter(Boolean).join(", ");

    const activeLocations = await ctx.db.query("storageLocations")
      .withIndex("by_active", (q: any) => q.eq("active", true))
      .collect();
    let countRowsCreated = 0;

    for (const product of products) {
      const [stockRows, sbls, lots, lotBalances] = await Promise.all([
        ctx.db.query("stock").withIndex("by_product", (q: any) => q.eq("productId", product._id)).collect(),
        ctx.db.query("stockByLocation").withIndex("by_product", (q: any) => q.eq("productId", product._id)).collect(),
        ctx.db.query("lots").withIndex("by_product", (q: any) => q.eq("productId", product._id)).collect(),
        ctx.db.query("lotLocationBalances").withIndex("by_product", (q: any) => q.eq("productId", product._id)).collect(),
      ]);
      const stock = getOptionalSingleValidGlobalStock(stockRows, product.name);
      validateUniqueScopedStockRows(sbls, product.name);

      const trackedLots = lots.filter((lot: any) =>
        lot.active || (Number.isFinite(lot.quantityAvailable) && lot.quantityAvailable > 0),
      );
      const targetLocationIds = new Set<string>();
      if (args.locationId) {
        targetLocationIds.add(String(args.locationId));
      } else {
        for (const location of activeLocations) targetLocationIds.add(String(location._id));
        for (const row of sbls) targetLocationIds.add(String(row.locationId));
        for (const row of lotBalances) targetLocationIds.add(String(row.locationId));
      }
      if (targetLocationIds.size === 0) {
        throw new Error("Não há armários ativos para contar. Cadastre pelo menos um local de armazenamento.");
      }

      for (const locationId of targetLocationIds) {
        const location = await ctx.db.get(locationId as any);
        if (!location) throw new Error("Um dos armários do inventário não existe mais.");
      }

      if (trackedLots.length > 0) {
        // Divergência entre lote e saldo global não impede a contagem:
        // o inventário é justamente o instrumento para medir e reconciliar.
        // Quantidades inválidas/duplicadas continuam bloqueando a abertura.
        for (const lot of trackedLots) {
          if (!Number.isFinite(lot.quantityAvailable) || lot.quantityAvailable < 0) {
            throw new Error(`O lote ${lot.lotNumber} possui quantidade inválida.`);
          }
        }

        const seenBalances = new Set<string>();
        for (const balance of lotBalances) {
          if (!Number.isFinite(balance.quantityAvailable) || balance.quantityAvailable < 0) {
            throw new Error(`Há saldo inválido de lote no produto "${product.name}".`);
          }
          const key = `${String(balance.lotId)}::${String(balance.locationId)}`;
          if (seenBalances.has(key)) {
            throw new Error(`Há saldo duplicado de lote/armário no produto "${product.name}".`);
          }
          seenBalances.add(key);
          if (!trackedLots.some((lot: any) => lot._id === balance.lotId)) {
            throw new Error(`Há saldo de lote órfão no produto "${product.name}".`);
          }
        }

        for (const lot of trackedLots) {
          for (const locationId of targetLocationIds) {
            const balance = lotBalances.find((row: any) =>
              row.lotId === lot._id && String(row.locationId) === locationId,
            );
            await ctx.db.insert("inventoryCounts", {
              inventoryId,
              productId: product._id,
              lotId: String(lot._id),
              locationId: locationId as any,
              systemQuantity: balance?.quantityAvailable ?? 0,
            });
            countRowsCreated += 1;
          }
        }
      } else {
        // Produtos sem lote: a contagem também é separada por armário.
        for (const locationId of targetLocationIds) {
          const bucket = sbls.find((row: any) => String(row.locationId) === locationId);
          await ctx.db.insert("inventoryCounts", {
            inventoryId,
            productId: product._id,
            locationId: locationId as any,
            systemQuantity: bucket?.quantity ?? 0,
          });
          countRowsCreated += 1;
        }
      }
    }

    await ctx.db.insert("auditLogs", {
      userId, action: "open_inventory", entity: "inventories", entityId: inventoryId,
      details: `Inventário ${inventoryNumber} aberto com ${countRowsCreated} linhas de contagem por armário/lote (${scopeLabel})`,
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
    if (!justification) {
      throw new Error("A justificativa do fechamento é obrigatória (ajuste de saldo auditável)");
    }

    const inv = await ctx.db.get(args.inventoryId);
    if (!inv) throw new Error("Inventário não encontrado");
    if (inv.status !== "review") throw new Error("Inventário deve estar em revisão para ser fechado");

    const counts = await ctx.db.query("inventoryCounts")
      .withIndex("by_inventory", (q: any) => q.eq("inventoryId", args.inventoryId))
      .collect();
    const uncounted = counts.filter((count: any) =>
      count.countedQuantity === null || count.countedQuantity === undefined,
    );
    if (uncounted.length > 0) {
      throw new Error(`${uncounted.length} item(ns) ainda não foram contados.`);
    }

    const now = Date.now();
    const locationScope = inv.locationId ? await ctx.db.get(inv.locationId) : null;
    const scopeSuffix = locationScope ? ` no armário "${locationScope.name}"` : "";
    const grouped = new Map<string, any[]>();
    for (const count of counts) {
      const key = String(count.productId);
      grouped.set(key, [...(grouped.get(key) ?? []), count]);
    }

    const adjustmentDetails: string[] = [];
    let adjustments = 0;
    const EPSILON = 1e-9;

    for (const productCounts of grouped.values()) {
      const productId = productCounts[0].productId;
      const product: any = await ctx.db.get(productId);
      const productName = product?.name ?? String(productId);
      const [stockRows, lots, sbls] = await Promise.all([
        ctx.db.query("stock").withIndex("by_product", (q: any) => q.eq("productId", productId)).collect(),
        ctx.db.query("lots").withIndex("by_product", (q: any) => q.eq("productId", productId)).collect(),
        ctx.db.query("stockByLocation").withIndex("by_product", (q: any) => q.eq("productId", productId)).collect(),
      ]);
      const stock = getOptionalSingleValidGlobalStock(stockRows, productName);
      validateUniqueScopedStockRows(sbls, productName);
      const currentPhysical = stock?.physicalQuantity ?? 0;
      const reserved = stock?.reservedQuantity ?? 0;
      const lotCounts = productCounts.filter((count: any) => Boolean(count.lotId));
      const productLocationCounts = productCounts.filter((count: any) => !count.lotId && count.locationId);
      const legacyAggregateCounts = productCounts.filter((count: any) => !count.lotId && !count.locationId);
      const trackedLots = lots.filter((lot: any) =>
        lot.active || (Number.isFinite(lot.quantityAvailable) && lot.quantityAvailable > 0),
      );

      if (lotCounts.length > 0 && (productLocationCounts.length > 0 || legacyAggregateCounts.length > 0)) {
        throw new Error(`O inventário mistura contagem por lote e agregada para "${productName}".`);
      }
      if (lotCounts.length > 0) {
        const seen = new Set<string>();
        const lotChanges: Array<{
          lotId: any;
          lotNumber: string;
          locationId: any;
          delta: number;
          previousQuantity: number;
          countedQuantity: number;
        }> = [];

        for (const count of lotCounts) {
          if (!count.locationId) {
            throw new Error(`A contagem do lote de "${productName}" não informa o armário.`);
          }
          const lot: any = await ctx.db.get(count.lotId as any);
          if (!lot || lot.productId !== productId) {
            throw new Error(`Lote de contagem inválido para "${productName}".`);
          }
          const key = `${String(lot._id)}::${String(count.locationId)}`;
          if (seen.has(key)) throw new Error(`Contagem duplicada para o lote ${lot.lotNumber} no mesmo armário.`);
          seen.add(key);

          const counted = count.countedQuantity;
          if (!Number.isFinite(counted) || counted < 0) {
            throw new Error(`A contagem do lote ${lot.lotNumber} está inválida.`);
          }
          const balances = await ctx.db.query("lotLocationBalances")
            .withIndex("by_lot", (q: any) => q.eq("lotId", lot._id))
            .collect();
          const matching = balances.filter((row: any) => row.locationId === count.locationId);
          if (matching.length > 1) {
            throw new Error(`Há saldos duplicados do lote ${lot.lotNumber} no armário.`);
          }
          const currentAtLocation = matching[0]?.quantityAvailable ?? 0;
          if (Math.abs(currentAtLocation - count.systemQuantity) > EPSILON) {
            throw new Error(
              `O saldo do lote ${lot.lotNumber} mudou depois da abertura do inventário. Atualize/recrie o inventário antes de fechar.`,
            );
          }
          const delta = counted - currentAtLocation;
          if (Math.abs(delta) > EPSILON) {
            if (matching[0]) {
              await ctx.db.patch(matching[0]._id, {
                quantityAvailable: counted,
                updatedAt: now,
              });
            } else if (counted > 0) {
              await ctx.db.insert("lotLocationBalances", {
                lotId: lot._id,
                productId,
                locationId: count.locationId,
                quantityAvailable: counted,
                updatedAt: now,
              });
            }
            lotChanges.push({
              lotId: lot._id,
              lotNumber: lot.lotNumber,
              locationId: count.locationId,
              delta,
              previousQuantity: currentAtLocation,
              countedQuantity: counted,
            });
          }
        }

        // Recalcula os totais dos lotes a partir das localizações e reconcilia
        // os buckets do produto. Armários fora do escopo devem permanecer
        // conciliados; não se sobrescreve saldo que não foi contado.
        const refreshedLots = await ctx.db.query("lots")
          .withIndex("by_product", (q: any) => q.eq("productId", productId))
          .collect();
        const refreshedBalances = await ctx.db.query("lotLocationBalances")
          .withIndex("by_product", (q: any) => q.eq("productId", productId))
          .collect();
        const balanceKeys = new Set<string>();
        const lotById = new Map(refreshedLots.map((lot: any) => [String(lot._id), lot]));
        const locationTotals = new Map<string, number>();
        const lotTotals = new Map<string, number>();

        for (const balance of refreshedBalances) {
          const key = `${String(balance.lotId)}::${String(balance.locationId)}`;
          if (balanceKeys.has(key)) throw new Error("Há saldos duplicados de lote/armário. Fechamento bloqueado.");
          balanceKeys.add(key);
          const lot: any = lotById.get(String(balance.lotId));
          if (!lot || lot.productId !== productId) throw new Error("Há saldo de lote órfão. Fechamento bloqueado.");
          if (!Number.isFinite(balance.quantityAvailable) || balance.quantityAvailable < 0) {
            throw new Error("Há saldo de lote inválido. Fechamento bloqueado.");
          }
          lotTotals.set(String(balance.lotId), (lotTotals.get(String(balance.lotId)) ?? 0) + balance.quantityAvailable);
          locationTotals.set(String(balance.locationId), (locationTotals.get(String(balance.locationId)) ?? 0) + balance.quantityAvailable);
        }

        for (const lot of refreshedLots) {
          const total = lotTotals.get(String(lot._id)) ?? 0;
          if (Math.abs((lot.quantityAvailable ?? 0) - total) > EPSILON) {
            await ctx.db.patch(lot._id, { quantityAvailable: total });
          }
        }

        const oldByLocation = new Map(sbls.map((row: any) => [String(row.locationId), row]));
        const locationIds = new Set([
          ...oldByLocation.keys(),
          ...locationTotals.keys(),
        ]);
        for (const locationId of locationIds) {
          const currentRow: any = oldByLocation.get(locationId);
          const countedTotal = locationTotals.get(locationId) ?? 0;
          if (inv.locationId && locationId !== String(inv.locationId)) {
            const currentLocationQuantity = currentRow?.quantity ?? 0;
            if (Math.abs(currentLocationQuantity - countedTotal) > EPSILON) {
              throw new Error(
                `O armário não contado "${locationId}" possui saldo físico ${currentLocationQuantity}, mas os lotes somam ${countedTotal}. Concilie esse armário antes de fechar.`,
              );
            }
          }
          if (currentRow) {
            if (Math.abs(currentRow.quantity - countedTotal) > EPSILON) {
              await ctx.db.patch(currentRow._id, { quantity: countedTotal });
            }
          } else if (countedTotal > 0) {
            await ctx.db.insert("stockByLocation", {
              productId,
              locationId: locationId as any,
              quantity: countedTotal,
            });
          }
        }

        const newPhysical = [...locationTotals.values()].reduce((sum, value) => sum + value, 0);
        if (!Number.isFinite(newPhysical) || newPhysical < reserved) {
          throw new Error(
            `A contagem de "${productName}" deixaria o estoque abaixo das unidades reservadas (${reserved}).`,
          );
        }
        if (stock) await ctx.db.patch(stock._id, { physicalQuantity: newPhysical });
        else await ctx.db.insert("stock", { productId, physicalQuantity: newPhysical, reservedQuantity: 0 });

        let runningPhysical = currentPhysical;
        for (const change of lotChanges) {
          const nextPhysical = runningPhysical + change.delta;
          await ctx.db.insert("stockMovements", {
            productId,
            type: "adjustment",
            quantity: Math.abs(change.delta),
            previousPhysical: runningPhysical,
            newPhysical: nextPhysical,
            previousReserved: reserved,
            newReserved: reserved,
            userId,
            locationId: change.locationId,
            lotId: String(change.lotId),
            observation: `Inventário ${inv.inventoryNumber}: lote ${change.lotNumber}, armário ${String(change.locationId)}; ${change.previousQuantity} → ${change.countedQuantity}. Justificativa: ${justification}`,
            timestamp: now,
          });
          runningPhysical = nextPhysical;
          adjustments += 1;
          adjustmentDetails.push(`${productName} / ${change.lotNumber}: ${change.previousQuantity} → ${change.countedQuantity}`);
        }
        if (Math.abs(newPhysical - runningPhysical) > EPSILON) {
          await ctx.db.insert("stockMovements", {
            productId,
            type: "adjustment",
            quantity: Math.abs(newPhysical - runningPhysical),
            previousPhysical: runningPhysical,
            newPhysical,
            previousReserved: reserved,
            newReserved: reserved,
            userId,
            observation: `Conciliação do saldo global após inventário ${inv.inventoryNumber}. Justificativa: ${justification}`,
            timestamp: now,
          });
          adjustments += 1;
          adjustmentDetails.push(`${productName}: conciliação global ${runningPhysical} → ${newPhysical}`);
        }
        continue;
      }

      if (trackedLots.length > 0 && legacyAggregateCounts.length > 0) {
        throw new Error(
          `O inventário ${inv.inventoryNumber} foi aberto com contagem agregada para "${productName}", que possui lotes. Cancele e abra um novo inventário para contar lote × armário.`,
        );
      }

      if (trackedLots.length > 0 && lotCounts.length === 0) {
        throw new Error(
          `O inventário de "${productName}" foi aberto sem divisão por lote. Como o produto possui lotes rastreados, cancele e abra um inventário novo para contar lote × armário.`,
        );
      }

      if (productLocationCounts.length > 0) {
        const seenLocations = new Set<string>();
        const locationChanges: Array<{ locationId: any; delta: number; previousQuantity: number; countedQuantity: number }> = [];
        for (const count of productLocationCounts) {
          const locationId = String(count.locationId);
          if (seenLocations.has(locationId)) throw new Error(`Contagem duplicada de "${productName}" no mesmo armário.`);
          seenLocations.add(locationId);
          const counted = count.countedQuantity;
          if (!Number.isFinite(counted) || counted < 0) throw new Error(`A contagem de "${productName}" está inválida.`);
          const currentRow = sbls.find((row: any) => String(row.locationId) === locationId);
          const currentQuantity = currentRow?.quantity ?? 0;
          if (Math.abs(currentQuantity - count.systemQuantity) > EPSILON) {
            throw new Error(`O saldo de "${productName}" no armário mudou depois da abertura do inventário. Recrie o inventário.`);
          }
          const delta = counted - currentQuantity;
          if (Math.abs(delta) > EPSILON) {
            if (currentRow) await ctx.db.patch(currentRow._id, { quantity: counted });
            else if (counted > 0) await ctx.db.insert("stockByLocation", {
              productId,
              locationId: count.locationId,
              quantity: counted,
            });
            locationChanges.push({ locationId: count.locationId, delta, previousQuantity: currentQuantity, countedQuantity: counted });
          }
        }
        const refreshedSbls = await ctx.db.query("stockByLocation")
          .withIndex("by_product", (q: any) => q.eq("productId", productId))
          .collect();
        validateUniqueScopedStockRows(refreshedSbls, productName);
        const newPhysical = refreshedSbls.reduce((sum: number, row: any) => sum + row.quantity, 0);
        if (!Number.isFinite(newPhysical) || newPhysical < reserved) {
          throw new Error(`A contagem de "${productName}" deixaria o saldo abaixo das reservas (${reserved}).`);
        }
        if (stock) await ctx.db.patch(stock._id, { physicalQuantity: newPhysical });
        else await ctx.db.insert("stock", { productId, physicalQuantity: newPhysical, reservedQuantity: 0 });

        let runningPhysical = currentPhysical;
        for (const change of locationChanges) {
          const nextPhysical = runningPhysical + change.delta;
          await ctx.db.insert("stockMovements", {
            productId,
            type: "adjustment",
            quantity: Math.abs(change.delta),
            previousPhysical: runningPhysical,
            newPhysical: nextPhysical,
            previousReserved: reserved,
            newReserved: reserved,
            userId,
            locationId: change.locationId,
            observation: `Inventário ${inv.inventoryNumber} — armário ${String(change.locationId)}: ${change.previousQuantity} → ${change.countedQuantity}. Justificativa: ${justification}`,
            timestamp: now,
          });
          runningPhysical = nextPhysical;
          adjustments += 1;
          adjustmentDetails.push(`${productName} / armário ${String(change.locationId)}: ${change.previousQuantity} → ${change.countedQuantity}`);
        }
        if (Math.abs(newPhysical - runningPhysical) > EPSILON) {
          await ctx.db.insert("stockMovements", {
            productId,
            type: "adjustment",
            quantity: Math.abs(newPhysical - runningPhysical),
            previousPhysical: runningPhysical,
            newPhysical,
            previousReserved: reserved,
            newReserved: reserved,
            userId,
            observation: `Conciliação do saldo global após inventário ${inv.inventoryNumber}. Justificativa: ${justification}`,
            timestamp: now,
          });
          adjustments += 1;
        }
        continue;
      }

      // Compatibilidade: inventários antigos criados antes da contagem por
      // armário. Só permitem ajuste agregado se o produto não tiver lotes nem
      // buckets físicos positivos que precisem ser preservados.
      if (productCounts.length !== 1 || legacyAggregateCounts.length !== 1) {
        throw new Error(`O inventário agregado de "${productName}" possui linhas duplicadas ou incompatíveis.`);
      }
      const legacyCount = legacyAggregateCounts[0];
      if (trackedLots.length > 0) {
        throw new Error(`Não é seguro fechar inventário agregado de "${productName}" porque há lotes ativos.`);
      }
      const currentLocalTotal = sbls.reduce((sum: number, row: any) => sum + row.quantity, 0);
      if (currentLocalTotal > EPSILON) {
        throw new Error(`O inventário antigo de "${productName}" não identifica armários. Recrie-o com contagem por local.`);
      }
      const counted = legacyCount.countedQuantity;
      if (!Number.isFinite(counted) || counted < 0) throw new Error(`A contagem de "${productName}" está inválida.`);
      const delta = counted - currentPhysical;
      if (counted < reserved) throw new Error(`A contagem de "${productName}" ficaria abaixo das reservas (${reserved}).`);
      if (stock) await ctx.db.patch(stock._id, { physicalQuantity: counted });
      else await ctx.db.insert("stock", { productId, physicalQuantity: counted, reservedQuantity: 0 });
      if (Math.abs(delta) > EPSILON) {
        await ctx.db.insert("stockMovements", {
          productId,
          type: "adjustment",
          quantity: Math.abs(delta),
          previousPhysical: currentPhysical,
          newPhysical: counted,
          previousReserved: reserved,
          newReserved: reserved,
          userId,
          observation: `Ajuste agregado via inventário ${inv.inventoryNumber}${scopeSuffix}. Justificativa: ${justification}`,
          timestamp: now,
        });
        adjustments += 1;
        adjustmentDetails.push(`${productName}: ${currentPhysical} → ${counted}`);
      }
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
      details: `Inventário ${inv.inventoryNumber} fechado${scopeSuffix}. ${adjustments} ajuste(s): ${adjustmentDetails.join("; ") || "nenhum"}. Justificativa: ${justification}`,
      timestamp: now,
    });

    return { adjustments, details: adjustmentDetails };
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

import { requirePermission } from "./rbac";
import {
  resolveConsumedLotId,
  formatConsumedLots,
  type LotConsumption,
} from "../lib/stock-consumption";
import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getOptionalSingleValidGlobalStock, isDiscreteStockUnit } from "../lib/stock-quantity-rules";
import {
  applyImplementationStockStamp,
  generateExitNumber,
  hasInitialInventoryLot,
  IMPLEMENTATION_STOCK_DATE,
  isImplementationStockStamped,
  tonerKitObservation,
} from "./stockHelpers";

async function requireUser(ctx: any) {
  // RBAC central: resumos de implantação/localização exigem visão de estoque.
  return requirePermission(ctx, "stock.view");
}

async function requireAdmin(ctx: any) {
  // RBAC central: carga inicial, importação de planilha e saída rápida.
  return requirePermission(ctx, "stock.mutate", { entity: "stockSetup" });
}

/**
 * Generate lot number: LOT-YYYY-NNNNNN
 */
async function generateLotNumber(ctx: any, _productId: string): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `LOT-${year}-`;
  const existingLots = await ctx.db
    .query("lots")
    .withIndex("by_number", (q: any) => q.gte("lotNumber", prefix))
    .collect();
  const maxSequence = existingLots.reduce((max: number, lot: any) => {
    if (!lot.lotNumber?.startsWith(prefix)) return max;
    const sequence = Number(lot.lotNumber.slice(prefix.length));
    return Number.isSafeInteger(sequence) && sequence > max ? sequence : max;
  }, 0);
  return `${prefix}${String(maxSequence + 1).padStart(6, "0")}`;
}

/**
 * Initial stock loading (implantação inicial).
 *
 * For each product/location combination:
 *   - Creates a lot (initial_inventory) for FIFO traceability
 *   - Creates stockByLocation
 *   - Creates/updates stock (global)
 *   - Creates stockMovements
 *
 * BLOCKS if product already has an initial_inventory lot (prevents duplication).
 * All quantities from initial load are traceable via the created lot.
 */
/**
 * Núcleo compartilhado da implantação inicial (usado pela carga manual e pela
 * importação da planilha). Gera entrada, lote, saldo por local, saldo global,
 * movimentação e auditoria — sempre com a mesma lógica.
 */
async function performInitialLoad(
  ctx: any,
  userId: string,
  items: Array<{
    productId: string;
    locationId: string;
    areaId?: string;
    quantity: number;
    unitOfMeasure?: string;
    brand?: string;
    model?: string;
    specification?: string;
    observation?: string;
  }>,
  observation: string
) {
  if (!items || items.length === 0) {
    throw new Error("Nenhum item informado para carga inicial");
  }

  // ── Defesa numérica (Int64 → number) ──
  // O validador v.number() do Convex aceita Int64 (bigint) quando a mutation
  // é chamada via CLI com literais JSON inteiros. Normaliza explicitamente
  // para number JS para que nenhuma aritmética misture bigint com number.
  items = items.map((i) => ({ ...i, quantity: Number(i.quantity) }));

  const positiveItems = items.filter((item) => item.quantity > 0);
  if (items.some((item) => !Number.isFinite(item.quantity) || item.quantity < 0)) {
    throw new Error("A carga inicial contém quantidade negativa ou inválida.");
  }
  if (positiveItems.length === 0) {
    throw new Error("Informe ao menos um item com quantidade maior que zero para a carga inicial.");
  }

  // Validar TODO o lote de entrada antes de criar a entrada ou qualquer saldo.
  for (const item of positiveItems) {
    const [location, area, product, productLots, stockRows, locationRows] = await Promise.all([
      ctx.db.get(item.locationId),
      item.areaId ? ctx.db.get(item.areaId as any) : Promise.resolve(null),
      ctx.db.get(item.productId as any),
      ctx.db.query("lots").withIndex("by_product", (q: any) => q.eq("productId", item.productId)).collect(),
      ctx.db.query("stock").withIndex("by_product", (q: any) => q.eq("productId", item.productId)).collect(),
      ctx.db.query("stockByLocation").withIndex("by_product", (q: any) => q.eq("productId", item.productId)).collect(),
    ]);
    if (!location || !location.active) {
      throw new Error("A carga inicial precisa apontar para um local físico ativo.");
    }
    if (!item.areaId || !area?.active) {
      throw new Error(`Informe uma área/subestoque ativo para o material armazenado em "${location.name}". O local físico não define a área.`);
    }
    if (!product || !product.active) {
      throw new Error(`O produto "${product?.name ?? item.productId}" não existe ou está inativo.`);
    }
    if (product.hasSerial || productLots.some((lot: any) => lot.materialType === "permanent")) {
      throw new Error(`"${product.name}" é material permanente ou individualizado. Cadastre o equipamento individualmente; não faça carga por quantidade agregada.`);
    }
    const unit = item.unitOfMeasure ?? product.unitOfMeasure;
    if (isDiscreteStockUnit(unit, product.hasSerial) && !Number.isSafeInteger(item.quantity)) {
      throw new Error(`A quantidade inicial de "${product.name}" deve ser inteira para a unidade ${unit}.`);
    }
    if (stockRows.length > 1) {
      throw new Error(`"${product.name}" possui registros globais de estoque duplicados. Regularize antes da carga inicial.`);
    }
    if (stockRows[0] && (
      !Number.isFinite(stockRows[0].physicalQuantity) ||
      !Number.isFinite(stockRows[0].reservedQuantity) ||
      stockRows[0].physicalQuantity < stockRows[0].reservedQuantity ||
      stockRows[0].reservedQuantity < 0
    )) {
      throw new Error(`O saldo global de "${product.name}" está inconsistente.`);
    }
    const locationMatches = locationRows.filter((row: any) =>
      row.locationId === item.locationId && row.areaId === item.areaId
    );
    if (locationMatches.length > 1) {
      throw new Error(`"${product.name}" possui saldos físicos duplicados nessa combinação de área/local.`);
    }
  }

  const now = Date.now();
  const year = new Date().getFullYear();

  // ── Pre-check: block if any product already has initial_inventory lots ──
  // A carga inicial é caracterizada por um lote ativo vinculado a uma entrada
  // com originType "initial_inventory" (não confundir com lotes de compras).
  for (const item of items) {
    if (item.quantity <= 0) continue;

    const existingLots = await ctx.db
      .query("lots")
      .withIndex("by_product", (q: any) => q.eq("productId", item.productId))
      .collect();
    const hasInitialLot = await hasInitialInventoryLot(
      existingLots,
      (entryId) => ctx.db.get(entryId as any)
    );

    if (hasInitialLot) {
      const product = await ctx.db.get(item.productId);
      throw new Error(
        `Produto "${product?.name ?? item.productId}" já possui carga inicial confirmada. ` +
          `Use saída, transferência ou inventário para ajustar.`
      );
    }
  }

  // ── Create entry header for the initial load ──
  const existingEntries = await ctx.db.query("entries").collect();
  const entryPrefix = `ENT-${year}-`;
  const entrySequence = existingEntries.reduce((max: number, entry: any) => {
    const match = String(entry.entryNumber ?? "").match(/^ENT-\d{4}-(\d+)$/);
    if (!match || !String(entry.entryNumber).startsWith(entryPrefix)) return max;
    const sequence = Number(match[1]);
    return Number.isSafeInteger(sequence) && sequence > max ? sequence : max;
  }, 0) + 1;
  const entryNumber = `${entryPrefix}${String(entrySequence).padStart(6, "0")}`;
  const entryId = await ctx.db.insert("entries", {
    entryNumber,
    receivedAt: now,
    originType: "initial_inventory",
    responsibleUserId: userId,
    // Estoque de implantação: o carimbo é metadado (data de implantação) e
    // preserva integralmente a observação original.
    observation: applyImplementationStockStamp(observation),
    status: "confirmed",
    createdAt: now,
    updatedAt: now,
  });

  const summary: string[] = [];
  let totalProductsUpdated = 0;
  let totalQuantityLoaded = 0;

  for (const item of items) {
    if (item.quantity === 0) continue;

      const location = await ctx.db.get(item.locationId);
      if (!location || !location.active) {
        throw new Error("O local físico precisa continuar ativo para concluir a carga inicial.");
      }
      const areaId = item.areaId;
      if (!areaId) {
        throw new Error(`Informe a área do produto ${item.productId}; o armário não determina o subestoque.`);
      }
      const area = await ctx.db.get(areaId);
      if (!area || !area.active) throw new Error("A área da carga inicial não existe ou está inativa.");

      // ── 1. Create lot for traceability ──
      const lotNumber = await generateLotNumber(ctx, item.productId);
      const lotId = await ctx.db.insert("lots", {
        lotNumber,
        productId: item.productId,
        entryId,
        quantityReceived: item.quantity,
        quantityAvailable: item.quantity,
        receivedAt: now,
        active: true,
        areaId,
        locationId: item.locationId,
        brand: item.brand?.trim() || undefined,
        model: item.model?.trim() || undefined,
        specification: item.specification?.trim() || undefined,
        observation: item.observation?.trim() || `Carga inicial — ${item.quantity} unidades`,
      });

      // ── 2. Create entry item ──
      await ctx.db.insert("entryItems", {
        entryId,
        productId: item.productId,
        quantity: item.quantity,
        // Preserva a UOM original informada (un, pc, cx, m, rl, pct, po, kt,
        // outro). NUNCA converte: 13 caixas continuam 13 cx, não 650 un.
        unitOfMeasure: item.unitOfMeasure ?? (await ctx.db.get(item.productId))?.unitOfMeasure ?? "un",
        lotId,
        locationId: item.locationId,
        areaId,
        brand: item.brand?.trim() || undefined,
        model: item.model?.trim() || undefined,
        specification: item.specification?.trim() || undefined,
        observation: item.observation?.trim() || undefined,
      });

      // ── 3. stockByLocation ──
      const existingSbl = await ctx.db
        .query("stockByLocation")
        .withIndex("by_product", (q: any) => q.eq("productId", item.productId))
        .collect();
      const sblForLocation = existingSbl.find(
        (s: any) => s.locationId === item.locationId &&
          (s.areaId ?? undefined) === (areaId ?? undefined)
      );

      if (sblForLocation) {
        await ctx.db.patch(sblForLocation._id, {
          quantity: sblForLocation.quantity + item.quantity,
        });
      } else {
        await ctx.db.insert("stockByLocation", {
          productId: item.productId,
          locationId: item.locationId,
          quantity: item.quantity,
          areaId,
        });
      }

      // ── 4. stock (global) ──
      const existingStockRows = await ctx.db
        .query("stock")
        .withIndex("by_product", (q: any) => q.eq("productId", item.productId))
        .collect();
      const productForLabel = await ctx.db.get(item.productId as any);
      const existingStock = getOptionalSingleValidGlobalStock(existingStockRows, productForLabel?.name ?? String(item.productId));

      const previousGlobal = existingStock?.physicalQuantity ?? 0;
      // Em produtos existentes, somar a carga ao saldo global preserva estoque
      // legado que ainda não possua linha em stockByLocation. Recalcular pela
      // soma dos locais aqui apagaria silenciosamente esse saldo.
      const newGlobal = existingStock
        ? previousGlobal + item.quantity
        : (await ctx.db
            .query("stockByLocation")
            .withIndex("by_product", (q: any) => q.eq("productId", item.productId))
            .collect())
            .reduce((sum: number, row: any) => sum + row.quantity, 0);

      if (existingStock) {
        await ctx.db.patch(existingStock._id, {
          physicalQuantity: newGlobal,
        });
      } else {
        await ctx.db.insert("stock", {
          productId: item.productId,
          physicalQuantity: newGlobal,
          reservedQuantity: 0,
        });
      }

      // ── 5. stockMovement (audit trail) ──
      await ctx.db.insert("stockMovements", {
        productId: item.productId,
        type: "adjustment",
        quantity: item.quantity,
        previousPhysical: previousGlobal,
        newPhysical: newGlobal,
        previousReserved: existingStock?.reservedQuantity ?? 0,
        newReserved: existingStock?.reservedQuantity ?? 0,
        userId,
        entryId,
        lotId: lotId as string,
        areaId,
        locationId: item.locationId,
        observation: `Carga inicial — lote ${lotNumber} — ${item.quantity} unidades`,
        timestamp: now,
      });

      const product = await ctx.db.get(item.productId);
      summary.push(
        `${product?.name ?? item.productId} → ${location?.name ?? item.locationId}: ${item.quantity} (lote ${lotNumber})`
      );
      totalQuantityLoaded += item.quantity;
      totalProductsUpdated++;
    }

    // ── Audit ──
    await ctx.db.insert("auditLogs", {
      userId,
      action: "create",
      entity: "stock",
      entityId: entryId,
      details: `Carga inicial: ${totalProductsUpdated} itens, ${totalQuantityLoaded} unidades total, entrada ${entryNumber}`,
      timestamp: now,
    });

    return {
      message: "Carga inicial concluída",
      entryNumber,
      productsUpdated: totalProductsUpdated,
      totalQuantity: totalQuantityLoaded,
      summary,
    };
}

/**
 * Carga inicial manual (implantação inicial).
 */
export const initialStockLoad = mutation({
  args: {
    items: v.array(
      v.object({
        productId: v.id("products"),
        locationId: v.id("storageLocations"),
        quantity: v.number(),
        unitOfMeasure: v.optional(v.string()),
        areaId: v.optional(v.id("stockAreas")),
      })
    ),
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAdmin(ctx);
    return performInitialLoad(
      ctx,
      userId,
      args.items,
      args.observation ?? "Carga inicial de estoque"
    );
  },
});

/**
 * Importação da planilha de inventário físico (implantação inicial em massa).
 *
 * Cada linha é associada a um produto existente pelo nome (sem duplicatas) ou
 * cria um produto novo (categoria padrão "Diversos" criada idempotentemente).
 * Depois reutiliza o MESMO núcleo da carga inicial: entrada, lote,
 * stockByLocation, stock, movimentação e auditoria.
 */
export const importInitialSheet = mutation({
  args: {
    rows: v.array(
      v.object({
        locationId: v.id("storageLocations"),
        productName: v.string(),
        brand: v.optional(v.string()),
        quantity: v.number(),
        unitOfMeasure: v.optional(v.string()),
        observation: v.optional(v.string()),
        areaId: v.optional(v.id("stockAreas")),
      })
    ),
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAdmin(ctx);

    if (!args.rows || args.rows.length === 0) {
      throw new Error("Nenhuma linha informada para importação");
    }

    // Categoria padrão para produtos novos (idempotente)
    const allCategories = await ctx.db.query("categories").collect();
    let fallbackCategory: any = allCategories.find(
      (c: any) => c.name.toLowerCase() === "diversos"
    );
    if (!fallbackCategory) {
      const catId = await ctx.db.insert("categories", {
        name: "Diversos",
        description: "Categoria padrão para itens importados da planilha inicial",
        active: true,
      });
      fallbackCategory = await ctx.db.get(catId);
    }

    const products = await ctx.db
      .query("products")
      .withIndex("by_active", (q: any) => q.eq("active", true))
      .collect();

    const items: Array<{
      productId: string;
      locationId: string;
      quantity: number;
      unitOfMeasure?: string;
      areaId?: string;
      brand?: string;
      observation?: string;
    }> = [];
    let matched = 0;
    let created = 0;

    for (const row of args.rows) {
      const name = (row.productName ?? "").trim();
      if (!name || row.quantity <= 0) continue;

      const existing = products.find(
        (p: any) => p.name.trim().toLowerCase() === name.toLowerCase()
      );
      // Toner de kit original de 4 cores (VersaLink, AltaLink, Lexmark CX735,
      // Lexmark XM5365): a observação padrão é aplicada (informação
      // observacional — nunca altera quantidade física nem agrupa produtos).
      const kitObservation = tonerKitObservation({
        name,
        brand: row.brand,
      });
      let productId: string;
      if (existing) {
        productId = existing._id;
        matched++;
        if (kitObservation && !existing.observation) {
          await ctx.db.patch(existing._id, { observation: kitObservation });
          await ctx.db.insert("auditLogs", {
            userId,
            action: "update",
            entity: "products",
            entityId: existing._id,
            details: `Observação de kit aplicada pela importação: ${kitObservation}`,
            timestamp: Date.now(),
          });
        }
      } else {
        const id = await ctx.db.insert("products", {
          name,
          categoryId: fallbackCategory._id,
          unitOfMeasure: row.unitOfMeasure ?? "un",
          brand: row.brand || undefined,
          observation: row.observation || kitObservation || undefined,
          minimumStock: 0,
          idealStock: 0,
          maximumStock: 0,
          active: true,
        });
        await ctx.db.insert("auditLogs", {
          userId,
          action: "create",
          entity: "products",
          entityId: id,
          details: `Produto criado pela importação da planilha inicial: ${name}`,
          timestamp: Date.now(),
        });
        products.push({ _id: id } as any);
        productId = id;
        created++;
      }

      items.push({
        productId,
        locationId: row.locationId,
        quantity: row.quantity,
        areaId: row.areaId,
        // UOM original da planilha: a quantidade fica semanticamente na
        // unidade registrada (cx permanece cx, pct permanece pct).
        unitOfMeasure: row.unitOfMeasure || (existing?.unitOfMeasure ?? "un"),
        brand: row.brand?.trim() || undefined,
        observation: row.observation?.trim() || undefined,
      });
    }

    if (items.length === 0) {
      throw new Error("Nenhuma linha válida para importar (verifique nomes e quantidades)");
    }

    const result = await performInitialLoad(
      ctx,
      userId,
      items,
      args.observation ?? "Importação da planilha de inventário físico"
    );

    return {
      ...result,
      matched,
      created,
      totalRows: args.rows.length,
    };
  },
});

/**
 * Resumo de localizações por produto (usado no fluxo "Dar saída").
 */
export const productLocationSummary = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const rows = await ctx.db.query("stockByLocation").collect();
    const byProduct = new Map<string, Array<{
      locationId: string; locationName: string; areaId: string | null;
      areaName: string; quantity: number;
    }>>();

    for (const row of rows) {
      const location = await ctx.db.get(row.locationId);
      if (!location) continue;
      const area = row.areaId ? await ctx.db.get(row.areaId) : null;
      const reservations = await ctx.db.query("requestItemReservations")
        .withIndex("by_product", (q: any) => q.eq("productId", row.productId))
        .collect();
      const reserved = reservations
        .filter((reservation: any) =>
          reservation.locationId === row.locationId &&
          reservation.areaId === (row.areaId ?? undefined)
        )
        .reduce((sum: number, reservation: any) => sum + reservation.quantityRemaining, 0);
      const entries = byProduct.get(row.productId) ?? [];
      entries.push({
        locationId: row.locationId,
        locationName: location.name,
        areaId: area ? area._id as string : null,
        areaName: area?.name ?? "Sem área — pendente de classificação",
        quantity: row.quantity - reserved,
      });
      byProduct.set(row.productId, entries);
    }
    return Array.from(byProduct.entries()).map(([productId, locations]) => ({ productId, locations }));
  },
});

/**
 * Quick stock exit (saída simples).
 * Simplified exit without the full request/approval flow.
 * Uses FIFO lot consumption. Reduces both global and location stock.
 */
export const quickExit = mutation({
  args: {
    productId: v.id("products"),
    areaId: v.id("stockAreas"),
    locationId: v.id("storageLocations"),
    quantity: v.number(),
    destination: v.string(),
    receiverName: v.string(),
    reason: v.optional(v.string()),
    osNumber: v.optional(v.string()),
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAdmin(ctx);
    args = { ...args, quantity: Number(args.quantity) };
    if (!Number.isFinite(args.quantity) || args.quantity <= 0) {
      throw new Error("Quantidade deve ser um número válido maior que zero");
    }
    if (args.destination.trim().length === 0 || args.receiverName.trim().length === 0) {
      throw new Error("Informe o destino e o nome de quem está recebendo o material.");
    }
    const product = await ctx.db.get(args.productId);
    if (!product || !product.active) throw new Error("Produto não encontrado ou inativo");
    if (product.hasSerial) {
      throw new Error("Este produto exige controle individual por número de série/patrimônio. Use a movimentação do equipamento, não a saída rápida por quantidade.");
    }
    if (isDiscreteStockUnit(product.unitOfMeasure, product.hasSerial) && !Number.isSafeInteger(args.quantity)) {
      throw new Error(`A quantidade de "${product.name}" deve ser inteira para a unidade ${product.unitOfMeasure}.`);
    }
    const area = await ctx.db.get(args.areaId);
    const location = await ctx.db.get(args.locationId);
    if (!area || !area.active || !location || !location.active) {
      throw new Error("A área/subestoque e o local físico precisam estar ativos.");
    }
    const stockRows = await ctx.db.query("stock")
      .withIndex("by_product", (q: any) => q.eq("productId", args.productId)).collect();
    if (stockRows.length !== 1) {
      throw new Error(stockRows.length === 0
        ? "Produto não possui registro de estoque"
        : "Há registros globais de estoque duplicados. Regularize antes da saída rápida.");
    }
    const stock = stockRows[0];
    if (!Number.isFinite(stock.physicalQuantity) || !Number.isFinite(stock.reservedQuantity) ||
        stock.physicalQuantity < 0 || stock.reservedQuantity < 0 ||
        stock.reservedQuantity > stock.physicalQuantity) {
      throw new Error("O saldo global está inconsistente. Regularize antes da saída rápida.");
    }
    const globalAvailable = stock.physicalQuantity - stock.reservedQuantity;
    if (args.quantity > globalAvailable) {
      throw new Error(`Estoque global insuficiente. Disponível: ${globalAvailable} ${product.unitOfMeasure}`);
    }

    const existingReservations = await ctx.db.query("requestItemReservations")
      .withIndex("by_product", (q: any) => q.eq("productId", args.productId)).collect();
    const areaReservedGlobal = existingReservations.reduce(
      (sum: number, reservation: any) => sum + reservation.quantityRemaining, 0
    );
    if (existingReservations.some((reservation: any) =>
      !Number.isFinite(reservation.quantityRemaining) || reservation.quantityRemaining < 0
    )) {
      throw new Error("Há reserva de solicitação com quantidade inválida. Regularize antes da saída rápida.");
    }
    if (Math.abs(areaReservedGlobal - stock.reservedQuantity) > 1e-9) {
      const legacyReserved = stock.reservedQuantity - areaReservedGlobal;
      throw new Error(legacyReserved > 0
        ? `Há ${legacyReserved} unidade(s) reservada(s) por solicitação antiga sem área. Conclua ou cancele essa solicitação antes da saída rápida.`
        : "As reservas por lote excedem o saldo reservado global. Regularize a divergência antes da saída rápida.");
    }
    const legacyReserved = Math.max(0, stock.reservedQuantity - areaReservedGlobal);
    if (legacyReserved > 0) {
      throw new Error(
        `Há ${legacyReserved} unidade(s) reservada(s) por solicitação antiga sem área. Conclua ou cancele essa solicitação antes da saída rápida.`
      );
    }

    const locationRows = await ctx.db.query("stockByLocation")
      .withIndex("by_product", (q: any) => q.eq("productId", args.productId)).collect();
    const matchingLocationRows = locationRows.filter((row: any) =>
      row.locationId === args.locationId && row.areaId === args.areaId
    );
    if (matchingLocationRows.length > 1) {
      throw new Error("Há saldos físicos duplicados nessa área/local. Regularize antes da saída rápida.");
    }
    const locationStock = matchingLocationRows[0] ?? null;
    if (!locationStock || !Number.isFinite(locationStock.quantity) || locationStock.quantity < args.quantity) {
      throw new Error(`Estoque insuficiente em "${area.name}" / "${location.name}". Disponível: ${locationStock?.quantity ?? 0}.`);
    }

    const productLots = await ctx.db.query("lots")
      .withIndex("by_product", (q: any) => q.eq("productId", args.productId)).collect();
    if (productLots.some((lot: any) => lot.materialType === "permanent")) {
      throw new Error("Material permanente deve ser movimentado pelo cadastro individual do patrimônio, não por saída agregada.");
    }
    const sourceLots = productLots.filter((lot: any) =>
      lot.areaId === args.areaId && lot.locationId === args.locationId
    );
    const sourceLotTotal = sourceLots.reduce((sum: number, lot: any) => {
      if (!Number.isFinite(lot.quantityAvailable) || lot.quantityAvailable < 0) {
        throw new Error(`O lote ${lot.lotNumber} possui saldo inválido. Regularize antes da saída rápida.`);
      }
      if (lot.active === false && lot.quantityAvailable > 0) {
        throw new Error(`O lote ${lot.lotNumber} está inativo com saldo positivo. Regularize antes da saída rápida.`);
      }
      return sum + lot.quantityAvailable;
    }, 0);
    if (Math.abs(sourceLotTotal - locationStock.quantity) > 1e-9) {
      throw new Error("O saldo do local diverge dos lotes registrados. Regularize antes da saída rápida.");
    }

    const reservedByLot = new Map<string, number>();
    for (const reservation of existingReservations as any[]) {
      const lot = productLots.find((candidate: any) => candidate._id === reservation.lotId);
      if (!lot || reservation.productId !== args.productId ||
          reservation.areaId !== lot.areaId || reservation.locationId !== lot.locationId) {
        throw new Error("Há reserva sem correspondência válida de produto, lote, área ou local.");
      }
      const remaining = Number(reservation.quantityRemaining);
      reservedByLot.set(String(lot._id), (reservedByLot.get(String(lot._id)) ?? 0) + remaining);
    }

    const candidates = [];
    for (const lot of sourceLots) {
      if (!lot.active) continue;
      const reserved = reservedByLot.get(String(lot._id)) ?? 0;
      const free = Number(lot.quantityAvailable) - reserved;
      if (free < -1e-9) {
        throw new Error(`O lote ${lot.lotNumber} possui reserva superior ao saldo físico.`);
      }
      candidates.push({ lot, free: Math.max(0, free) });
    }
    candidates.sort((a: any,b: any) =>
      a.lot.receivedAt - b.lot.receivedAt || a.lot.lotNumber.localeCompare(b.lot.lotNumber)
    );

    let remaining = args.quantity;
    const consumedLots: Array<{ lotId: string; quantity: number }> = [];
    for (const candidate of candidates) {
      if (remaining <= 0) break;
      const lot = await ctx.db.get(candidate.lot._id);
      if (!lot) throw new Error("Lote desapareceu durante a saída.");
      const reservations = await ctx.db.query("requestItemReservations")
        .withIndex("by_lot", (q: any) => q.eq("lotId", lot._id)).collect();
      const reserved = reservations.reduce((sum: number, reservation: any) => sum + reservation.quantityRemaining, 0);
      const free = Math.max(0, lot.quantityAvailable - reserved);
      const consume = Math.min(free, remaining);
      if (consume <= 0) continue;
      const nextQuantity = lot.quantityAvailable - consume;
      await ctx.db.patch(lot._id, { quantityAvailable: nextQuantity, active: nextQuantity > 0 });
      consumedLots.push({ lotId: lot._id as string, quantity: consume });
      remaining -= consume;
    }
    if (remaining > 0) {
      throw new Error(`Lotes insuficientes em "${area.name}" / "${location.name}". Faltam ${remaining} ${product.unitOfMeasure}.`);
    }

    const now = Date.now();
    const previousPhysical = stock.physicalQuantity;
    const previousReserved = stock.reservedQuantity;
    const newPhysical = previousPhysical - args.quantity;
    await ctx.db.patch(stock._id, { physicalQuantity: newPhysical });
    await ctx.db.patch(locationStock._id, { quantity: locationStock.quantity - args.quantity });

    const consumedLotId = resolveConsumedLotId(consumedLots as LotConsumption[]);
    const lotInfo = formatConsumedLots(consumedLots, (id) =>
      productLots.find((lot: any) => lot._id === id)?.lotNumber
    );
    const exitNumber = await generateExitNumber(ctx);
    const movementId = await ctx.db.insert("stockMovements", {
      productId: args.productId, type: "exit", quantity: args.quantity,
      previousPhysical, newPhysical, previousReserved, newReserved: previousReserved,
      userId, exitNumber, lotId: consumedLotId ?? undefined,
      areaId: args.areaId, locationId: args.locationId,
      observation: [
        `Saída rápida — ${args.receiverName}`,
        `Área: ${area.name}`,
        `Local: ${location.name}`,
        args.reason ? `Motivo: ${args.reason}` : "",
        args.osNumber ? `O.S.: ${args.osNumber}` : "",
        args.observation ?? "",
        `Destino: ${args.destination}`,
        `Lotes: ${lotInfo}`,
      ].filter(Boolean).join(" | "),
      timestamp: now,
    });
    for (const consumed of consumedLots) {
      await ctx.db.insert("stockMovementLots", {
        movementId,
        lotId: consumed.lotId as any,
        quantity: consumed.quantity,
        areaId: args.areaId,
        locationId: args.locationId,
      });
    }

    await ctx.db.insert("auditLogs", {
      userId, action: "move_stock", entity: "stock", entityId: args.productId,
      details: `Saída rápida: ${args.quantity}x ${product.name} — ${area.name} / ${location.name} → ${args.destination} (${args.receiverName})`,
      timestamp: now,
    });
    return {
      message: "Saída registrada com sucesso",
      quantity: args.quantity,
      product: product.name,
      newAvailable: newPhysical - previousReserved,
      lotsConsumed: consumedLots.length,
    };
  },
});

/**
 * Cleanup: remove test/homologation data.
 * Preserves users, passwords, auth, schema, audit logs.
 */
export const cleanupTestData = internalMutation({
  args: {
    confirm: v.literal(true),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAdmin(ctx);
    const deleted: Record<string, number> = {};

    // Delete draft entries
    const drafts = await ctx.db
      .query("entries")
      .withIndex("by_status", (q) => q.eq("status", "draft"))
      .collect();
    for (const d of drafts) {
      const items = await ctx.db
        .query("entryItems")
        .withIndex("by_entry", (q) => q.eq("entryId", d._id))
        .collect();
      for (const item of items) await ctx.db.delete(item._id);
      await ctx.db.delete(d._id);
    }
    deleted.entries_drafts = drafts.length;

    // Delete pending requests
    const pendingRequests = await ctx.db
      .query("requests")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();
    for (const r of pendingRequests) {
      const items = await ctx.db
        .query("requestItems")
        .withIndex("by_request", (q) => q.eq("requestId", r._id))
        .collect();
      for (const item of items) await ctx.db.delete(item._id);
      await ctx.db.delete(r._id);
    }
    deleted.requests_pending = pendingRequests.length;

    // Reset stock to zero
    const stocks = await ctx.db.query("stock").collect();
    for (const s of stocks) {
      await ctx.db.patch(s._id, { physicalQuantity: 0, reservedQuantity: 0 });
    }
    deleted.stocks_reset = stocks.length;

    // Reset lot quantities
    const lots = await ctx.db.query("lots").collect();
    for (const l of lots) {
      await ctx.db.patch(l._id, { quantityAvailable: 0 });
    }
    deleted.lots_reset = lots.length;

    // Delete stockByLocation
    const sbl = await ctx.db.query("stockByLocation").collect();
    for (const s of sbl) {
      await ctx.db.delete(s._id);
    }
    deleted.stockByLocation_deleted = sbl.length;

    // Audit
    await ctx.db.insert("auditLogs", {
      userId,
      action: "update",
      entity: "seed",
      details: `Limpeza de dados de homologação: ${JSON.stringify(deleted)}`,
      timestamp: Date.now(),
    });

    return { message: "Dados de homologação limpos", deleted };
  },
});

/**
 * Gestão de Estoque SGGD — ESTOQUE DE IMPLANTAÇÃO: validação de integridade (somente leitura).
 *
 * A carga inicial (originType "initial_inventory") representa o estoque físico
 * existente na data de implantação. Esta query NÃO altera nada: apenas confere
 *  - as entradas de implantação (itens, lotes, movimentações, unidades);
 *  - saldo global × saldo por localização, produto a produto;
 *  - ausência de duplicação (1 carga inicial por produto; sem nomes repetidos);
 *  - presença do carimbo de implantação na entrada.
 */
export const implementationStockStatus = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);

    const entries = await ctx.db.query("entries").collect();
    const initialEntries = entries.filter(
      (e) => e.originType === "initial_inventory"
    );
    const initialEntryIds = new Set<string>(initialEntries.map((e) => e._id as string));
    const allMovements = await ctx.db.query("stockMovements").collect();
    const allLots = await ctx.db.query("lots").collect();

    const productIds = new Set<string>();
    const entriesSummary: Array<{
      entryNumber: string;
      receivedAt: number;
      stamped: boolean;
      responsible: string | null;
      itemCount: number;
      lots: number;
      movements: number;
      units: number;
      observation: string | null;
    }> = [];
    let totalUnits = 0;
    let totalLots = 0;
    let totalMovements = 0;
    let totalItems = 0;

    for (const entry of initialEntries) {
      const items = await ctx.db
        .query("entryItems")
        .withIndex("by_entry", (q) => q.eq("entryId", entry._id))
        .collect();
      const entryLots = allLots.filter((l) => l.entryId === entry._id);
      const entryMovements = allMovements.filter((m) => m.entryId === entry._id);
      const responsible = await ctx.db.get(entry.responsibleUserId);
      const units = items.reduce((sum, i) => sum + i.quantity, 0);

      for (const lot of entryLots) productIds.add(lot.productId as string);
      totalUnits += units;
      totalLots += entryLots.length;
      totalMovements += entryMovements.length;
      totalItems += items.length;

      entriesSummary.push({
        entryNumber: entry.entryNumber,
        receivedAt: entry.receivedAt,
        stamped: isImplementationStockStamped(entry.observation),
        responsible: responsible?.name ?? responsible?.email ?? null,
        itemCount: items.length,
        lots: entryLots.length,
        movements: entryMovements.length,
        units,
        observation: entry.observation ?? null,
      });
    }

    // ── Saldo global × localização (produto a produto) ──
    const mismatches: Array<{
      productId: string;
      name: string;
      global: number;
      byLocation: number;
    }> = [];
    const initialLoadsPerProduct: Array<{
      productId: string;
      name: string;
      initialLots: number;
    }> = [];
    const locationTotals = new Map<string, { name: string; quantity: number }>();
    let globalTotal = 0;
    let byLocationTotal = 0;

    for (const productId of productIds) {
      const stock = await ctx.db
        .query("stock")
        .withIndex("by_product", (q) => q.eq("productId", productId as any))
        .first();
      const sblRows = await ctx.db
        .query("stockByLocation")
        .withIndex("by_product", (q) => q.eq("productId", productId as any))
        .collect();
      const product = (await ctx.db.get(productId as any)) as {
        name?: string;
      } | null;
      const physical = stock?.physicalQuantity ?? 0;
      const byLocation = sblRows.reduce((sum, row) => sum + row.quantity, 0);

      globalTotal += physical;
      byLocationTotal += byLocation;

      if (physical !== byLocation) {
        mismatches.push({
          productId,
          name: product?.name ?? productId,
          global: physical,
          byLocation,
        });
      }

      const initialLots = allLots.filter(
        (l) =>
          l.productId === productId &&
          !!l.entryId &&
          initialEntryIds.has(l.entryId) &&
          l.active
      ).length;
      if (initialLots > 1) {
        initialLoadsPerProduct.push({
          productId,
          name: product?.name ?? productId,
          initialLots,
        });
      }

      for (const row of sblRows) {
        const location = await ctx.db.get(row.locationId);
        const key = row.locationId as string;
        const current = locationTotals.get(key) ?? {
          name: location?.name ?? key,
          quantity: 0,
        };
        current.quantity += row.quantity;
        locationTotals.set(key, current);
      }
    }

    // ── Duplicação de cadastro (nomes repetidos entre produtos ativos) ──
    const activeProducts = await ctx.db
      .query("products")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();
    const nameCounts = new Map<string, number>();
    for (const product of activeProducts) {
      const key = product.name.trim().toLowerCase();
      nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
    }
    const duplicateProductNames: string[] = [];
    nameCounts.forEach((count, name) => {
      if (count > 1) duplicateProductNames.push(name);
    });

    return {
      implementationDate: IMPLEMENTATION_STOCK_DATE,
      entries: entriesSummary,
      totals: {
        entries: initialEntries.length,
        items: totalItems,
        units: totalUnits,
        lots: totalLots,
        movements: totalMovements,
        products: productIds.size,
      },
      stock: {
        globalTotal,
        byLocationTotal,
        consistent: mismatches.length === 0,
        mismatches,
      },
      locations: Array.from(locationTotals.entries()).map(([locationId, v]) => ({
        locationId,
        name: v.name,
        quantity: v.quantity,
      })),
      duplicates: {
        initialLoadsPerProduct,
        duplicateProductNames,
      },
      integrityOk:
        mismatches.length === 0 &&
        initialLoadsPerProduct.length === 0 &&
        duplicateProductNames.length === 0,
    };
  },
});

/**
 * Check if initial stock has been loaded.
 */
export const hasInitialStock = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const stocks = await ctx.db.query("stock").collect();
    const hasAny = stocks.some((s) => s.physicalQuantity > 0);
    return { hasInitialStock: hasAny, totalProducts: stocks.length };
  },
});

/**
 * Status da carga inicial por produto (usado pela tela de Implantação Inicial).
 * Retorna, para cada produto ativo, se ele já possui carga inicial confirmada.
 */
export const getInitialLoadStatus = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const products = await ctx.db
      .query("products")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();
    const lots = await ctx.db.query("lots").collect();
    const entryCache = new Map<string, any>();

    const result: Array<{ productId: string; loaded: boolean }> = [];
    for (const product of products) {
      const productLots = lots.filter((l) => l.productId === product._id);
      const loaded = await hasInitialInventoryLot(productLots, async (entryId) => {
        if (!entryCache.has(entryId)) {
          entryCache.set(entryId, await ctx.db.get(entryId as any));
        }
        return entryCache.get(entryId);
      });
      result.push({ productId: product._id, loaded });
    }
    return result;
  },
});

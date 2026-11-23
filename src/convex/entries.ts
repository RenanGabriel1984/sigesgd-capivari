import { query, mutation } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { validateEntryUnits } from "../lib/material-types";
import { getOptionalSingleValidGlobalStock, requireSingleValidGlobalStock, isDiscreteStockUnit } from "../lib/stock-quantity-rules";
import {
  duplicateInvoiceMessage,
  entryInvoiceFingerprint,
  findDuplicateInvoice,
  normalizeAccessKey,
  normalizeInvoiceNumber,
} from "../lib/entry-duplicates";
import { requirePermission } from "./rbac";
import { assertTextLimits, assertShortTextLimits, MAX_OBSERVATION } from "../lib/text-limits";
import { attachStorageFile } from "./storage";
import type { Doc, Id } from "./_generated/dataModel";
import { adjustLotLocationBalance } from "../lib/lot-location-balance";
import { resolveEntryItemAreaId, resolveEntryLotLocationId } from "../lib/entry-area-classification";

function assertNonNegativeFiniteAmount(value: number | undefined, label: string): void {
  if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
    throw new Error(`${label} deve ser um valor numérico finito e não negativo.`);
  }
}

function assertEntryFinancialValues(input: {
  totalValue?: number;
  unitCost?: number;
  totalCost?: number;
}, label: string): void {
  assertNonNegativeFiniteAmount(input.totalValue, `Valor total da ${label}`);
  assertNonNegativeFiniteAmount(input.unitCost, `Custo unitário de ${label}`);
  assertNonNegativeFiniteAmount(input.totalCost, `Custo total de ${label}`);
}

async function requireUser(ctx: QueryCtx | MutationCtx) {
  // RBAC central: entradas exigem sessão com visão de estoque.
  return requirePermission(ctx, "stock.view");
}

async function requireStockManagerOrAdmin(ctx: MutationCtx) {
  // RBAC central: operação de entradas (criar/confirmar/editar/estornar).
  return requirePermission(ctx, "entries.create", { entity: "entries" });
}

/**
 * Localiza uma entrada que já representa a MESMA nota (D5).
 *
 * A regra de comparação vive em `src/lib/entry-duplicates.ts` (testável); aqui
 * ficam apenas as consultas:
 *   • chave de acesso → índice exato `by_access_key`;
 *   • impressão digital fornecedor+número+série → `by_invoice_fingerprint`
 *     (entradas novas);
 *   • histórico anterior ao índice → janela recente por data, para que a
 *     proteção também valha contra notas registradas antes desta correção.
 *
 * Toda leitura abaixo entra no conjunto de leitura da mutation: duas criações
 * concorrentes da mesma nota disputam o mesmo range e o Convex serializa a
 * segunda (ela reavalia e enxerga a entrada recém-criada).
 */
async function findExistingInvoice(
  ctx: MutationCtx,
  probe: {
    accessKey?: string | null;
    invoiceNumber?: string | null;
    series?: string | null;
    supplierId?: string | null;
  },
  options: { excludeId?: string } = {},
) {
  const accessKey = normalizeAccessKey(probe.accessKey);
  const fingerprint = entryInvoiceFingerprint(probe);
  const candidates: Doc<"entries">[] = [];

  if (accessKey) {
    const byKey = await ctx.db
      .query("entries")
      .withIndex("by_access_key", (q) => q.eq("accessKey", accessKey))
      .collect();
    candidates.push(...byKey);
  }

  if (fingerprint) {
    const byFingerprint = await ctx.db
      .query("entries")
      .withIndex("by_invoice_fingerprint", (q) => q.eq("invoiceFingerprint", fingerprint))
      .collect();
    candidates.push(...byFingerprint);
  }

  if (normalizeInvoiceNumber(probe.invoiceNumber)) {
    const recent = await ctx.db
      .query("entries")
      .withIndex("by_date")
      .order("desc")
      .collect();
    candidates.push(...recent);
  }

  return findDuplicateInvoice(
    candidates,
    {
      accessKey: accessKey || undefined,
      invoiceNumber: probe.invoiceNumber,
      series: probe.series,
      supplierId: probe.supplierId,
    },
    options,
  );
}

/** Generate sequential entry number: ENT-ANO-SEQUENCIAL */
async function generateEntryNumber(ctx: MutationCtx): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `ENT-${year}-`;
  const existing = await ctx.db.query("entries").withIndex("by_number", (q) => q.gte("entryNumber", prefix)).collect();
  const maxNum = existing.reduce((max: number, e) => {
    const match = e.entryNumber.match(/^ENT-\d{4}-(\d+)$/);
    if (match && e.entryNumber.startsWith(prefix)) {
      const num = parseInt(match[1], 10);
      return num > max ? num : max;
    }
    return max;
  }, 0);
  return `ENT-${year}-${String(maxNum + 1).padStart(6, "0")}`;
}

/** Generate sequential lot number: LOT-ANO-SEQUENCIAL */
async function generateLotNumber(ctx: MutationCtx): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `LOT-${year}-`;
  const existing = await ctx.db.query("lots").withIndex("by_number", (q) => q.gte("lotNumber", prefix)).collect();
  const maxNum = existing.reduce((max: number, l) => {
    const match = l.lotNumber.match(/^LOT-\d{4}-(\d+)$/);
    if (match && l.lotNumber.startsWith(prefix)) {
      const num = parseInt(match[1], 10);
      return num > max ? num : max;
    }
    return max;
  }, 0);
  return `LOT-${year}-${String(maxNum + 1).padStart(6, "0")}`;
}

// ─── Queries ─────────────────────────────────────────────────────────────────

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const entries = await ctx.db.query("entries").withIndex("by_date").order("desc").collect();
    return Promise.all(entries.map(async (e) => {
      const responsible = await ctx.db.get(e.responsibleUserId);
      const supplier = e.supplierId ? await ctx.db.get(e.supplierId) : null;
      const items = await ctx.db.query("entryItems").withIndex("by_entry", (q) => q.eq("entryId", e._id)).collect();
      const itemsWithProduct = await Promise.all(items.map(async (item) => {
        const product = await ctx.db.get(item.productId);
        const location = item.locationId ? await ctx.db.get(item.locationId) : null;
        const area = item.areaId ? await ctx.db.get(item.areaId) : null;
        const units = await ctx.db.query("entryItemUnits").withIndex("by_entryItem", (q) => q.eq("entryItemId", item._id)).collect();
        return { ...item, product, location, area, units };
      }));
      const area = e.areaId ? await ctx.db.get(e.areaId) : null;
      return { ...e, responsible, supplier, area, items: itemsWithProduct };
    }));
  },
});

export const listPage = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const page = await ctx.db.query("entries").withIndex("by_date").order("desc").paginate(args.paginationOpts);
    const enriched = await Promise.all(page.page.map(async (e) => {
      const responsible = await ctx.db.get(e.responsibleUserId);
      const supplier = e.supplierId ? await ctx.db.get(e.supplierId) : null;
      const items = await ctx.db.query("entryItems").withIndex("by_entry", (q) => q.eq("entryId", e._id)).collect();
      const itemsWithProduct = await Promise.all(items.map(async (item) => {
        const product = await ctx.db.get(item.productId);
        const location = item.locationId ? await ctx.db.get(item.locationId) : null;
        const area = item.areaId ? await ctx.db.get(item.areaId) : null;
        const units = await ctx.db.query("entryItemUnits").withIndex("by_entryItem", (q) => q.eq("entryItemId", item._id)).collect();
        return { ...item, product, location, area, units };
      }));
      const area = e.areaId ? await ctx.db.get(e.areaId) : null;
      return { ...e, responsible, supplier, area, items: itemsWithProduct };
    }));
    return { ...page, page: enriched };
  },
});

export const get = query({
  args: { entryId: v.id("entries") },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const entry = await ctx.db.get(args.entryId);
    if (!entry) return null;
    const responsible = await ctx.db.get(entry.responsibleUserId);
    const supplier = entry.supplierId ? await ctx.db.get(entry.supplierId) : null;
    const items = await ctx.db.query("entryItems").withIndex("by_entry", (q) => q.eq("entryId", entry._id)).collect();
    const itemsWithProduct = await Promise.all(items.map(async (item) => {
      const product = await ctx.db.get(item.productId);
      const location = item.locationId ? await ctx.db.get(item.locationId) : null;
      const area = item.areaId ? await ctx.db.get(item.areaId) : null;
      const units = await ctx.db.query("entryItemUnits").withIndex("by_entryItem", (q) => q.eq("entryItemId", item._id)).collect();
      return { ...item, product, location, area, units };
    }));
    const lots = await ctx.db.query("lots").withIndex("by_entry", (q) => q.eq("entryId", entry._id)).collect();
    const area = entry.areaId ? await ctx.db.get(entry.areaId) : null;
    return { ...entry, responsible, supplier, area, items: itemsWithProduct, lots };
  },
});

export const getByLot = query({
  args: { lotNumber: v.string() },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const lotMatches = await ctx.db.query("lots")
      .withIndex("by_number", (q) => q.eq("lotNumber", args.lotNumber))
      .collect();
    if (lotMatches.length === 0) return null;
    if (lotMatches.length > 1) {
      throw new Error(
        `Número de lote "${args.lotNumber}" duplicado (${lotMatches.length} registros). Consulte o cadastro do lote antes de continuar.`
      );
    }
    const lot = lotMatches[0];
    const product = await ctx.db.get(lot.productId);
    const entry = await ctx.db.get(lot.entryId);
    const supplier = lot.supplierId ? await ctx.db.get(lot.supplierId) : null;
    return { ...lot, product, entry, supplier };
  },
});

// ─── Mutations ───────────────────────────────────────────────────────────────

/** Create a draft entry (multiple items). Does NOT modify stock. */
export const create = mutation({
  args: {
    receivedAt: v.number(),
    originType: v.union(
      v.literal("purchase"), v.literal("donation"), v.literal("transfer"),
      v.literal("return"), v.literal("initial_inventory"), v.literal("other")
    ),
    supplierId: v.optional(v.id("suppliers")),
    invoiceNumber: v.optional(v.string()),
    invoiceDate: v.optional(v.string()),
    purchaseAuthorizationNumber: v.optional(v.string()),
    processNumber: v.optional(v.string()),
    empenhoNumber: v.optional(v.string()),
    contractNumber: v.optional(v.string()),
    observation: v.optional(v.string()),
    documentStorageId: v.optional(v.string()),
    // ── NF-e importada (XML) ──
    accessKey: v.optional(v.string()),
    series: v.optional(v.string()),
    totalValue: v.optional(v.number()),
    xmlStorageId: v.optional(v.string()),
    importedFromXml: v.optional(v.boolean()),
    // ── Classificação da entrada — OBRIGATÓRIA (D1) ──
    // Sem esta escolha a entrada não é criada: o sistema não presume que toda
    // entrada é material de consumo. Entradas históricas continuam com o campo
    // opcional no schema; a obrigatoriedade vale para novas criações.
    materialType: v.union(v.literal("consumption"), v.literal("permanent")),
    // ── Área/Subestoque de destino — ESCOLHA do usuário (nunca derivada
    // automaticamente do fornecedor nem da categoria) ──
    areaId: v.id("stockAreas"),
    items: v.array(v.object({
      productId: v.id("products"),
      quantity: v.number(),
      unitOfMeasure: v.string(),
      unitCost: v.optional(v.number()),
      totalCost: v.optional(v.number()),
      brand: v.optional(v.string()),
      model: v.optional(v.string()),
      specification: v.optional(v.string()),
      locationId: v.optional(v.id("storageLocations")),
      areaId: v.optional(v.id("stockAreas")),
      photoStorageId: v.optional(v.string()),
      supplierLotNumber: v.optional(v.string()),
      observation: v.optional(v.string()),
      // ── Identificadores originais da NF-e ──
      supplierCode: v.optional(v.string()),
      ncm: v.optional(v.string()),
      cfop: v.optional(v.string()),
      ean: v.optional(v.string()),
      matchSource: v.optional(v.string()),
      matchScore: v.optional(v.number()),
      associationType: v.optional(v.string()),
    })),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireStockManagerOrAdmin(ctx);
    assertTextLimits({ observation: args.observation }, MAX_OBSERVATION);
    assertShortTextLimits({ invoiceNumber: args.invoiceNumber, purchaseAuthorizationNumber: args.purchaseAuthorizationNumber, processNumber: args.processNumber, empenhoNumber: args.empenhoNumber, contractNumber: args.contractNumber });

    if (args.items.length === 0) throw new Error("A entrada deve ter pelo menos um item");
    assertEntryFinancialValues({ totalValue: args.totalValue }, "entrada");

    // ── Anti-duplicidade (D5): chave de acesso OU fornecedor+número+série ──
    // Vale para importação XML/DANFE E para a entrada manual. Entrada estornada
    // não bloqueia (a nota pode ser registrada de novo, com histórico).
    const accessKey = normalizeAccessKey(args.accessKey) || undefined;
    const existingInvoice = await findExistingInvoice(ctx, {
      accessKey,
      invoiceNumber: args.invoiceNumber,
      series: args.series,
      supplierId: args.supplierId,
    });
    if (existingInvoice) {
      throw new Error(
        duplicateInvoiceMessage(existingInvoice, {
          accessKey,
          invoiceNumber: args.invoiceNumber,
          series: args.series,
          supplierId: args.supplierId,
        }),
      );
    }

    // Validate each item
    for (const item of args.items) {
      assertTextLimits({ observation: item.observation, specification: item.specification }, MAX_OBSERVATION);
      assertShortTextLimits({ brand: item.brand, model: item.model, supplierLotNumber: item.supplierLotNumber, supplierCode: item.supplierCode, ncm: item.ncm, cfop: item.cfop, ean: item.ean });
      assertEntryFinancialValues({ unitCost: item.unitCost, totalCost: item.totalCost }, `item ${item.productId}`);
      if (item.quantity <= 0) throw new Error(`Quantidade inválida para o item ${item.productId}`);
      if (!isFinite(item.quantity)) throw new Error(`Quantidade não finita para o item ${item.productId}`);
      const product = await ctx.db.get(item.productId);
      if (!product) throw new Error(`Produto não encontrado: ${item.productId}`);
      if (!product.active) throw new Error(`O produto "${product.name}" está inativo`);
      if (item.areaId) {
        const itemArea = await ctx.db.get(item.areaId);
        if (!itemArea || !itemArea.active) {
          throw new Error(`A área selecionada para "${product.name}" não existe ou está inativa.`);
        }
      }
    }

    const now = Date.now();
    const entryNumber = await generateEntryNumber(ctx);
    // Impressão digital normalizada (fornecedor+número+série) — permite a
    // checagem exata de duplicidade das entradas criadas a partir daqui.
    const invoiceFingerprint = entryInvoiceFingerprint({
      supplierId: args.supplierId,
      invoiceNumber: args.invoiceNumber,
      series: args.series,
    });

    // Toda entrada nova precisa de área ativa. O campo no schema permanece
    // opcional apenas para preservar documentos históricos já existentes.
    const destinationArea = await ctx.db.get(args.areaId);
    if (!destinationArea || !destinationArea.active) {
      throw new Error("Selecione uma área/subestoque ativo para esta entrada.");
    }

    const entryId = await ctx.db.insert("entries", {
      entryNumber,
      receivedAt: args.receivedAt,
      originType: args.originType,
      supplierId: args.supplierId,
      invoiceNumber: args.invoiceNumber || undefined,
      invoiceDate: args.invoiceDate || undefined,
      purchaseAuthorizationNumber: args.purchaseAuthorizationNumber || undefined,
      processNumber: args.processNumber || undefined,
      empenhoNumber: args.empenhoNumber || undefined,
      contractNumber: args.contractNumber || undefined,
      responsibleUserId: userId,
      observation: args.observation || undefined,
      documentStorageId: args.documentStorageId || undefined,
      accessKey,
      invoiceFingerprint,
      series: args.series || undefined,
      totalValue: args.totalValue,
      xmlStorageId: args.xmlStorageId || undefined,
      importedFromXml: args.importedFromXml || undefined,
      status: "draft",
      // O tipo de material é ESCOLHA do usuário e chega por ARGUMENTO
      // (ver `resolveNfeDestination` em src/lib/nfe-destination.ts). Não existe
      // default: o valor é persistido exatamente como enviado — "permanent"
      // nunca é rebaixado para "consumption".
      materialType: args.materialType,
      areaId: args.areaId,
      createdAt: now,
      updatedAt: now,
    });

    if (args.documentStorageId) {
      await attachStorageFile(ctx, args.documentStorageId, "entry", String(entryId), String(userId));
    }
    if (args.xmlStorageId) {
      await attachStorageFile(ctx, args.xmlStorageId, "entry", String(entryId), String(userId));
    }

    for (const item of args.items) {
      const itemId = await ctx.db.insert("entryItems", {
        entryId,
        productId: item.productId,
        quantity: item.quantity,
        unitOfMeasure: item.unitOfMeasure,
        unitCost: item.unitCost,
        totalCost: item.totalCost,
        brand: item.brand,
        model: item.model,
        specification: item.specification,
        locationId: item.locationId,
        areaId: item.areaId,
        photoStorageId: item.photoStorageId,
        supplierLotNumber: item.supplierLotNumber || undefined,
        observation: item.observation,
        supplierCode: item.supplierCode || undefined,
        ncm: item.ncm || undefined,
        cfop: item.cfop || undefined,
        ean: item.ean || undefined,
        matchSource: item.matchSource,
        matchScore: item.matchScore,
        associationType: item.associationType,
      });
      if (item.photoStorageId) {
        await attachStorageFile(ctx, item.photoStorageId, "entryItem", String(itemId), String(userId));
      }
    }

    await ctx.db.insert("auditLogs", {
      userId, action: "create", entity: "entries", entityId: entryId,
      details: `Entrada ${entryNumber} criada com ${args.items.length} item(ns) (rascunho)`,
      timestamp: now,
    });

    // O número volta junto com o id: a interface consegue mostrar o rascunho
    // pendente (D4) sem uma segunda consulta.
    return { entryId, entryNumber };
  },
});

/**
 * Confirm an entry: atomically creates lots, updates stock, creates movements.
 * This is an indivisible operation.
 */
/**
 * Classifica rascunho antigo antes da confirmação, sem reescrever itens
 * individuais que já tenham uma área própria.
 */
export const updateDraftArea = mutation({
  args: {
    entryId: v.id("entries"),
    areaId: v.id("stockAreas"),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireStockManagerOrAdmin(ctx);
    const entry = await ctx.db.get(args.entryId);
    if (!entry) throw new Error("Entrada não encontrada.");
    if (entry.status !== "draft") throw new Error("Apenas rascunhos podem receber classificação de área.");
    const area = await ctx.db.get(args.areaId);
    if (!area || !area.active) throw new Error("Selecione uma área/subestoque ativo.");

    if (entry.areaId !== args.areaId) {
      await ctx.db.patch(args.entryId, { areaId: args.areaId, updatedAt: Date.now() });
      await ctx.db.insert("auditLogs", {
        userId,
        action: "update",
        entity: "entries",
        entityId: args.entryId,
        details: `Área/subestoque do rascunho ${entry.entryNumber} definida como "${area.name}" antes da confirmação.`,
        timestamp: Date.now(),
      });
    }
    return args.entryId;
  },
});

export const confirm = mutation({
  args: { entryId: v.id("entries") },
  handler: async (ctx, args) => {
    const { userId } = await requireStockManagerOrAdmin(ctx);

    const entry = await ctx.db.get(args.entryId);
    if (!entry) throw new Error("Entrada não encontrada");
    if (entry.status !== "draft") throw new Error("Apenas entradas em rascunho podem ser confirmadas");

    const items = await ctx.db.query("entryItems").withIndex("by_entry", (q) => q.eq("entryId", args.entryId)).collect();
    if (items.length === 0) throw new Error("Entrada não possui itens");

    // ── Segunda barreira de duplicidade (D5) ──
    // Dois rascunhos da mesma nota podem existir (criados antes desta correção
    // ou por um cliente que ignorou a interface). Confirmar os dois dobraria o
    // estoque — aqui a nota é recusada antes de qualquer escrita.
    const conflictingInvoice = await findExistingInvoice(
      ctx,
      {
        accessKey: entry.accessKey,
        invoiceNumber: entry.invoiceNumber,
        series: entry.series,
        supplierId: entry.supplierId,
      },
      { excludeId: args.entryId },
    );
    if (conflictingInvoice) {
      throw new Error(duplicateInvoiceMessage(conflictingInvoice, entry));
    }

    // ── Unidades patrimoniais (material permanente) ──
    const entryUnits = await ctx.db
      .query("entryItemUnits")
      .withIndex("by_entry", (q) => q.eq("entryId", args.entryId))
      .collect();
    if (entry.materialType === "permanent") {
      for (const item of items) {
        const product = await ctx.db.get(item.productId);
        const itemUnits = entryUnits
          .filter((u) => u.entryItemId === item._id)
          .map((u) => ({
            patrimonyNumber: u.patrimonyNumber,
            serialNumber: u.serialNumber,
          }));
        const unitError = validateEntryUnits({
          materialType: "permanent",
          quantity: item.quantity,
          units: itemUnits,
          productName: product?.name,
          requireSerial: product?.hasSerial === true,
        });
        if (unitError) throw new Error(unitError);
      }
    } else if (entryUnits.length > 0) {
      throw new Error(
        "Esta entrada é de material de consumo e não possui unidades patrimoniais. " +
        "Remova as unidades ou classifique a entrada como material permanente."
      );
    }

    // Área de negócio e local físico são dimensões independentes.
    // entries.areaId é a área padrão; item.areaId pode sobrescrever por linha.
    const itemAreas = new Map<Id<"entryItems">, Id<"stockAreas">>();
    if (entry.areaId) {
      const defaultArea = await ctx.db.get(entry.areaId);
      if (!defaultArea || !defaultArea.active) {
        throw new Error("A área/subestoque padrão da entrada não existe ou está inativa.");
      }
    }
    for (const item of items) {
      if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
        throw new Error(`Quantidade inválida para o item ${item.productId}.`);
      }
      const product = await ctx.db.get(item.productId);
      if (!product || !product.active) {
        throw new Error(`Produto ${product?.name ?? item.productId} não encontrado ou inativo.`);
      }
      if (product.hasSerial && entry.materialType !== "permanent") {
        throw new Error(`"${product.name}" exige controle individual por série/patrimônio. Classifique a entrada como material permanente e informe as unidades.`);
      }
      if (entry.materialType !== "permanent" &&
          isDiscreteStockUnit(item.unitOfMeasure, product.hasSerial) &&
          !Number.isSafeInteger(item.quantity)) {
        throw new Error(`A quantidade de "${product.name}" deve ser inteira para a unidade ${item.unitOfMeasure}.`);
      }

      const globalRows = await ctx.db.query("stock")
        .withIndex("by_product", (q) => q.eq("productId", item.productId))
        .collect();
      getOptionalSingleValidGlobalStock(globalRows, product.name);

      const effectiveAreaId = resolveEntryItemAreaId(item.areaId, entry.areaId);
      if (!effectiveAreaId) {
        throw new Error(
          `A entrada ${entry.entryNumber} não possui área/subestoque definida para "${product.name}". ` +
          "Classifique o rascunho antes de confirmar; o armário não determina a área."
        );
      }
      const areaId = effectiveAreaId as Id<"stockAreas">;
      const area = await ctx.db.get(areaId);
      if (!area || !area.active) {
        throw new Error(`A área selecionada para "${product.name}" não existe ou está inativa.`);
      }
      itemAreas.set(item._id, areaId);
      if (!item.locationId) {
        const product = await ctx.db.get(item.productId);
        throw new Error(`Selecione o local físico para "${product?.name ?? "o item"}" antes de confirmar esta entrada.`);
      }
      const location = await ctx.db.get(item.locationId);
      if (!location || !location.active) {
        throw new Error("Um dos locais físicos selecionados não existe ou está inativo.");
      }
      const locationRows = await ctx.db.query("stockByLocation")
        .withIndex("by_product", (q) => q.eq("productId", item.productId))
        .collect();
      const sameScope = locationRows.filter((row) =>
        row.locationId === item.locationId &&
        (row.areaId ?? undefined) === (effectiveAreaId ?? undefined)
      );
      if (sameScope.length > 1) {
        throw new Error("Há saldos físicos duplicados para o produto na mesma área/local. Regularize antes de confirmar a entrada.");
      }
      if (sameScope[0] && (!Number.isFinite(sameScope[0].quantity) || sameScope[0].quantity < 0)) {
        throw new Error("O saldo físico da área/local está inválido. Regularize antes de confirmar a entrada.");
      }
    }
    const now = Date.now();
    const confirmedItemDetails: string[] = [];

    for (const item of items) {
      const itemAreaId = itemAreas.get(item._id);
      // Validate product
      const product = await ctx.db.get(item.productId);
      if (!product) throw new Error(`Produto não encontrado para item da entrada`);
      if (!product.active) throw new Error(`O produto "${product.name}" está inativo — não é possível confirmar entrada`);

      // Generate lot
      const lotNumber = await generateLotNumber(ctx);
      const lotId = await ctx.db.insert("lots", {
        lotNumber,
        productId: item.productId,
        entryId: args.entryId,
        brand: item.brand,
        model: item.model,
        specification: item.specification,
        quantityReceived: item.quantity,
        quantityAvailable: item.quantity,
        unitCost: item.unitCost,
        receivedAt: entry.receivedAt,
        supplierId: entry.supplierId,
        invoiceNumber: entry.invoiceNumber,
        purchaseAuthorizationNumber: entry.purchaseAuthorizationNumber,
        photoStorageId: item.photoStorageId,
        supplierLotNumber: item.supplierLotNumber || undefined,
        active: true,
        observation: item.observation,
        materialType: entry.materialType,
        areaId: itemAreaId,
        locationId: item.locationId,
      });
      await adjustLotLocationBalance(ctx, {
        lotId, productId: item.productId, locationId: item.locationId,
        delta: item.quantity, expectedQuantityBefore: 0, allowCreate: true,
      });
      if (item.photoStorageId) {
        await attachStorageFile(ctx, item.photoStorageId, "lot", String(lotId), String(userId));
      }

      // Rastreabilidade Entrada → EntryItem → Lote → Movimentação.
      // Sem este back-patch, `entryItems.lotId` ficava ausente (foi o caso dos
      // 8 itens da ENT-2026-000002) e o detalhe da entrada não conseguia ligar
      // o item ao lote que ele gerou.
      await ctx.db.patch(item._id, {
        lotId: lotId as string,
        areaId: itemAreaId,
      });

      // Update stock (increase physicalQuantity)
      const stockRows = await ctx.db.query("stock")
        .withIndex("by_product", (q) => q.eq("productId", item.productId)).collect();
      const stock = getOptionalSingleValidGlobalStock(stockRows, product.name);
      const prevPhysical = stock?.physicalQuantity ?? 0;
      const prevReserved = stock?.reservedQuantity ?? 0;
      const newPhysical = prevPhysical + item.quantity;

      if (stock) {
        await ctx.db.patch(stock._id, { physicalQuantity: newPhysical });
      } else {
        await ctx.db.insert("stock", { productId: item.productId, physicalQuantity: item.quantity, reservedQuantity: 0 });
      }

      // Update stock by location (saldo por localização) — keeps global × location consistent
      if (item.locationId) {
        const sblList = await ctx.db.query("stockByLocation").withIndex("by_product", (q) => q.eq("productId", item.productId)).collect();
        const sbl = sblList.find((s) =>
          s.locationId === item.locationId &&
          (s.areaId ?? undefined) === (itemAreaId ?? undefined)
        );
        if (sbl) {
          await ctx.db.patch(sbl._id, { quantity: sbl.quantity + item.quantity });
        } else {
          await ctx.db.insert("stockByLocation", {
            productId: item.productId, locationId: item.locationId,
            quantity: item.quantity, areaId: itemAreaId,
          });
        }
      }

      // Create movement record
      await ctx.db.insert("stockMovements", {
        productId: item.productId,
        type: "entry",
        quantity: item.quantity,
        previousPhysical: prevPhysical,
        newPhysical,
        previousReserved: prevReserved,
        newReserved: prevReserved,
        userId,
        entryId: args.entryId,
        lotId: lotNumber,
        areaId: itemAreaId,
        locationId: item.locationId,
        documentNumber: entry.invoiceNumber,
        observation: `Entrada ${entry.entryNumber} — Lote ${lotNumber}`,
        timestamp: now,
      });

      confirmedItemDetails.push(`${product.name}: +${item.quantity} (${lotNumber})`);
    }

    // Update entry status
    await ctx.db.patch(args.entryId, { status: "confirmed", updatedAt: now });

    // Audit log
    await ctx.db.insert("auditLogs", {
      userId, action: "confirm_entry", entity: "entries", entityId: args.entryId,
      details: `Entrada ${entry.entryNumber} confirmada. Itens: ${confirmedItemDetails.join("; ")}`,
      timestamp: now,
    });

    return args.entryId;
  },
});

// ─── Draft Item Management ──────────────────────────────────────────────────

/** Add an item to a draft entry. Does NOT modify stock. */
export const addItem = mutation({
  args: {
    entryId: v.id("entries"),
    productId: v.id("products"),
    quantity: v.number(),
    unitOfMeasure: v.string(),
    unitCost: v.optional(v.number()),
    totalCost: v.optional(v.number()),
    brand: v.optional(v.string()),
    model: v.optional(v.string()),
    specification: v.optional(v.string()),
    locationId: v.optional(v.id("storageLocations")),
    areaId: v.optional(v.id("stockAreas")),
    photoStorageId: v.optional(v.string()),
    supplierLotNumber: v.optional(v.string()),
    observation: v.optional(v.string()),
    supplierCode: v.optional(v.string()),
    ncm: v.optional(v.string()),
    cfop: v.optional(v.string()),
    ean: v.optional(v.string()),
    matchSource: v.optional(v.string()),
    matchScore: v.optional(v.number()),
    associationType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireStockManagerOrAdmin(ctx);
    assertTextLimits({ observation: args.observation }, MAX_OBSERVATION);
    assertTextLimits({ specification: args.specification }, MAX_OBSERVATION);
    assertShortTextLimits({ brand: args.brand, model: args.model, supplierLotNumber: args.supplierLotNumber });
    const entry = await ctx.db.get(args.entryId);
    if (!entry) throw new Error("Entrada não encontrada");
    if (entry.status !== "draft") throw new Error("Apenas entradas em rascunho podem ter itens adicionados");
    if (args.quantity <= 0) throw new Error("A quantidade deve ser maior que zero");
    if (!isFinite(args.quantity)) throw new Error("Quantidade inválida");
    assertEntryFinancialValues({ unitCost: args.unitCost, totalCost: args.totalCost }, "item");

    const product = await ctx.db.get(args.productId);
    if (!product) throw new Error("Produto não encontrado");
    if (!product.active) throw new Error(`O produto "${product.name}" está inativo`);

    const itemId = await ctx.db.insert("entryItems", {
      entryId: args.entryId,
      productId: args.productId,
      quantity: args.quantity,
      unitOfMeasure: args.unitOfMeasure,
      unitCost: args.unitCost,
      totalCost: args.totalCost,
      brand: args.brand,
      model: args.model,
      specification: args.specification,
      locationId: args.locationId,
      areaId: args.areaId,
      photoStorageId: args.photoStorageId,
      supplierLotNumber: args.supplierLotNumber || undefined,
      observation: args.observation,
      supplierCode: args.supplierCode || undefined,
      ncm: args.ncm || undefined,
      cfop: args.cfop || undefined,
      ean: args.ean || undefined,
      matchSource: args.matchSource,
      matchScore: args.matchScore,
      associationType: args.associationType,
    });

    if (args.photoStorageId) {
      await attachStorageFile(ctx, args.photoStorageId, "entryItem", String(itemId), String(userId));
    }
    await ctx.db.patch(args.entryId, { updatedAt: Date.now() });
    await ctx.db.insert("auditLogs", {
      userId, action: "update", entity: "entryItems", entityId: itemId,
      details: `Item adicionado à entrada ${entry.entryNumber}: ${product.name} x${args.quantity}`,
      timestamp: Date.now(),
    });
    return itemId;
  },
});

/** Update an item in a draft entry. Does NOT modify stock. */
export const updateItem = mutation({
  args: {
    itemId: v.id("entryItems"),
    productId: v.optional(v.id("products")),
    quantity: v.optional(v.number()),
    unitOfMeasure: v.optional(v.string()),
    unitCost: v.optional(v.number()),
    totalCost: v.optional(v.number()),
    brand: v.optional(v.string()),
    model: v.optional(v.string()),
    specification: v.optional(v.string()),
    locationId: v.optional(v.id("storageLocations")),
    areaId: v.optional(v.id("stockAreas")),
    photoStorageId: v.optional(v.string()),
    supplierLotNumber: v.optional(v.string()),
    observation: v.optional(v.string()),
    matchSource: v.optional(v.string()),
    matchScore: v.optional(v.number()),
    associationType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireStockManagerOrAdmin(ctx);
    assertTextLimits({ observation: args.observation }, MAX_OBSERVATION);
    assertTextLimits({ specification: args.specification }, MAX_OBSERVATION);
    assertShortTextLimits({ brand: args.brand, model: args.model, supplierLotNumber: args.supplierLotNumber });
    const item = await ctx.db.get(args.itemId);
    if (!item) throw new Error("Item não encontrado");

    const entry = await ctx.db.get(item.entryId);
    if (!entry) throw new Error("Entrada não encontrada");
    if (entry.status !== "draft") throw new Error("Apenas entradas em rascunho podem ter itens alterados");

    if (args.quantity !== undefined) {
      if (args.quantity <= 0) throw new Error("A quantidade deve ser maior que zero");
      if (!isFinite(args.quantity)) throw new Error("Quantidade inválida");
    }
    assertEntryFinancialValues({ unitCost: args.unitCost, totalCost: args.totalCost }, "item");

    if (args.productId) {
      const product = await ctx.db.get(args.productId);
      if (!product) throw new Error("Produto não encontrado");
      if (!product.active) throw new Error(`O produto "${product.name}" está inativo`);
    }

    const updates: Record<string, any> = {};
    if (args.productId !== undefined) updates.productId = args.productId;
    if (args.quantity !== undefined) updates.quantity = args.quantity;
    if (args.unitOfMeasure !== undefined) updates.unitOfMeasure = args.unitOfMeasure;
    if (args.unitCost !== undefined) updates.unitCost = args.unitCost;
    if (args.totalCost !== undefined) updates.totalCost = args.totalCost;
    if (args.brand !== undefined) updates.brand = args.brand;
    if (args.model !== undefined) updates.model = args.model;
    if (args.specification !== undefined) updates.specification = args.specification;
    if (args.locationId !== undefined) updates.locationId = args.locationId;
    if (args.areaId !== undefined) updates.areaId = args.areaId;
    if (args.photoStorageId !== undefined) updates.photoStorageId = args.photoStorageId;
    if (args.supplierLotNumber !== undefined) updates.supplierLotNumber = args.supplierLotNumber;
    if (args.observation !== undefined) updates.observation = args.observation;
    if (args.matchSource !== undefined) updates.matchSource = args.matchSource;
    if (args.matchScore !== undefined) updates.matchScore = args.matchScore;
    if (args.associationType !== undefined) updates.associationType = args.associationType;

    await ctx.db.patch(args.itemId, updates);
    if (args.photoStorageId) {
      await attachStorageFile(ctx, args.photoStorageId, "entryItem", String(args.itemId), String(userId));
    }
    await ctx.db.patch(item.entryId, { updatedAt: Date.now() });

    const product = args.productId ? await ctx.db.get(args.productId) : await ctx.db.get(item.productId);
    await ctx.db.insert("auditLogs", {
      userId, action: "update", entity: "entryItems", entityId: args.itemId,
      details: `Item atualizado na entrada ${entry.entryNumber}: ${product?.name ?? "—"} ${JSON.stringify(updates)}`,
      timestamp: Date.now(),
    });
  },
});

/** Remove an item from a draft entry. Does NOT modify stock. */
export const removeItem = mutation({
  args: { itemId: v.id("entryItems") },
  handler: async (ctx, args) => {
    const { userId } = await requireStockManagerOrAdmin(ctx);
    const item = await ctx.db.get(args.itemId);
    if (!item) throw new Error("Item não encontrado");

    const entry = await ctx.db.get(item.entryId);
    if (!entry) throw new Error("Entrada não encontrada");
    if (entry.status !== "draft") throw new Error("Apenas entradas em rascunho podem ter itens removidos");

    // Prevent removing last item
    const allItems = await ctx.db.query("entryItems").withIndex("by_entry", (q) => q.eq("entryId", item.entryId)).collect();
    if (allItems.length <= 1) throw new Error("A entrada deve ter pelo menos um item");

    const product = await ctx.db.get(item.productId);
    await ctx.db.delete(args.itemId);
    await ctx.db.patch(item.entryId, { updatedAt: Date.now() });

    await ctx.db.insert("auditLogs", {
      userId, action: "update", entity: "entryItems", entityId: args.itemId,
      details: `Item removido da entrada ${entry.entryNumber}: ${product?.name ?? "—"} x${item.quantity}`,
      timestamp: Date.now(),
    });
  },
});

/** Edit a draft entry (only draft entries can be edited). */
export const editDraft = mutation({
  args: {
    entryId: v.id("entries"),
    observation: v.optional(v.string()),
    invoiceNumber: v.optional(v.string()),
    invoiceDate: v.optional(v.string()),
    purchaseAuthorizationNumber: v.optional(v.string()),
    processNumber: v.optional(v.string()),
    empenhoNumber: v.optional(v.string()),
    contractNumber: v.optional(v.string()),
    documentStorageId: v.optional(v.string()),
    materialType: v.optional(v.union(v.literal("consumption"), v.literal("permanent"))),
    areaId: v.optional(v.id("stockAreas")),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireStockManagerOrAdmin(ctx);
    assertTextLimits({ observation: args.observation }, MAX_OBSERVATION);
    assertShortTextLimits({ invoiceNumber: args.invoiceNumber, purchaseAuthorizationNumber: args.purchaseAuthorizationNumber, processNumber: args.processNumber, empenhoNumber: args.empenhoNumber, contractNumber: args.contractNumber });

    const entry = await ctx.db.get(args.entryId);
    if (!entry) throw new Error("Entrada não encontrada");
    if (entry.status !== "draft") throw new Error("Apenas entradas em rascunho podem ser editadas");

    const now = Date.now();
    const updates: Record<string, any> = { updatedAt: now };
    if (args.observation !== undefined) updates.observation = args.observation;
    if (args.invoiceNumber !== undefined) updates.invoiceNumber = args.invoiceNumber;
    if (args.invoiceDate !== undefined) updates.invoiceDate = args.invoiceDate;
    if (args.purchaseAuthorizationNumber !== undefined) updates.purchaseAuthorizationNumber = args.purchaseAuthorizationNumber;
    if (args.processNumber !== undefined) updates.processNumber = args.processNumber;
    if (args.empenhoNumber !== undefined) updates.empenhoNumber = args.empenhoNumber;
    if (args.contractNumber !== undefined) updates.contractNumber = args.contractNumber;
    if (args.documentStorageId !== undefined) updates.documentStorageId = args.documentStorageId;
    if (args.materialType !== undefined) {
      updates.materialType = args.materialType;
      // Material de consumo não guarda unidades patrimoniais
      if (args.materialType !== "permanent") {
        const existingUnits = await ctx.db
          .query("entryItemUnits")
          .withIndex("by_entry", (q) => q.eq("entryId", args.entryId))
          .collect();
        for (const u of existingUnits) await ctx.db.delete(u._id);
      }
    }
    if (args.areaId !== undefined) {
      if (args.areaId) {
        const area = await ctx.db.get(args.areaId);
        if (!area) throw new Error("Área/Subestoque não encontrada");
      }
      updates.areaId = args.areaId;
    }

    await ctx.db.patch(args.entryId, updates);
    if (args.documentStorageId) {
      await attachStorageFile(ctx, args.documentStorageId, "entry", String(args.entryId), String(userId));
    }

    await ctx.db.insert("auditLogs", {
      userId, action: "update", entity: "entries", entityId: args.entryId,
      details: `Entrada ${entry.entryNumber} editada`,
      timestamp: now,
    });

    return args.entryId;
  },
});

/** Reverse a confirmed entry. Cannot reverse if lots have been partially consumed. */
export const reverse = mutation({
  args: {
    entryId: v.id("entries"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireStockManagerOrAdmin(ctx);
    const reason = args.reason.trim();
    if (!reason) throw new Error("O motivo do estorno é obrigatório");
    assertTextLimits({ observation: reason }, MAX_OBSERVATION);

    const entry = await ctx.db.get(args.entryId);
    if (!entry) throw new Error("Entrada não encontrada");
    if (entry.status !== "confirmed") throw new Error("Apenas entradas confirmadas podem ser estornadas");

    const [items, entryLots, entryUnits] = await Promise.all([
      ctx.db.query("entryItems").withIndex("by_entry", (q) => q.eq("entryId", args.entryId)).collect(),
      ctx.db.query("lots").withIndex("by_entry", (q) => q.eq("entryId", args.entryId)).collect(),
      ctx.db.query("entryItemUnits").withIndex("by_entry", (q) => q.eq("entryId", args.entryId)).collect(),
    ]);
    if (items.length === 0) throw new Error("Entrada confirmada não possui itens para estornar");

    // Depois do tombamento, o bem já tem vínculo administrativo próprio.
    // Não desfazemos esse vínculo automaticamente ao estornar o estoque:
    // o setor de Patrimônio precisa conciliar o ativo antes de qualquer reversão.
    const registeredPatrimonyUnit = entryUnits.find((unit) =>
      unit.patrimonyRegistrationStatus === "registered" ||
      !!unit.assetId ||
      !!unit.patrimonyNumber?.trim()
    );
    if (registeredPatrimonyUnit) {
      throw new Error(
        "Não é possível estornar esta entrada: há unidade já tombada ou vinculada a um ativo. Solicite a conciliação do setor de Patrimônio antes do estorno.",
      );
    }

    const now = Date.now();
    const reversalDetails: string[] = [];
    const reversedLotIds = new Set<string>();

    for (const item of items) {
      const product = await ctx.db.get(item.productId);
      const stockRows = await ctx.db.query("stock")
        .withIndex("by_product", (q) => q.eq("productId", item.productId)).collect();
      const stock = requireSingleValidGlobalStock(stockRows, product?.name ?? String(item.productId));

      // O estorno precisa atingir o lote criado por ESTE item da entrada.
      // Nunca usa outro lote do mesmo produto para compensar uma entrada consumida.
      let lot: Doc<"lots"> | null = null;
      if (item.lotId) {
        lot = await ctx.db.get(item.lotId as Id<"lots">);
        if (!lot) lot = entryLots.find((candidate) => candidate.lotNumber === item.lotId) ?? null;
      }
      if (!lot) {
        const candidates = entryLots.filter((candidate) => candidate.productId === item.productId);
        if (candidates.length === 1) lot = candidates[0];
        else {
          throw new Error(
            `Não é possível estornar "${product?.name ?? "item"}": o lote original não está identificado de forma única. Regularize a rastreabilidade antes do estorno.`,
          );
        }
      }
      if (
        lot.entryId !== args.entryId ||
        lot.productId !== item.productId ||
        reversedLotIds.has(String(lot._id)) ||
        lot.active === false
      ) {
        throw new Error(`Não é possível estornar "${product?.name ?? "item"}": o lote de origem está inválido ou já foi utilizado no estorno.`);
      }
      reversedLotIds.add(String(lot._id));

      const lotReservations = await ctx.db.query("requestItemReservations")
        .withIndex("by_lot", (q) => q.eq("lotId", lot._id)).collect();
      const reservedInLot = lotReservations.reduce(
        (sum: number, reservation) => sum + Number(reservation.quantityRemaining ?? 0),
        0,
      );
      const lotAfter = Number(lot.quantityAvailable) - Number(item.quantity);
      if (lotAfter < reservedInLot || lotAfter < 0) {
        throw new Error(
          `Não é possível estornar "${product?.name ?? "item"}": o lote original foi parcialmente consumido, transferido ou reservado. Saldo do lote: ${lot.quantityAvailable}; quantidade da entrada: ${item.quantity}; reserva remanescente: ${reservedInLot}.`,
        );
      }

      const newPhysical = stock.physicalQuantity - item.quantity;
      if (newPhysical < 0 || newPhysical < stock.reservedQuantity) {
        throw new Error(
          `Não é possível estornar "${product?.name ?? "item"}": o saldo global restante ficaria abaixo das reservas. Saldo atual: ${stock.physicalQuantity}; reservado: ${stock.reservedQuantity}; entrada: ${item.quantity}.`,
        );
      }

      // Compatibilidade histórica: entradas anteriores à classificação por
      // item podem ter areaId apenas no cabeçalho; lotes antigos também podem
      // ter a localização preservada somente em lotLocationBalances.
      const itemAreaId = resolveEntryItemAreaId(item.areaId, entry.areaId);
      const lotAreaId = lot.areaId ?? itemAreaId;
      const lotLocationRows = await ctx.db.query("lotLocationBalances")
        .withIndex("by_lot", (q) => q.eq("lotId", lot._id)).collect();
      if (lotLocationRows.length > 1) {
        throw new Error(`Não é possível estornar "${product?.name ?? "item"}": há saldos lote × armário duplicados.`);
      }
      const lotLocationId = resolveEntryLotLocationId(lot.locationId, lotLocationRows[0]?.locationId, item.locationId);
      if (
        (itemAreaId ?? undefined) !== (lotAreaId ?? undefined) ||
        (item.locationId && lotLocationId && item.locationId !== lotLocationId)
      ) {
        throw new Error(`Não é possível estornar "${product?.name ?? "item"}": área/local do item diverge do lote original.`);
      }
      if (!lotLocationId) {
        throw new Error(
          `Não é possível estornar "${product?.name ?? "item"}": o local físico do lote original não está identificado. Regularize a localização antes do estorno.`,
        );
      }

      let locationStock: Doc<"stockByLocation"> | null = null;
      if (lotLocationId) {
        const locationRows = await ctx.db.query("stockByLocation")
          .withIndex("by_product", (q) => q.eq("productId", item.productId)).collect();
        const matchingRows = locationRows.filter((row) =>
          row.locationId === lotLocationId && (row.areaId ?? undefined) === lotAreaId
        );
        if (matchingRows.length !== 1) {
          throw new Error(
            `Não é possível estornar "${product?.name ?? "item"}": o saldo no local físico de origem está ausente ou duplicado para a área correta.`,
          );
        }
        locationStock = matchingRows[0]!;
        const scopeReservations = (await ctx.db.query("requestItemReservations")
          .withIndex("by_product", (q) => q.eq("productId", item.productId)).collect())
          .filter((reservation) =>
            reservation.locationId === lotLocationId && reservation.areaId === lotAreaId
          )
          .reduce((sum: number, reservation) => sum + Number(reservation.quantityRemaining ?? 0), 0);
        if (locationStock.quantity - item.quantity < scopeReservations) {
          throw new Error(
            `Não é possível estornar "${product?.name ?? "item"}": a redução deixaria o local abaixo das reservas existentes.`,
          );
        }
      }

      // Somente após validar lote, reservas e origem física são aplicadas as escritas.
      await ctx.db.patch(stock._id, { physicalQuantity: newPhysical });
      await ctx.db.patch(lot._id, {
        quantityAvailable: lotAfter,
        active: lotAfter > 0,
      });
      await adjustLotLocationBalance(ctx, {
        lotId: lot._id, productId: lot.productId, locationId: lotLocationId as Id<"storageLocations">,
        delta: -Number(item.quantity), expectedQuantityBefore: Number(lot.quantityAvailable),
      });
      if (locationStock) {
        await ctx.db.patch(locationStock._id, { quantity: locationStock.quantity - item.quantity });
      }

      await ctx.db.insert("stockMovements", {
        productId: item.productId,
        type: "adjustment",
        quantity: item.quantity,
        previousPhysical: stock.physicalQuantity,
        newPhysical,
        previousReserved: stock.reservedQuantity,
        newReserved: stock.reservedQuantity,
        userId,
        entryId: args.entryId,
        lotId: lot._id as string,
        areaId: lotAreaId ? lotAreaId as Id<"stockAreas"> : undefined,
        locationId: lotLocationId as Id<"storageLocations">,
        observation: `Estorno da entrada ${entry.entryNumber} — lote ${lot.lotNumber}. Motivo: ${reason}`,
        timestamp: now,
      });

      reversalDetails.push(`${product?.name ?? "item"}: -${item.quantity} (${lot.lotNumber})`);
    }

    await ctx.db.patch(args.entryId, { status: "reversed", updatedAt: now });
    await ctx.db.insert("auditLogs", {
      userId,
      action: "reverse_entry",
      entity: "entries",
      entityId: args.entryId,
      details: `Entrada ${entry.entryNumber} estornada. Itens: ${reversalDetails.join("; ")}. Motivo: ${reason}`,
      timestamp: now,
    });

    return args.entryId;
  },
});

/**
 * Registra/ substitui as UNIDADES PATRIMONIAIS de uma entrada em rascunho.
 *
 * Só faz sentido para entrada classificada como Material PERMANENTE —
 * material de consumo não exige patrimônio e não aceita unidades.
 * Não altera estoque: só cadastro de unidades (patrimônio / série).
 */
export const setUnits = mutation({
  args: {
    entryId: v.id("entries"),
    units: v.array(v.object({
      entryItemId: v.id("entryItems"),
      patrimonyNumber: v.optional(v.string()),
      serialNumber: v.optional(v.string()),
      manufacturer: v.optional(v.string()),
      model: v.optional(v.string()),
      acquisitionDate: v.optional(v.string()),
      incorporationDate: v.optional(v.string()),
      acquisitionValue: v.optional(v.number()),
      accountingValue: v.optional(v.number()),
      residualValue: v.optional(v.number()),
      accumulatedDepreciation: v.optional(v.number()),
      netBookValue: v.optional(v.number()),
      locationId: v.optional(v.id("storageLocations")),
      secretariaId: v.optional(v.id("organizations")),
      departamentoId: v.optional(v.id("organizations")),
      unidadeId: v.optional(v.id("organizations")),
      responsibleDestiny: v.optional(v.string()),
      patrimonyStatus: v.optional(v.union(
        v.literal("in_stock"), v.literal("in_use"), v.literal("maintenance"), v.literal("idle"),
        v.literal("transferred"), v.literal("disposal_pending"), v.literal("unserviceable"), v.literal("disposed")
      )),
      observation: v.optional(v.string()),
    })),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireStockManagerOrAdmin(ctx);
    for (const unit of args.units) {
      assertTextLimits({ observation: unit.observation }, MAX_OBSERVATION);
      assertShortTextLimits({ patrimony: unit.patrimonyNumber, serialNumber: unit.serialNumber, manufacturer: unit.manufacturer, model: unit.model, responsibleDestiny: unit.responsibleDestiny });
    }
    const entry = await ctx.db.get(args.entryId);
    if (!entry) throw new Error("Entrada não encontrada");
    if (entry.status !== "draft") throw new Error("Apenas entradas em rascunho podem registrar unidades patrimoniais");

    if (args.units.length > 0 && entry.materialType !== "permanent") {
      throw new Error(
        "Unidades patrimoniais só existem para Material permanente. " +
        "Classifique a entrada como material permanente primeiro."
      );
    }

    // Todos os itens informados pertencem à entrada
    const items = await ctx.db.query("entryItems").withIndex("by_entry", (q) => q.eq("entryId", args.entryId)).collect();
    const itemIds = new Set(items.map((item) => item._id));
    for (const u of args.units) {
      if (!itemIds.has(u.entryItemId)) {
        throw new Error("Item informado não pertence a esta entrada");
      }
    }

    if (args.units.some((unit) => !!unit.patrimonyNumber?.trim())) {
      throw new Error("O número oficial de patrimônio só pode ser atribuído pelo setor de Patrimônio após a confirmação da entrada.");
    }

    // Patrimônio não pode se repetir dentro da mesma entrada
    const seen = new Set<string>();
    for (const u of args.units) {
      const p = (u.patrimonyNumber ?? "").trim();
      if (!p) continue;
      if (seen.has(p)) throw new Error(`Patrimônio duplicado na entrada: ${p}`);
      seen.add(p);
    }

    // Substitui as unidades da entrada (rascunho)
    const existing = await ctx.db
      .query("entryItemUnits")
      .withIndex("by_entry", (q) => q.eq("entryId", args.entryId))
      .collect();
    for (const u of existing) await ctx.db.delete(u._id);

    const itemById = new Map(items.map((item) => [item._id, item] as const));
    const now = Date.now();
    for (const u of args.units) {
      const item = itemById.get(u.entryItemId);
      if (!item) throw new Error("Item informado não pertence a esta entrada.");
      await ctx.db.insert("entryItemUnits", {
        entryId: args.entryId,
        entryItemId: u.entryItemId,
        productId: item.productId,
        patrimonyNumber: u.patrimonyNumber?.trim() || undefined,
        patrimonyRegistrationStatus: "pending",
        patrimonyAssignedAt: undefined,
        patrimonyAssignedByUserId: undefined,
        serialNumber: u.serialNumber?.trim() || undefined,
        manufacturer: u.manufacturer?.trim() || undefined,
        model: u.model?.trim() || undefined,
        acquisitionDate: u.acquisitionDate?.trim() || undefined,
        incorporationDate: u.incorporationDate?.trim() || undefined,
        acquisitionValue: u.acquisitionValue,
        accountingValue: u.accountingValue,
        residualValue: u.residualValue,
        accumulatedDepreciation: u.accumulatedDepreciation,
        netBookValue: u.netBookValue,
        locationId: u.locationId,
        secretariaId: u.secretariaId,
        departamentoId: u.departamentoId,
        unidadeId: u.unidadeId,
        responsibleDestiny: u.responsibleDestiny?.trim() || undefined,
        patrimonyStatus: u.patrimonyStatus,
        observation: u.observation?.trim() || undefined,
        createdAt: now,
      });
    }

    await ctx.db.patch(args.entryId, { updatedAt: now });
    await ctx.db.insert("auditLogs", {
      userId, action: "update", entity: "entryItemUnits", entityId: args.entryId,
      details: `Entrada ${entry.entryNumber}: ${args.units.length} unidade(s) patrimonial(is) registrada(s)`,
      timestamp: now,
    });
    return args.entryId;
  },
});


// ─── Tombamento posterior pelo setor de Patrimônio ──────────────────────────

const PATRIMONY_ASSET_TYPES = [
  "desktop", "notebook", "monitor", "server", "printer", "switch",
  "router", "access_point", "ups", "storage", "phone", "other",
] as const;

export const listPendingPatrimony = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "patrimony.view", { entity: "entryItemUnits" });
    const pending = await ctx.db
      .query("entryItemUnits")
      .withIndex("by_registration_status", (q) => q.eq("patrimonyRegistrationStatus", "pending"))
      .collect();
    const rows = await Promise.all(pending.map(async (unit) => {
      const entry = await ctx.db.get(unit.entryId);
      if (!entry || entry.status !== "confirmed") return null;
      const item = await ctx.db.get(unit.entryItemId);
      const product = item ? await ctx.db.get(item.productId) : null;
      const supplier = entry.supplierId ? await ctx.db.get(entry.supplierId) : null;
      return {
        ...unit,
        entryNumber: entry.entryNumber,
        invoiceNumber: entry.invoiceNumber,
        invoiceDate: entry.invoiceDate,
        receivedAt: entry.receivedAt,
        supplierName: supplier?.tradeName ?? supplier?.legalName ?? null,
        productName: product?.name ?? "Produto não encontrado",
        itemQuantity: item?.quantity ?? null,
      };
    }));
    return rows.filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((a, b) => a.createdAt - b.createdAt);
  },
});

export const assignPatrimony = mutation({
  args: {
    entryItemUnitId: v.id("entryItemUnits"),
    patrimonyNumber: v.string(),
    assetType: v.union(...PATRIMONY_ASSET_TYPES.map((value) => v.literal(value))),
  },
  handler: async (ctx, args) => {
    const { userId } = await requirePermission(ctx, "patrimony.assign", {
      entity: "entryItemUnits", entityId: String(args.entryItemUnitId),
    });
    const patrimonyNumber = args.patrimonyNumber.trim();
    if (!patrimonyNumber || patrimonyNumber.length > 80) {
      throw new Error("Informe um número de patrimônio válido (até 80 caracteres).");
    }
    const normalized = patrimonyNumber.toLocaleUpperCase("pt-BR");
    const unit = await ctx.db.get(args.entryItemUnitId);
    if (!unit) throw new Error("Unidade recebida não encontrada.");
    const entry = await ctx.db.get(unit.entryId);
    if (!entry || entry.status !== "confirmed") {
      throw new Error("O tombamento só pode ocorrer após a confirmação da entrada.");
    }
    if (unit.patrimonyNumber?.trim()) {
      throw new Error("Esta unidade já possui patrimônio. Correções exigem procedimento próprio e histórico.");
    }

    const [units, assets] = await Promise.all([
      ctx.db.query("entryItemUnits").collect(),
      ctx.db.query("assets").collect(),
    ]);
    if (units.some((row) =>
      row._id !== args.entryItemUnitId &&
      row.patrimonyNumber?.trim().toLocaleUpperCase("pt-BR") === normalized
    )) {
      throw new Error("Este número já está associado a outra unidade recebida.");
    }
    const existingAsset = assets.find((asset) =>
      asset.patrimonyNumber?.trim().toLocaleUpperCase("pt-BR") === normalized
    );
    if (existingAsset?.entryItemUnitId && existingAsset.entryItemUnitId !== args.entryItemUnitId) {
      throw new Error("Este número já está vinculado a outro equipamento.");
    }

    const normalizedSerial = unit.serialNumber?.trim().toLocaleUpperCase("pt-BR");
    if (normalizedSerial) {
      if (
        existingAsset?.serialNumber &&
        existingAsset.serialNumber.trim().toLocaleUpperCase("pt-BR") !== normalizedSerial
      ) {
        throw new Error(
          "O patrimônio informado já pertence a um equipamento com outro número de série. Faça a conciliação do cadastro antes do tombamento.",
        );
      }
      const serialOwner = assets.find((asset) =>
        asset.serialNumber?.trim().toLocaleUpperCase("pt-BR") === normalizedSerial &&
        asset.entryItemUnitId !== args.entryItemUnitId
      );
      if (serialOwner && serialOwner._id !== existingAsset?._id) {
        throw new Error(
          "O número de série desta unidade já consta em outro equipamento. Faça a conciliação do cadastro existente antes do tombamento.",
        );
      }
    }

    const item = await ctx.db.get(unit.entryItemId);
    const product = await ctx.db.get(unit.productId);
    if (!item || !product) throw new Error("Produto ou item da entrada não encontrado.");
    const now = Date.now();
    const organizationId = unit.unidadeId ?? unit.departamentoId ?? unit.secretariaId;
    let assetId: Id<"assets">;

    if (existingAsset) {
      // Reaproveita o cadastro legado para não criar um segundo ativo.
      assetId = existingAsset._id;
      await ctx.db.patch(assetId, {
        entryId: unit.entryId,
        entryItemId: unit.entryItemId,
        entryItemUnitId: args.entryItemUnitId,
        patrimonyNumber,
        serialNumber: existingAsset.serialNumber ?? (unit.serialNumber?.trim() || undefined),
        updatedAt: now,
      });
      await ctx.db.insert("assetHistory", {
        assetId, eventType: "assigned", userId,
        previousStatus: existingAsset.status,
        newStatus: existingAsset.status,
        observation: `Vinculado à entrada ${entry.entryNumber}; tombamento ${patrimonyNumber}`,
        timestamp: now,
      });
    } else {
      assetId = await ctx.db.insert("assets", {
        patrimonyNumber,
        serialNumber: unit.serialNumber?.trim() || undefined,
        entryId: unit.entryId,
        entryItemId: unit.entryItemId,
        entryItemUnitId: args.entryItemUnitId,
        assetType: args.assetType,
        manufacturer: unit.manufacturer?.trim() || product.manufacturer || undefined,
        model: unit.model?.trim() || product.model || undefined,
        organizationId,
        storageLocationId: unit.locationId,
        status: "active",
        acquisitionDate: unit.acquisitionDate || entry.invoiceDate || undefined,
        observation: unit.observation || `Recebido na entrada ${entry.entryNumber}`,
        active: true,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("assetHistory", {
        assetId, eventType: "created", userId,
        newOrganizationId: organizationId,
        newStatus: "active",
        observation: `Criado a partir da entrada ${entry.entryNumber}; tombamento ${patrimonyNumber}`,
        timestamp: now,
      });
    }

    await ctx.db.patch(args.entryItemUnitId, {
      patrimonyNumber,
      patrimonyRegistrationStatus: "registered",
      patrimonyAssignedAt: now,
      patrimonyAssignedByUserId: userId,
      assetId,
    });
    await ctx.db.insert("auditLogs", {
      userId, action: "asset_assign", entity: "entryItemUnits",
      entityId: args.entryItemUnitId,
      details: `Tombamento ${patrimonyNumber} atribuído à unidade da entrada ${entry.entryNumber}; ativo ${assetId}`,
      timestamp: now,
    });
    return assetId;
  },
});

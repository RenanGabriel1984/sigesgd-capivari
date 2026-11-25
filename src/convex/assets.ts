import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requirePermission } from "./rbac";
import { findEquipmentCategory, buildRelatedStockProducts } from "../lib/equipment-categories";
import type { RelatedStockProduct } from "../lib/equipment-categories";

type UserRole = "admin" | "stock_manager" | "director" | "secretary" | "technician" | "patrimony_manager";

async function requireUser(ctx: any) {
  // RBAC central: equipamentos visíveis a quem consulta (incl. gestor/diretor).
  return requirePermission(ctx, "equipment.view");
}

async function requireManagerOrAdmin(ctx: any) {
  // RBAC central: gerenciamento de equipamentos pela equipe de TI.
  return requirePermission(ctx, "equipment.manage", { entity: "assets" });
}

async function requirePatrimonyManager(ctx: any) {
  // Tombamento oficial e confirmação de baixa pertencem ao Departamento de Patrimônio.
  return requirePermission(ctx, "patrimony.assign", { entity: "assets" });
}

// ═══════════════════════════════════════════════════════════════════════════
// QUERIES
// ═══════════════════════════════════════════════════════════════════════════

export const list = query({
  args: {
    status: v.optional(v.string()),
    assetType: v.optional(v.string()),
    organizationId: v.optional(v.id("organizations")),
    responsibleUserId: v.optional(v.id("users")),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    let assets = await ctx.db.query("assets").order("desc").take(500);

    if (args.status) assets = assets.filter((a: any) => a.status === args.status);
    if (args.assetType) assets = assets.filter((a: any) => a.assetType === args.assetType);
    if (args.organizationId) assets = assets.filter((a: any) => a.organizationId === args.organizationId);
    if (args.responsibleUserId) assets = assets.filter((a: any) => a.responsibleUserId === args.responsibleUserId);

    if (args.search) {
      const s = args.search.toLowerCase();
      assets = assets.filter((a: any) =>
        (a.patrimonyNumber ?? "").toLowerCase().includes(s) ||
        (a.serialNumber ?? "").toLowerCase().includes(s) ||
        (a.hostname ?? "").toLowerCase().includes(s) ||
        (a.manufacturer ?? "").toLowerCase().includes(s) ||
        (a.model ?? "").toLowerCase().includes(s)
      );
    }

    return Promise.all(assets.map(async (a: any) => {
      const org = a.organizationId ? await ctx.db.get(a.organizationId) : null;
      const responsible = a.responsibleUserId ? await ctx.db.get(a.responsibleUserId) : null;
      return { ...a, organization: org, responsible };
    }));
  },
});

/**
 * PRODUTOS DE ESTOQUE RELACIONADOS a uma categoria de equipamento.
 *
 * SOMENTE LEITURA: devolve os registros ORIGINAIS de `products`/`stock`.
 * Nenhum asset é criado, nenhum saldo é alterado, nenhuma movimentação é
 * registrada e o estoque NÃO é duplicado — a tela de /assets apenas aponta
 * ONDE estão os produtos parecidos com a categoria.
 *
 * RBAC: exige `stock.view` porque os dados devolvidos são SALDO de estoque
 * (products.view ficaria permissivo demais para expor quantidades).
 */
export const relatedStockByCategory = query({
  args: { category: v.string() },
  handler: async (ctx, args): Promise<RelatedStockProduct[]> => {
    await requirePermission(ctx, "stock.view");
    const category = findEquipmentCategory(args.category);
    if (!category) return [];

    const products = await ctx.db.query("products").collect();
    const stockRows = await ctx.db.query("stock").collect();
    const stockByProduct = new Map<string, { physicalQuantity: number; reservedQuantity: number }>();
    for (const s of stockRows) {
      stockByProduct.set(s.productId, {
        physicalQuantity: s.physicalQuantity ?? 0,
        reservedQuantity: s.reservedQuantity ?? 0,
      });
    }

    // Categorias do catálogo resolvidas uma única vez (evita N+1 por produto).
    const categoryNameById = new Map<string, string>();
    for (const c of await ctx.db.query("categories").collect()) {
      categoryNameById.set(c._id, c.name);
    }

    return buildRelatedStockProducts(
      products.map((p) => ({
        _id: p._id,
        name: p.name,
        brand: p.brand ?? null,
        manufacturer: p.manufacturer ?? null,
        model: p.model ?? null,
        unitOfMeasure: p.unitOfMeasure,
        categoryName: p.categoryId ? categoryNameById.get(p.categoryId) ?? null : null,
        stock: stockByProduct.get(p._id) ?? null,
      })),
      category
    );
  },
});

export const get = query({
  args: { assetId: v.id("assets") },
  handler: async (ctx, args) => {
    const { userId } = await requireUser(ctx);
    const asset = await ctx.db.get(args.assetId);
    if (!asset) throw new Error("Equipamento não encontrado");

    const org = asset.organizationId ? await ctx.db.get(asset.organizationId) : null;
    const responsible = asset.responsibleUserId ? await ctx.db.get(asset.responsibleUserId) : null;
    const location = asset.storageLocationId ? await ctx.db.get(asset.storageLocationId) : null;
    const sourceEntry: any = asset.entryId ? await ctx.db.get(asset.entryId) : null;

    // Get installed parts
    const parts = await ctx.db
      .query("assetParts")
      .withIndex("by_asset", (q) => q.eq("assetId", args.assetId))
      .collect();
    const partsWithDetails = await Promise.all(parts.map(async (p: any) => {
      const product = await ctx.db.get(p.productId);
      return { ...p, product };
    }));

    // Get licenses assigned
    const assignments = await ctx.db
      .query("licenseAssignments")
      .withIndex("by_asset", (q) => q.eq("assetId", args.assetId))
      .collect();
    const licensesWithDetails = await Promise.all(assignments.map(async (a: any) => {
      const license = await ctx.db.get(a.licenseId);
      return { ...a, license };
    }));

    // Get maintenances
    const maintenances = await ctx.db
      .query("assetMaintenances")
      .withIndex("by_asset", (q) => q.eq("assetId", args.assetId))
      .order("desc")
      .take(50);
    const maintWithDetails = await Promise.all(maintenances.map(async (m: any) => {
      const tech = await ctx.db.get(m.technicianUserId);
      return { ...m, technician: tech };
    }));

    // Get history
    const history = await ctx.db
      .query("assetHistory")
      .withIndex("by_asset", (q) => q.eq("assetId", args.assetId))
      .order("desc")
      .take(100);
    const histWithDetails = await Promise.all(history.map(async (h: any) => {
      const user = await ctx.db.get(h.userId);
      return { ...h, user };
    }));

    return {
      ...asset,
      organization: org,
      responsible,
      location,
      sourceEntry: sourceEntry ? {
        _id: sourceEntry._id,
        entryNumber: sourceEntry.entryNumber,
        invoiceNumber: sourceEntry.invoiceNumber ?? null,
        invoiceDate: sourceEntry.invoiceDate ?? null,
        receivedAt: sourceEntry.receivedAt,
        status: sourceEntry.status,
      } : null,
      parts: partsWithDetails,
      licenses: licensesWithDetails,
      maintenances: maintWithDetails,
      history: histWithDetails,
    };
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// MUTATIONS
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// SOLICITAÇÃO DE BAIXA — fluxo da TI → Departamento de Patrimônio → barracão
// ═══════════════════════════════════════════════════════════════════════════

export const listDisposalRequests = query({
  args: {},
  handler: async (ctx) => {
    await requirePermission(ctx, "equipment.view");
    const requests = await ctx.db
      .query("disposalRequests")
      .withIndex("by_created")
      .order("desc")
      .take(300);
    return Promise.all(requests.map(async (request: any) => {
      const asset: any = await ctx.db.get(request.assetId);
      const requester: any = await ctx.db.get(request.requestedByUserId);
      const confirmationRecorder: any = request.confirmationRecordedByUserId
        ? await ctx.db.get(request.confirmationRecordedByUserId)
        : null;
      const warehouseRecorder: any = request.warehouseRecordedByUserId
        ? await ctx.db.get(request.warehouseRecordedByUserId)
        : null;
      return {
        ...request,
        asset,
        requesterName: requester?.name ?? requester?.email ?? "Usuário",
        confirmationRecorderName: confirmationRecorder?.name ?? confirmationRecorder?.email ?? null,
        warehouseRecorderName: warehouseRecorder?.name ?? warehouseRecorder?.email ?? null,
      };
    }));
  },
});

export const requestDisposal = mutation({
  args: {
    assetId: v.id("assets"),
    reason: v.string(),
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireManagerOrAdmin(ctx);
    const reason = args.reason.trim();
    if (reason.length < 5) throw new Error("Descreva o motivo da solicitação de baixa.");
    if (reason.length > 2000) throw new Error("O motivo deve ter até 2.000 caracteres.");

    const asset: any = await ctx.db.get(args.assetId);
    if (!asset) throw new Error("Equipamento não encontrado.");
    if (["disposed", "sent_to_warehouse", "lost"].includes(asset.status)) {
      throw new Error("Este equipamento não está elegível para uma nova solicitação de baixa.");
    }

    const previousRequests = await ctx.db
      .query("disposalRequests")
      .withIndex("by_asset", (q: any) => q.eq("assetId", args.assetId))
      .collect();
    const openRequest = previousRequests.find((request: any) =>
      request.status === "sent_to_patrimony" || request.status === "confirmed_by_patrimony"
    );
    if (openRequest) throw new Error("Este equipamento já possui uma solicitação de baixa em andamento.");

    const now = Date.now();
    const description = [asset.manufacturer, asset.model, asset.assetType].filter(Boolean).join(" ");
    const requestId = await ctx.db.insert("disposalRequests", {
      assetId: args.assetId,
      requestedByUserId: userId,
      reason,
      status: "sent_to_patrimony",
      patrimonyNumberSnapshot: asset.patrimonyNumber?.trim() || undefined,
      serialNumberSnapshot: asset.serialNumber?.trim() || undefined,
      equipmentDescription: description || "Equipamento de informática",
      observation: args.observation?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.patch(args.assetId, { status: "disposal_pending", active: true, updatedAt: now });
    await ctx.db.insert("assetHistory", {
      assetId: args.assetId,
      eventType: "disposal_requested",
      userId,
      previousStatus: asset.status,
      newStatus: "disposal_pending",
      observation: `Solicitação encaminhada ao Departamento de Patrimônio. Motivo: ${reason}`,
      timestamp: now,
    });
    await ctx.db.insert("auditLogs", {
      userId,
      action: "asset_disposal",
      entity: "disposalRequests",
      entityId: requestId,
      details: `Solicitação de baixa enviada ao Patrimônio para equipamento ${asset.patrimonyNumber ?? asset.serialNumber ?? args.assetId}`,
      timestamp: now,
    });
    return requestId;
  },
});

export const recordDisposalConfirmation = mutation({
  args: {
    requestId: v.id("disposalRequests"),
    confirmationReference: v.string(),
    confirmationDate: v.string(),
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requirePatrimonyManager(ctx);
    const reference = args.confirmationReference.trim();
    if (!reference || reference.length > 120) {
      throw new Error("Informe o número do documento ou protocolo da baixa oficial (até 120 caracteres).");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.confirmationDate)) {
      throw new Error("Informe a data da confirmação no formato AAAA-MM-DD.");
    }
    const request: any = await ctx.db.get(args.requestId);
    if (!request) throw new Error("Solicitação de baixa não encontrada.");
    if (request.status !== "sent_to_patrimony") {
      throw new Error("Somente solicitações encaminhadas ao Patrimônio aguardam confirmação oficial.");
    }
    const asset: any = await ctx.db.get(request.assetId);
    if (!asset) throw new Error("Equipamento relacionado não encontrado.");
    const now = Date.now();
    await ctx.db.patch(args.requestId, {
      status: "confirmed_by_patrimony",
      confirmationReference: reference,
      confirmationDate: args.confirmationDate,
      confirmationRecordedByUserId: userId,
      confirmedAt: now,
      observation: args.observation?.trim() || request.observation,
      updatedAt: now,
    });
    await ctx.db.patch(request.assetId, { status: "disposal_authorized", active: true, updatedAt: now });
    await ctx.db.insert("assetHistory", {
      assetId: request.assetId,
      eventType: "disposal_confirmed",
      userId,
      previousStatus: asset.status,
      newStatus: "disposal_authorized",
      observation: `Baixa oficial confirmada pelo Departamento de Patrimônio. Documento/protocolo: ${reference}; data: ${args.confirmationDate}.`,
      timestamp: now,
    });
    await ctx.db.insert("auditLogs", {
      userId,
      action: "asset_disposal",
      entity: "disposalRequests",
      entityId: args.requestId,
      details: `Confirmação externa da baixa oficial registrada: ${reference} (${args.confirmationDate})`,
      timestamp: now,
    });
    return args.requestId;
  },
});

export const markSentToWarehouse = mutation({
  args: {
    requestId: v.id("disposalRequests"),
    warehouseSentDate: v.string(),
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requirePatrimonyManager(ctx);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.warehouseSentDate)) {
      throw new Error("Informe a data de encaminhamento ao barracão no formato AAAA-MM-DD.");
    }
    const request: any = await ctx.db.get(args.requestId);
    if (!request) throw new Error("Solicitação de baixa não encontrada.");
    if (request.status !== "confirmed_by_patrimony") {
      throw new Error("O equipamento só pode ser encaminhado ao barracão após a confirmação da baixa oficial pelo Patrimônio.");
    }
    const asset: any = await ctx.db.get(request.assetId);
    if (!asset) throw new Error("Equipamento relacionado não encontrado.");
    const now = Date.now();
    await ctx.db.patch(args.requestId, {
      status: "sent_to_warehouse",
      warehouseSentDate: args.warehouseSentDate,
      warehouseRecordedByUserId: userId,
      observation: args.observation?.trim() || request.observation,
      updatedAt: now,
    });
    await ctx.db.patch(request.assetId, { status: "sent_to_warehouse", active: false, updatedAt: now });
    await ctx.db.insert("assetHistory", {
      assetId: request.assetId,
      eventType: "sent_to_warehouse",
      userId,
      previousStatus: asset.status,
      newStatus: "sent_to_warehouse",
      observation: `Encaminhado ao barracão de inservíveis em ${args.warehouseSentDate}, após confirmação da baixa oficial.`,
      timestamp: now,
    });
    await ctx.db.insert("auditLogs", {
      userId,
      action: "asset_disposal",
      entity: "disposalRequests",
      entityId: args.requestId,
      details: `Equipamento encaminhado ao barracão de inservíveis em ${args.warehouseSentDate}`,
      timestamp: now,
    });
    return args.requestId;
  },
});

/**
 * Unidades permanentes recebidas que ainda não estão vinculadas ao parque de
 * equipamentos. A consulta não cria nem altera registros.
 */
export const listUnlinkedEntryUnits = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const units = await ctx.db.query("entryItemUnits").order("desc").take(500);
    const pending = units.filter((unit: any) => !unit.assetId);
    const rows = await Promise.all(pending.map(async (unit: any) => {
      const entry: any = await ctx.db.get(unit.entryId);
      if (!entry || entry.status !== "confirmed" || entry.materialType !== "permanent") return null;
      const item: any = await ctx.db.get(unit.entryItemId);
      const product: any = item ? await ctx.db.get(item.productId) : null;
      const location: any = unit.locationId ? await ctx.db.get(unit.locationId) : null;
      return {
        _id: unit._id,
        patrimonyNumber: unit.patrimonyNumber ?? null,
        serialNumber: unit.serialNumber ?? null,
        manufacturer: unit.manufacturer ?? null,
        model: unit.model ?? null,
        entryNumber: entry.entryNumber,
        invoiceNumber: entry.invoiceNumber ?? null,
        invoiceDate: entry.invoiceDate ?? null,
        receivedAt: entry.receivedAt,
        productName: product?.name ?? "Produto não encontrado",
        productManufacturer: product?.manufacturer ?? null,
        productModel: product?.model ?? null,
        locationName: location?.name ?? null,
      };
    }));
    return rows.filter(Boolean).slice(0, 300);
  },
});

/**
 * Cria o cadastro individual do equipamento a partir de uma unidade recebida,
 * ou associa a unidade a um equipamento que já exista com o mesmo patrimônio
 * ou número de série. A operação é idempotente e não toca no estoque.
 */
export const createFromEntryUnit = mutation({
  args: {
    entryItemUnitId: v.id("entryItemUnits"),
    assetType: v.union(
      v.literal("desktop"), v.literal("notebook"), v.literal("monitor"),
      v.literal("server"), v.literal("printer"), v.literal("switch"),
      v.literal("router"), v.literal("access_point"), v.literal("ups"),
      v.literal("storage"), v.literal("phone"), v.literal("other")
    ),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireManagerOrAdmin(ctx);
    const unit: any = await ctx.db.get(args.entryItemUnitId);
    if (!unit) throw new Error("Unidade recebida não encontrada.");
    const entry: any = await ctx.db.get(unit.entryId);
    if (!entry || entry.status !== "confirmed" || entry.materialType !== "permanent") {
      throw new Error("Somente unidades de entradas confirmadas de material permanente podem ser cadastradas como equipamento.");
    }

    if (unit.assetId) {
      const linked: any = await ctx.db.get(unit.assetId);
      if (!linked) throw new Error("A unidade possui vínculo inválido com um equipamento. Solicite revisão técnica.");
      if (linked.entryItemUnitId && linked.entryItemUnitId !== unit._id) {
        throw new Error("O equipamento já está vinculado a outra unidade recebida.");
      }
      if (!linked.entryItemUnitId) {
        await ctx.db.patch(linked._id, {
          entryId: entry._id, entryItemId: unit.entryItemId,
          entryItemUnitId: unit._id, updatedAt: Date.now(),
        });
      }
      return linked._id;
    }

    const patrimonyNumber = unit.patrimonyNumber?.trim() || undefined;
    const serialNumber = unit.serialNumber?.trim() || undefined;
    // O catálogo de equipamentos é pequeno em relação ao estoque. A busca
    // normalizada evita duplicidade quando registros legados têm diferenças
    // apenas de maiúsculas/minúsculas ou espaços.
    const allAssets: any[] = await ctx.db.query("assets").collect();
    const normalizeIdentifier = (value?: string) => (value ?? "").trim().toLocaleUpperCase("pt-BR");
    const byPatrimony = patrimonyNumber
      ? allAssets.find((asset) => normalizeIdentifier(asset.patrimonyNumber) === normalizeIdentifier(patrimonyNumber)) ?? null
      : null;
    const bySerial = serialNumber
      ? allAssets.find((asset) => normalizeIdentifier(asset.serialNumber) === normalizeIdentifier(serialNumber)) ?? null
      : null;
    if (byPatrimony && bySerial && byPatrimony._id !== bySerial._id) {
      throw new Error("Patrimônio e número de série apontam para equipamentos diferentes. Revise os cadastros antes de associar.");
    }

    const existing: any = byPatrimony ?? bySerial ?? null;
    if (existing?.entryItemUnitId && existing.entryItemUnitId !== unit._id) {
      throw new Error("O equipamento identificado já está vinculado a outra unidade recebida.");
    }
    if (existing?.patrimonyNumber && patrimonyNumber &&
        existing.patrimonyNumber.trim().toLocaleUpperCase("pt-BR") !== patrimonyNumber.toLocaleUpperCase("pt-BR")) {
      throw new Error("O número patrimonial informado diverge do equipamento já cadastrado.");
    }
    if (existing?.serialNumber && serialNumber &&
        existing.serialNumber.trim().toLocaleUpperCase("pt-BR") !== serialNumber.toLocaleUpperCase("pt-BR")) {
      throw new Error("O número de série informado diverge do equipamento já cadastrado.");
    }

    const item: any = await ctx.db.get(unit.entryItemId);
    const product: any = item ? await ctx.db.get(item.productId) : null;
    const now = Date.now();
    const organizationId = unit.unidadeId ?? unit.departamentoId ?? unit.secretariaId;
    const manufacturer = unit.manufacturer?.trim() || product?.manufacturer || undefined;
    const model = unit.model?.trim() || item?.model || product?.model || undefined;
    const sourceNote = `Origem: entrada ${entry.entryNumber}${entry.invoiceNumber ? ` · NF ${entry.invoiceNumber}` : ""}.`;
    const observation = [unit.observation?.trim(), sourceNote].filter(Boolean).join("\n");

    let assetId: any;
    if (existing) {
      const patch: Record<string, any> = {
        entryId: entry._id,
        entryItemId: unit.entryItemId,
        entryItemUnitId: unit._id,
        updatedAt: now,
      };
      if (!existing.patrimonyNumber && patrimonyNumber) patch.patrimonyNumber = patrimonyNumber;
      if (!existing.serialNumber && serialNumber) patch.serialNumber = serialNumber;
      if (!existing.manufacturer && manufacturer) patch.manufacturer = manufacturer;
      if (!existing.model && model) patch.model = model;
      if (!existing.acquisitionDate && unit.acquisitionDate) patch.acquisitionDate = unit.acquisitionDate;
      if (!existing.storageLocationId && unit.locationId) patch.storageLocationId = unit.locationId;
      if (!existing.organizationId && organizationId) patch.organizationId = organizationId;
      if (!existing.observation) patch.observation = observation;
      await ctx.db.patch(existing._id, patch);
      assetId = existing._id;
      await ctx.db.insert("assetHistory", {
        assetId,
        eventType: "linked_from_entry",
        userId,
        observation: `Cadastro existente associado à unidade da entrada ${entry.entryNumber}.`,
        timestamp: now,
      });
      await ctx.db.insert("auditLogs", {
        userId, action: "asset_update", entity: "assets", entityId: assetId,
        details: `Equipamento existente associado à unidade da entrada ${entry.entryNumber}`,
        timestamp: now,
      });
    } else {
      assetId = await ctx.db.insert("assets", {
        patrimonyNumber,
        serialNumber,
        entryId: entry._id,
        entryItemId: unit.entryItemId,
        entryItemUnitId: unit._id,
        assetType: args.assetType,
        manufacturer,
        model,
        organizationId,
        storageLocationId: unit.locationId,
        acquisitionDate: unit.acquisitionDate,
        status: "active",
        observation,
        active: true,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("assetHistory", {
        assetId,
        eventType: "created",
        userId,
        newStatus: "active",
        observation: `Equipamento cadastrado a partir da entrada ${entry.entryNumber}. O vínculo não representa tombamento oficial.`,
        timestamp: now,
      });
      await ctx.db.insert("auditLogs", {
        userId, action: "asset_create", entity: "assets", entityId: assetId,
        details: `Equipamento cadastrado a partir da entrada ${entry.entryNumber}: ${patrimonyNumber ?? serialNumber ?? product?.name ?? "sem identificador"}`,
        timestamp: now,
      });
    }

    await ctx.db.patch(unit._id, { assetId });
    return assetId;
  },
});

/** Atribuição tardia do número patrimonial pelo Departamento de Patrimônio. */
export const assignPatrimonyNumber = mutation({
  args: {
    assetId: v.id("assets"),
    patrimonyNumber: v.string(),
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requirePatrimonyManager(ctx);
    const patrimonyNumber = args.patrimonyNumber.trim();
    if (!patrimonyNumber || patrimonyNumber.length > 80) {
      throw new Error("Informe um número patrimonial válido (até 80 caracteres).");
    }
    const asset: any = await ctx.db.get(args.assetId);
    if (!asset) throw new Error("Equipamento não encontrado.");
    const normalize = (value?: string) => (value ?? "").trim().toLocaleUpperCase("pt-BR");
    const allAssets = await ctx.db.query("assets").collect();
    const duplicate = allAssets.find((row: any) =>
      row._id !== asset._id && normalize(row.patrimonyNumber) === normalize(patrimonyNumber),
    );
    if (duplicate) throw new Error("Este número patrimonial já está associado a outro equipamento.");
    if (asset.patrimonyNumber?.trim() && normalize(asset.patrimonyNumber) !== normalize(patrimonyNumber)) {
      throw new Error("O equipamento já possui número patrimonial. Solicite a regularização administrativa.");
    }

    const now = Date.now();
    await ctx.db.patch(asset._id, { patrimonyNumber, updatedAt: now });
    if (asset.entryItemUnitId) {
      const unit = await ctx.db.get(asset.entryItemUnitId);
      if (unit) await ctx.db.patch(unit._id, { patrimonyNumber });
    }
    await ctx.db.insert("assetHistory", {
      assetId: asset._id,
      eventType: "assigned",
      userId,
      observation: `Número patrimonial atribuído pelo Departamento de Patrimônio: ${patrimonyNumber}${args.observation?.trim() ? ` — ${args.observation.trim()}` : ""}`,
      timestamp: now,
    });
    await ctx.db.insert("auditLogs", {
      userId,
      action: "asset_update",
      entity: "assets",
      entityId: asset._id,
      details: `Número patrimonial atribuído: ${patrimonyNumber}`,
      timestamp: now,
    });
    return asset._id;
  },
});

export const create = mutation({
  args: {
    patrimonyNumber: v.optional(v.string()),
    serialNumber: v.optional(v.string()),
    assetType: v.string(),
    manufacturer: v.optional(v.string()),
    model: v.optional(v.string()),
    hostname: v.optional(v.string()),
    macAddress: v.optional(v.string()),
    organizationId: v.optional(v.id("organizations")),
    responsibleUserId: v.optional(v.id("users")),
    storageLocationId: v.optional(v.id("storageLocations")),
    acquisitionDate: v.optional(v.string()),
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireManagerOrAdmin(ctx);
    const now = Date.now();

    const assetId = await ctx.db.insert("assets", {
      patrimonyNumber: args.patrimonyNumber || undefined,
      serialNumber: args.serialNumber || undefined,
      assetType: args.assetType as any,
      manufacturer: args.manufacturer || undefined,
      model: args.model || undefined,
      hostname: args.hostname || undefined,
      macAddress: args.macAddress || undefined,
      organizationId: args.organizationId || undefined,
      responsibleUserId: args.responsibleUserId || undefined,
      storageLocationId: args.storageLocationId || undefined,
      status: "active",
      acquisitionDate: args.acquisitionDate || undefined,
      observation: args.observation || undefined,
      active: true,
      createdAt: now,
      updatedAt: now,
    });

    // Create history entry
    await ctx.db.insert("assetHistory", {
      assetId,
      eventType: "created",
      userId,
      newOrganizationId: args.organizationId || undefined,
      newResponsibleUserId: args.responsibleUserId || undefined,
      newStatus: "active",
      observation: args.observation || undefined,
      timestamp: now,
    });

    // Audit
    await ctx.db.insert("auditLogs", {
      userId,
      action: "asset_create",
      entity: "assets",
      entityId: assetId,
      details: `Equipamento criado: ${args.patrimonyNumber ?? "s/ patrimônio"} — ${args.manufacturer ?? ""} ${args.model ?? ""}`.trim(),
      timestamp: now,
    });

    return assetId;
  },
});

export const update = mutation({
  args: {
    assetId: v.id("assets"),
    patrimonyNumber: v.optional(v.string()),
    serialNumber: v.optional(v.string()),
    assetType: v.optional(v.string()),
    manufacturer: v.optional(v.string()),
    model: v.optional(v.string()),
    hostname: v.optional(v.string()),
    macAddress: v.optional(v.string()),
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireManagerOrAdmin(ctx);
    const asset = await ctx.db.get(args.assetId);
    if (!asset) throw new Error("Equipamento não encontrado");

    const now = Date.now();
    const updates: Record<string, any> = { updatedAt: now };

    if (args.patrimonyNumber !== undefined) {
      await requirePatrimonyManager(ctx);
      updates.patrimonyNumber = args.patrimonyNumber || undefined;
    }
    if (args.serialNumber !== undefined) updates.serialNumber = args.serialNumber || undefined;
    if (args.assetType !== undefined) updates.assetType = args.assetType;
    if (args.manufacturer !== undefined) updates.manufacturer = args.manufacturer || undefined;
    if (args.model !== undefined) updates.model = args.model || undefined;
    if (args.hostname !== undefined) updates.hostname = args.hostname || undefined;
    if (args.macAddress !== undefined) updates.macAddress = args.macAddress || undefined;
    if (args.observation !== undefined) updates.observation = args.observation || undefined;

    await ctx.db.patch(args.assetId, updates);

    await ctx.db.insert("auditLogs", {
      userId,
      action: "asset_update",
      entity: "assets",
      entityId: args.assetId,
      details: `Equipamento atualizado`,
      timestamp: now,
    });

    return args.assetId;
  },
});

export const assign = mutation({
  args: {
    assetId: v.id("assets"),
    responsibleUserId: v.optional(v.id("users")),
    organizationId: v.optional(v.id("organizations")),
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireManagerOrAdmin(ctx);
    const asset = await ctx.db.get(args.assetId);
    if (!asset) throw new Error("Equipamento não encontrado");

    const now = Date.now();
    const previousResponsible = asset.responsibleUserId;
    const previousOrg = asset.organizationId;

    await ctx.db.patch(args.assetId, {
      responsibleUserId: args.responsibleUserId || undefined,
      organizationId: args.organizationId || undefined,
      updatedAt: now,
    });

    await ctx.db.insert("assetHistory", {
      assetId: args.assetId,
      eventType: "assigned",
      userId,
      previousOrganizationId: previousOrg || undefined,
      newOrganizationId: args.organizationId || asset.organizationId || undefined,
      previousResponsibleUserId: previousResponsible || undefined,
      newResponsibleUserId: args.responsibleUserId || asset.responsibleUserId || undefined,
      observation: args.observation || undefined,
      timestamp: now,
    });

    await ctx.db.insert("auditLogs", {
      userId,
      action: "asset_assign",
      entity: "assets",
      entityId: args.assetId,
      details: `Equipamento atribuído`,
      timestamp: now,
    });

    return args.assetId;
  },
});

export const transfer = mutation({
  args: {
    assetId: v.id("assets"),
    organizationId: v.id("organizations"),
    storageLocationId: v.optional(v.id("storageLocations")),
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireManagerOrAdmin(ctx);
    const asset = await ctx.db.get(args.assetId);
    if (!asset) throw new Error("Equipamento não encontrado");

    const now = Date.now();

    await ctx.db.patch(args.assetId, {
      organizationId: args.organizationId,
      storageLocationId: args.storageLocationId || asset.storageLocationId,
      updatedAt: now,
    });

    await ctx.db.insert("assetHistory", {
      assetId: args.assetId,
      eventType: "relocated",
      userId,
      previousOrganizationId: asset.organizationId || undefined,
      newOrganizationId: args.organizationId,
      observation: args.observation || undefined,
      timestamp: now,
    });

    await ctx.db.insert("auditLogs", {
      userId,
      action: "asset_transfer",
      entity: "assets",
      entityId: args.assetId,
      details: `Equipamento transferido`,
      timestamp: now,
    });

    return args.assetId;
  },
});

export const changeStatus = mutation({
  args: {
    assetId: v.id("assets"),
    newStatus: v.string(),
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireManagerOrAdmin(ctx);
    const asset = await ctx.db.get(args.assetId);
    if (!asset) throw new Error("Equipamento não encontrado");

    if (["disposal_pending", "disposal_authorized", "sent_to_warehouse", "disposed"].includes(args.newStatus) || ["disposal_pending", "disposal_authorized", "sent_to_warehouse", "disposed"].includes(asset.status)) {
      throw new Error("As etapas de baixa devem ser registradas pelo fluxo de Solicitação de baixa patrimonial.");
    }
    const now = Date.now();
    const previousStatus = asset.status;

    await ctx.db.patch(args.assetId, {
      status: args.newStatus as any,
      active: args.newStatus !== "disposed" && args.newStatus !== "lost",
      updatedAt: now,
    });

    await ctx.db.insert("assetHistory", {
      assetId: args.assetId,
      eventType: args.newStatus === "disposed" ? "disposed" : "status_changed",
      userId,
      previousStatus,
      newStatus: args.newStatus,
      observation: args.observation || undefined,
      timestamp: now,
    });

    const actionType = args.newStatus === "disposed" ? "asset_disposal" : "asset_update";
    await ctx.db.insert("auditLogs", {
      userId,
      action: actionType as any,
      entity: "assets",
      entityId: args.assetId,
      details: `Status: ${previousStatus} → ${args.newStatus}`,
      timestamp: now,
    });

    return args.assetId;
  },
});

export const history = query({
  args: { assetId: v.id("assets") },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const entries = await ctx.db
      .query("assetHistory")
      .withIndex("by_asset", (q) => q.eq("assetId", args.assetId))
      .order("desc")
      .take(100);

    return Promise.all(entries.map(async (h: any) => {
      const user = await ctx.db.get(h.userId);
      return { ...h, user };
    }));
  },
});

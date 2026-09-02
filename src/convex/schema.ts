import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// ─── Role Validators ─────────────────────────────────────────────────────────
export const ROLES = {
  ADMIN: "admin",
  STOCK_MANAGER: "stock_manager",
  DIRECTOR: "director",
  SECRETARY: "secretary",
  TECHNICIAN: "technician",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.STOCK_MANAGER),
  v.literal(ROLES.DIRECTOR),
  v.literal(ROLES.SECRETARY),
  v.literal(ROLES.TECHNICIAN),
);

// ─── Organization Types ──────────────────────────────────────────────────────
export const ORG_TYPES = {
  PREFEITURA: "prefeitura",
  PACO_MUNICIPAL: "paco_municipal",
  GABINETE: "gabinete",
  SECRETARIA: "secretaria",
  DEPARTAMENTO: "departamento",
  UNIDADE: "unidade",
} as const;

export const orgTypeValidator = v.union(
  v.literal(ORG_TYPES.PREFEITURA),
  v.literal(ORG_TYPES.PACO_MUNICIPAL),
  v.literal(ORG_TYPES.GABINETE),
  v.literal(ORG_TYPES.SECRETARIA),
  v.literal(ORG_TYPES.DEPARTAMENTO),
  v.literal(ORG_TYPES.UNIDADE),
);

// ─── Stock Movement Types ────────────────────────────────────────────────────
export const MOVEMENT_TYPES = {
  ENTRY: "entry",
  EXIT: "exit",
  TRANSFER: "transfer",
  ADJUSTMENT: "adjustment",
  RETURN: "return",
} as const;

export const movementTypeValidator = v.union(
  v.literal(MOVEMENT_TYPES.ENTRY),
  v.literal(MOVEMENT_TYPES.EXIT),
  v.literal(MOVEMENT_TYPES.TRANSFER),
  v.literal(MOVEMENT_TYPES.ADJUSTMENT),
  v.literal(MOVEMENT_TYPES.RETURN),
);

// ─── Request Status ──────────────────────────────────────────────────────────
export const REQUEST_STATUS = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  DELIVERED: "delivered",
  CANCELLED: "cancelled",
} as const;

export const requestStatusValidator = v.union(
  v.literal(REQUEST_STATUS.PENDING),
  v.literal(REQUEST_STATUS.APPROVED),
  v.literal(REQUEST_STATUS.REJECTED),
  v.literal(REQUEST_STATUS.DELIVERED),
  v.literal(REQUEST_STATUS.CANCELLED),
);

// ─── Audit Action Types ──────────────────────────────────────────────────────
export const AUDIT_ACTIONS = {
  CREATE: "create",
  UPDATE: "update",
  ACTIVATE: "activate",
  DEACTIVATE: "deactivate",
  APPROVE: "approve",
  REJECT: "reject",
  CANCEL: "cancel",
  MOVE_STOCK: "move_stock",
  LOGIN: "login",
  LOGOUT: "logout",
  DELIVER: "deliver",
  PASSWORD_CHANGE: "password_change",
  PASSWORD_RESET: "password_reset",
  RESERVE: "reserve",
  TONER_UPDATE: "toner_update",
  CONFIRM_ENTRY: "confirm_entry",
  REVERSE_ENTRY: "reverse_entry",
  OPEN_INVENTORY: "open_inventory",
  COUNT_INVENTORY: "count_inventory",
  CLOSE_INVENTORY: "close_inventory",
  RETURN_STOCK: "return_stock",
  REVERSE_EXIT: "reverse_exit",
  TRANSFER_STOCK: "transfer_stock",
  GOMAQ_EXCHANGE: "gomaq_exchange",
  GOMAQ_COLLECTION: "gomaq_collection",
  GOMAQ_ORDER: "gomaq_order",
} as const;

export const auditActionValidator = v.union(
  v.literal(AUDIT_ACTIONS.CREATE),
  v.literal(AUDIT_ACTIONS.UPDATE),
  v.literal(AUDIT_ACTIONS.ACTIVATE),
  v.literal(AUDIT_ACTIONS.DEACTIVATE),
  v.literal(AUDIT_ACTIONS.APPROVE),
  v.literal(AUDIT_ACTIONS.REJECT),
  v.literal(AUDIT_ACTIONS.CANCEL),
  v.literal(AUDIT_ACTIONS.MOVE_STOCK),
  v.literal(AUDIT_ACTIONS.LOGIN),
  v.literal(AUDIT_ACTIONS.LOGOUT),
  v.literal(AUDIT_ACTIONS.DELIVER),
  v.literal(AUDIT_ACTIONS.PASSWORD_CHANGE),
  v.literal(AUDIT_ACTIONS.PASSWORD_RESET),
  v.literal(AUDIT_ACTIONS.RESERVE),
  v.literal(AUDIT_ACTIONS.TONER_UPDATE),
  v.literal(AUDIT_ACTIONS.CONFIRM_ENTRY),
  v.literal(AUDIT_ACTIONS.REVERSE_ENTRY),
  v.literal(AUDIT_ACTIONS.OPEN_INVENTORY),
  v.literal(AUDIT_ACTIONS.COUNT_INVENTORY),
  v.literal(AUDIT_ACTIONS.CLOSE_INVENTORY),
  v.literal(AUDIT_ACTIONS.RETURN_STOCK),
  v.literal(AUDIT_ACTIONS.REVERSE_EXIT),
  v.literal(AUDIT_ACTIONS.TRANSFER_STOCK),
  v.literal(AUDIT_ACTIONS.GOMAQ_EXCHANGE),
  v.literal(AUDIT_ACTIONS.GOMAQ_COLLECTION),
  v.literal(AUDIT_ACTIONS.GOMAQ_ORDER),
);

// ─── Units of Measure ────────────────────────────────────────────────────────
export const UNIT_OF_MEASURE_VALUES = [
  "un", "pc", "cx", "m", "rl", "pct", "outro",
] as const;

// ─── Schema ──────────────────────────────────────────────────────────────────
const schema = defineSchema(
  {
    // ── Auth tables (managed by @convex-dev/auth) ──
    ...authTables,

    // ── Users ──
    users: defineTable({
      name: v.optional(v.string()),
      image: v.optional(v.string()),
      email: v.optional(v.string()),
      emailVerificationTime: v.optional(v.number()),
      isAnonymous: v.optional(v.boolean()),
      role: v.optional(roleValidator),
      active: v.optional(v.boolean()),
      organizationId: v.optional(v.id("organizations")),
      lastLoginAt: v.optional(v.number()),
      requiresPasswordReset: v.optional(v.boolean()),
      createdAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
    }).index("email", ["email"])
      .index("by_role", ["role"])
      .index("by_active", ["active"]),

    // ── Passwords (custom email + password auth) ──
    passwords: defineTable({
      userId: v.id("users"),
      passwordHash: v.string(),
      salt: v.string(),
      requiresReset: v.boolean(),
    }).index("by_user", ["userId"]),

    // ── Organizations (hierarchical) ──
    organizations: defineTable({
      name: v.string(),
      type: orgTypeValidator,
      parentId: v.optional(v.id("organizations")),
      active: v.boolean(),
      startDate: v.optional(v.string()),
      endDate: v.optional(v.string()),
      observation: v.optional(v.string()),
    }).index("by_parent", ["parentId"])
      .index("by_type", ["type"])
      .index("by_active", ["active"]),

    // ── Categories ──
    categories: defineTable({
      name: v.string(),
      description: v.optional(v.string()),
      active: v.boolean(),
    }).index("by_active", ["active"]),

    // ── Products (Itens do Estoque) ──
    products: defineTable({
      name: v.string(),
      description: v.optional(v.string()),
      categoryId: v.id("categories"),
      unitOfMeasure: v.string(),
      internalCode: v.optional(v.string()),
      manufacturer: v.optional(v.string()),
      model: v.optional(v.string()),
      brand: v.optional(v.string()),
      specification: v.optional(v.string()),
      active: v.boolean(),
      minimumStock: v.number(),
      idealStock: v.number(),
      maximumStock: v.number(),
      observation: v.optional(v.string()),
      photo: v.optional(v.string()),
      // Prepared for future lot/serial tracking
      hasSerial: v.optional(v.boolean()),
      standardOrderQuantity: v.optional(v.number()),
    }).index("by_category", ["categoryId"])
      .index("by_active", ["active"])
      .index("by_code", ["internalCode"])
      .index("by_name", ["name"]),

    // ── Stock (per product) ──
    stock: defineTable({
      productId: v.id("products"),
      physicalQuantity: v.number(),
      reservedQuantity: v.number(),
    }).index("by_product", ["productId"]),

    // ── Suppliers ──
    suppliers: defineTable({
      legalName: v.string(),
      tradeName: v.optional(v.string()),
      cnpj: v.optional(v.string()),
      contact: v.optional(v.string()),
      phone: v.optional(v.string()),
      email: v.optional(v.string()),
      address: v.optional(v.string()),
      active: v.boolean(),
      observation: v.optional(v.string()),
    }).index("by_active", ["active"])
      .index("by_cnpj", ["cnpj"]),

    // ── Stock Movements ──
    stockMovements: defineTable({
      productId: v.id("products"),
      type: movementTypeValidator,
      quantity: v.number(),
      previousPhysical: v.number(),
      newPhysical: v.number(),
      previousReserved: v.number(),
      newReserved: v.number(),
      userId: v.id("users"),
      supplierId: v.optional(v.id("suppliers")),
      requestId: v.optional(v.id("requests")),
      entryId: v.optional(v.id("entries")),
      lotId: v.optional(v.string()),
      documentNumber: v.optional(v.string()),
      observation: v.optional(v.string()),
      timestamp: v.number(),
      canceled: v.optional(v.boolean()),
      canceledAt: v.optional(v.number()),
    }).index("by_product", ["productId"])
      .index("by_type", ["type"])
      .index("by_user", ["userId"])
      .index("by_timestamp", ["timestamp"])
      .index("by_request", ["requestId"]),

    // ── Requests (Solicitações) ──
    requests: defineTable({
      requesterId: v.id("users"),
      status: requestStatusValidator,
      approverId: v.optional(v.id("users")),
      // Destination hierarchy
      secretariaId: v.id("organizations"),
      departamentoId: v.optional(v.id("organizations")),
      unidadeId: v.optional(v.id("organizations")),
      // Reason and O.S.
      reason: v.string(),
      osNumber: v.optional(v.string()),
      // Equipment patrimony (optional, prepared for future)
      patrimony: v.optional(v.string()),
      // Existing
      observation: v.optional(v.string()),
      approvalObservation: v.optional(v.string()),
      // Electronic signature (text stamp)
      deliveredBySignature: v.optional(v.string()),
      deliveredAt: v.optional(v.number()),
      receivedByUserId: v.optional(v.id("users")),
      reverseLogisticsConfirmed: v.optional(v.boolean()),
      createdAt: v.number(),
      updatedAt: v.number(),
    }).index("by_requester", ["requesterId"])
      .index("by_status", ["status"])
      .index("by_approver", ["approverId"])
      .index("by_created", ["createdAt"])
      .index("by_secretaria", ["secretariaId"]),

    // ── Printers (Impressoras) ──
    printers: defineTable({
      name: v.string(),
      brand: v.string(),
      model: v.string(),
      organizationId: v.optional(v.id("organizations")),
      patrimony: v.optional(v.string()),
      serialNumber: v.optional(v.string()),
      ipAddress: v.optional(v.string()),
      macAddress: v.optional(v.string()),
      observation: v.optional(v.string()),
      active: v.boolean(),
    }).index("by_organization", ["organizationId"])
      .index("by_active", ["active"]),

    // ── Printer Compatibility (Matriz de Compatibilidade Toners ↔ Impressoras) ──
    printerCompatibility: defineTable({
      productId: v.id("products"),
      printerModel: v.string(),
      estimatedYield: v.number(),
    }).index("by_product", ["productId"])
      .index("by_printer_model", ["printerModel"]),

    // ── Request Items ──
    requestItems: defineTable({
      requestId: v.id("requests"),
      productId: v.id("products"),
      quantityRequested: v.number(),
      quantityApproved: v.number(),
      quantityDelivered: v.number(),
      deliveredSerialNumbers: v.optional(v.array(v.string())),
      targetPrinterId: v.optional(v.id("printers")),
    }).index("by_request", ["requestId"])
      .index("by_product", ["productId"]),

    // ── Entries (Entradas de Estoque) ──
    entries: defineTable({
      entryNumber: v.string(),
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
      contractNumber: v.optional(v.string()),
      responsibleUserId: v.id("users"),
      observation: v.optional(v.string()),
      documentStorageId: v.optional(v.string()),
      status: v.union(
        v.literal("draft"), v.literal("confirmed"), v.literal("reversed")
      ),
      createdAt: v.number(),
      updatedAt: v.number(),
    }).index("by_status", ["status"])
      .index("by_number", ["entryNumber"])
      .index("by_date", ["receivedAt"]),

    // ── Entry Items (Itens da Entrada) ──
    entryItems: defineTable({
      entryId: v.id("entries"),
      productId: v.id("products"),
      quantity: v.number(),
      unitOfMeasure: v.string(),
      unitCost: v.optional(v.number()),
      totalCost: v.optional(v.number()),
      brand: v.optional(v.string()),
      model: v.optional(v.string()),
      specification: v.optional(v.string()),
      lotId: v.optional(v.string()),
      locationId: v.optional(v.id("storageLocations")),
      photoStorageId: v.optional(v.string()),
      observation: v.optional(v.string()),
    }).index("by_entry", ["entryId"])
      .index("by_product", ["productId"]),

    // ── Lots (Lotes de Entrada) ──
    lots: defineTable({
      lotNumber: v.string(),
      productId: v.id("products"),
      entryId: v.id("entries"),
      brand: v.optional(v.string()),
      model: v.optional(v.string()),
      specification: v.optional(v.string()),
      quantityReceived: v.number(),
      quantityAvailable: v.number(),
      unitCost: v.optional(v.number()),
      receivedAt: v.number(),
      supplierId: v.optional(v.id("suppliers")),
      invoiceNumber: v.optional(v.string()),
      purchaseAuthorizationNumber: v.optional(v.string()),
      photoStorageId: v.optional(v.string()),
      active: v.boolean(),
      observation: v.optional(v.string()),
    }).index("by_product", ["productId"])
      .index("by_entry", ["entryId"])
      .index("by_number", ["lotNumber"])
      .index("by_active", ["active"]),

    // ── Storage Locations (Locais de Armazenamento) ──
    storageLocations: defineTable({
      name: v.string(),
      description: v.optional(v.string()),
      active: v.boolean(),
    }).index("by_active", ["active"]),

    // ── Inventories (Inventários) ──
    inventories: defineTable({
      inventoryNumber: v.string(),
      date: v.number(),
      responsibleUserId: v.id("users"),
      status: v.union(
        v.literal("draft"), v.literal("counting"), v.literal("review"),
        v.literal("closed"), v.literal("cancelled")
      ),
      observation: v.optional(v.string()),
      closedAt: v.optional(v.number()),
      closedByUserId: v.optional(v.id("users")),
      createdAt: v.number(),
      updatedAt: v.number(),
    }).index("by_status", ["status"])
      .index("by_date", ["date"]),

    // ── Inventory Counts (Contagens do Inventário) ──
    inventoryCounts: defineTable({
      inventoryId: v.id("inventories"),
      productId: v.id("products"),
      lotId: v.optional(v.string()),
      systemQuantity: v.number(),
      countedQuantity: v.optional(v.number()),
      difference: v.optional(v.number()),
      observation: v.optional(v.string()),
    }).index("by_inventory", ["inventoryId"])
      .index("by_product", ["productId"]),

    // ── Request Item Lots (Rastreabilidade de Lotes por Item de Solicitação) ──
    requestItemLots: defineTable({
      requestItemId: v.id("requestItems"),
      lotId: v.id("lots"),
      quantity: v.number(),
    }).index("by_requestItem", ["requestItemId"])
      .index("by_lot", ["lotId"]),

    // ── Returns (Devoluções) ──
    returns: defineTable({
      requestId: v.id("requests"),
      requestItemId: v.id("requestItems"),
      productId: v.id("products"),
      lotId: v.optional(v.id("lots")),
      quantity: v.number(),
      reason: v.string(),
      returnedByUserId: v.id("users"),
      receivedByUserId: v.id("users"),
      observation: v.optional(v.string()),
      createdAt: v.number(),
    }).index("by_request", ["requestId"])
      .index("by_product", ["productId"]),

    // ── Stock by Location (Estoque por Local de Armazenamento) ──
    stockByLocation: defineTable({
      productId: v.id("products"),
      locationId: v.id("storageLocations"),
      quantity: v.number(),
    }).index("by_product", ["productId"])
      .index("by_location", ["locationId"]),

    // ── Stock Transfers (Transferências entre Locais) ──
    stockTransfers: defineTable({
      productId: v.id("products"),
      lotId: v.optional(v.id("lots")),
      fromLocationId: v.id("storageLocations"),
      toLocationId: v.id("storageLocations"),
      quantity: v.number(),
      responsibleUserId: v.id("users"),
      observation: v.optional(v.string()),
      createdAt: v.number(),
    }).index("by_product", ["productId"])
      .index("by_from", ["fromLocationId"])
      .index("by_to", ["toLocationId"]),

    // ── GOMAQ Exchanges (Trocas de Suprimento) ──
    gomaQExchanges: defineTable({
      exchangeNumber: v.string(),
      productId: v.id("products"),
      lotId: v.optional(v.id("lots")),
      printerId: v.id("printers"),
      quantityDelivered: v.number(),
      quantityEmptyReceived: v.number(),
      deliveredByUserId: v.id("users"),
      receivedByUserId: v.id("users"),
      requestId: v.optional(v.id("requests")),
      organizationId: v.optional(v.id("organizations")),
      exchangedAt: v.number(),
      observation: v.optional(v.string()),
    }).index("by_product", ["productId"])
      .index("by_printer", ["printerId"])
      .index("by_date", ["exchangedAt"])
      .index("by_number", ["exchangeNumber"]),

    // ── GOMAQ Empty Cartridges (Carcaças Vazias) ──
    gomaQEmptyCartridges: defineTable({
      productId: v.id("products"),
      printerId: v.optional(v.id("printers")),
      quantity: v.number(),
      generatedAt: v.number(),
      sourceExchangeId: v.id("gomaQExchanges"),
      storageLocationId: v.optional(v.id("storageLocations")),
      status: v.union(
        v.literal("awaiting_collection"), v.literal("collected")
      ),
      collectedAt: v.optional(v.number()),
      collectionId: v.optional(v.id("gomaQCollections")),
      createdByUserId: v.id("users"),
      observation: v.optional(v.string()),
    }).index("by_status", ["status"])
      .index("by_product", ["productId"])
      .index("by_printer", ["printerId"]),

    // ── GOMAQ Collections (Coletas) ──
    gomaQCollections: defineTable({
      collectionNumber: v.string(),
      collectedAt: v.number(),
      responsibleUserId: v.id("users"),
      observation: v.optional(v.string()),
      documentStorageId: v.optional(v.string()),
      totalCartridges: v.number(),
    }).index("by_date", ["collectedAt"]),

    // ── Audit Log ──
    auditLogs: defineTable({
      userId: v.optional(v.id("users")),
      action: auditActionValidator,
      entity: v.string(),
      entityId: v.optional(v.string()),
      details: v.optional(v.string()),
      timestamp: v.number(),
    }).index("by_user", ["userId"])
      .index("by_entity", ["entity"])
      .index("by_action", ["action"])
      .index("by_timestamp", ["timestamp"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;

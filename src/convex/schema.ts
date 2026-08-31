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
      // Digital signature (Base64 image)
      deliveredSignature: v.optional(v.string()),
      deliveredAt: v.optional(v.number()),
      createdAt: v.number(),
      updatedAt: v.number(),
    }).index("by_requester", ["requesterId"])
      .index("by_status", ["status"])
      .index("by_approver", ["approverId"])
      .index("by_created", ["createdAt"])
      .index("by_secretaria", ["secretariaId"]),

    // ── Request Items ──
    requestItems: defineTable({
      requestId: v.id("requests"),
      productId: v.id("products"),
      quantityRequested: v.number(),
      quantityApproved: v.number(),
      quantityDelivered: v.number(),
      deliveredSerialNumbers: v.optional(v.array(v.string())),
    }).index("by_request", ["requestId"])
      .index("by_product", ["productId"]),

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

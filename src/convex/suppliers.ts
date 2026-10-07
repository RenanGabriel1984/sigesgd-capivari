import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requirePermission } from "./rbac";
import { assertTextLimits, assertShortTextLimits, MAX_OBSERVATION } from "../lib/text-limits";
import { isValidCnpj, normalizePhone, digitsOnly } from "../lib/br-validators";

type UserRole = "admin" | "stock_manager" | "director" | "secretary" | "technician";

async function requireUser(ctx: any) {
  // RBAC central: fornecedores exigem permissão de visualização.
  return requirePermission(ctx, "suppliers.view");
}

async function requireStockManagerOrAdmin(ctx: any) {
  // RBAC central: gerenciamento de fornecedores.
  return requirePermission(ctx, "suppliers.manage", { entity: "suppliers" });
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return await ctx.db.query("suppliers").collect();
  },
});

export const listActive = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return await ctx.db.query("suppliers").withIndex("by_active", (q) => q.eq("active", true)).collect();
  },
});

export const get = query({
  args: { id: v.id("suppliers") },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    return await ctx.db.get(args.id);
  },
});

export const search = query({
  args: { term: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const term = (args.term ?? "").trim();
    const all = await ctx.db.query("suppliers").collect();
    if (!term) return all;
    const t = term.toLowerCase();
    return all.filter((s: any) => {
      const haystack = [
        s.legalName,
        s.tradeName,
        s.cnpj,
        s.contactPerson,
        s.contact,
        s.phone,
        s.email,
        s.streetName,
        s.district,
        s.city,
        s.state,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(t);
    });
  },
});

export const findByIdForNfe = query({
  args: { id: v.id("suppliers") },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const s = await ctx.db.get(args.id);
    if (!s) return null;
    return {
      _id: s._id,
      legalName: s.legalName,
      tradeName: s.tradeName,
      cnpj: s.cnpj,
      contactPerson: s.contactPerson,
      contact: s.contact,
      phone: s.phone,
      email: s.email,
      addressType: s.addressType,
      streetName: s.streetName,
      number: s.number,
      complement: s.complement,
      district: s.district,
      postalCode: s.postalCode,
      city: s.city,
      state: s.state,
    };
  },
});

export const create = mutation({
  args: {
    legalName: v.string(),
    tradeName: v.optional(v.string()),
    cnpj: v.optional(v.string()),
    contactPerson: v.optional(v.string()),
    contact: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    addressType: v.optional(
      v.union(
        v.literal("rua"),
        v.literal("avenida"),
        v.literal("travessa"),
        v.literal("alameda"),
        v.literal("rodovia"),
        v.literal("estrada"),
        v.literal("outro"),
      ),
    ),
    streetName: v.optional(v.string()),
    number: v.optional(v.string()),
    complement: v.optional(v.string()),
    district: v.optional(v.string()),
    postalCode: v.optional(v.string()),
    city: v.optional(v.string()),
    state: v.optional(v.string()),
    addressLegacy: v.optional(v.string()),
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireStockManagerOrAdmin(ctx);
    if (!args.legalName.trim()) throw new Error("Razão social é obrigatória");

    // CNPJ: normalização + validação digitos verificadores
    const cnpjClean = args.cnpj ? digitsOnly(args.cnpj) : undefined;
    if (cnpjClean && !isValidCnpj(cnpjClean)) {
      throw new Error("CNPJ inválido: verifique os dígitos verificadores.");
    }

    // Limites de texto livre (rejeita, nunca trunca)
    assertTextLimits({
      legalName: args.legalName,
      tradeName: args.tradeName,
      addressLegacy: args.addressLegacy,
      streetName: args.streetName,
      district: args.district,
      city: args.city,
    });
    assertTextLimits({ observation: args.observation }, MAX_OBSERVATION);
    assertShortTextLimits({
      cnpj: args.cnpj,
      contactPerson: args.contactPerson,
      contact: args.contact,
      phone: args.phone,
      email: args.email,
      number: args.number,
      complement: args.complement,
      postalCode: args.postalCode,
      state: args.state,
    });
    if (args.number && args.number.length > 30) {
      throw new Error("Número/endereço muito longo.");
    }

    // Unicidade por CNPJ normalizado
    if (cnpjClean) {
      const existing = await ctx.db
        .query("suppliers")
        .withIndex("by_cnpj", (q: any) => q.eq("cnpj", cnpjClean))
        .first();
      if (existing) throw new Error("Já existe um fornecedor com este CNPJ");
    }

    const id = await ctx.db.insert("suppliers", {
      legalName: args.legalName.trim(),
      tradeName: args.tradeName ? args.tradeName.trim() : undefined,
      cnpj: cnpjClean,
      contactPerson: args.contactPerson ? args.contactPerson.trim() : undefined,
      contact: args.contact ? args.contact.trim() : undefined,
      phone: args.phone ? normalizePhone(args.phone) : undefined,
      email: args.email ? args.email.trim().toLowerCase() : undefined,
      addressType: args.addressType,
      streetName: args.streetName ? args.streetName.trim() : undefined,
      number: args.number ? args.number.trim() : undefined,
      complement: args.complement ? args.complement.trim() : undefined,
      district: args.district ? args.district.trim() : undefined,
      postalCode: args.postalCode ? digitsOnly(args.postalCode) : undefined,
      city: args.city ? args.city.trim() : undefined,
      state: args.state ? args.state.trim().toUpperCase() : undefined,
      addressLegacy: args.addressLegacy ? args.addressLegacy.trim() : undefined,
      active: true,
    });

    await ctx.db.insert("auditLogs", {
      userId,
      action: "create",
      entity: "suppliers",
      entityId: id,
      details: `Fornecedor "${args.legalName}" criado`,
      timestamp: Date.now(),
    });

    return id;
  },
});

export const update = mutation({
  args: {
    id: v.id("suppliers"),
    legalName: v.optional(v.string()),
    tradeName: v.optional(v.string()),
    cnpj: v.optional(v.string()),
    contactPerson: v.optional(v.string()),
    contact: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    addressType: v.optional(
      v.union(
        v.literal("rua"),
        v.literal("avenida"),
        v.literal("travessa"),
        v.literal("alameda"),
        v.literal("rodovia"),
        v.literal("estrada"),
        v.literal("outro"),
      ),
    ),
    streetName: v.optional(v.string()),
    number: v.optional(v.string()),
    complement: v.optional(v.string()),
    district: v.optional(v.string()),
    postalCode: v.optional(v.string()),
    city: v.optional(v.string()),
    state: v.optional(v.string()),
    addressLegacy: v.optional(v.string()),
    active: v.optional(v.boolean()),
    observation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireStockManagerOrAdmin(ctx);
    const { id, ...updates } = args;

    const supplier = await ctx.db.get(id);
    if (!supplier) throw new Error("Fornecedor não encontrado");

    const cnpjClean = updates.cnpj ? digitsOnly(updates.cnpj) : undefined;
    if (cnpjClean && !isValidCnpj(cnpjClean)) {
      throw new Error("CNPJ inválido: verifique os dígitos verificadores.");
    }

    // Unicidade por CNPJ quando ele muda
    if (cnpjClean && cnpjClean !== (supplier.cnpj ?? "")) {
      const existing = await ctx.db
        .query("suppliers")
        .withIndex("by_cnpj", (q: any) => q.eq("cnpj", cnpjClean))
        .first();
      if (existing && existing._id !== id) {
        throw new Error("Já existe outro fornecedor com este CNPJ");
      }
    }

    if (updates.legalName) updates.legalName = updates.legalName.trim();
    if (updates.tradeName !== undefined)
      updates.tradeName = updates.tradeName ? updates.tradeName.trim() : undefined;
    if (updates.cnpj !== undefined) updates.cnpj = cnpjClean;
    if (updates.contactPerson !== undefined)
      updates.contactPerson = updates.contactPerson ? updates.contactPerson.trim() : undefined;
    if (updates.contact !== undefined)
      updates.contact = updates.contact ? updates.contact.trim() : undefined;
    if (updates.phone !== undefined) updates.phone = normalizePhone(updates.phone);
    if (updates.email !== undefined)
      updates.email = updates.email ? updates.email.trim().toLowerCase() : undefined;
    if (updates.streetName !== undefined)
      updates.streetName = updates.streetName ? updates.streetName.trim() : undefined;
    if (updates.number !== undefined)
      updates.number = updates.number ? updates.number.trim() : undefined;
    if (updates.complement !== undefined)
      updates.complement = updates.complement ? updates.complement.trim() : undefined;
    if (updates.district !== undefined)
      updates.district = updates.district ? updates.district.trim() : undefined;
    if (updates.postalCode !== undefined)
      updates.postalCode = digitsOnly(updates.postalCode);
    if (updates.city !== undefined)
      updates.city = updates.city ? updates.city.trim() : undefined;
    if (updates.state !== undefined)
      updates.state = updates.state ? updates.state.trim().toUpperCase() : undefined;
    if (updates.addressLegacy !== undefined)
      updates.addressLegacy = updates.addressLegacy ? updates.addressLegacy.trim() : undefined;

    // Limites de texto livre para os campos editáveis
    assertTextLimits({
      legalName: updates.legalName,
      tradeName: updates.tradeName,
      addressLegacy: updates.addressLegacy,
      streetName: updates.streetName,
      district: updates.district,
      city: updates.city,
    });
    assertTextLimits({ observation: updates.observation }, MAX_OBSERVATION);
    assertShortTextLimits({
      cnpj: updates.cnpj,
      contactPerson: updates.contactPerson,
      contact: updates.contact,
      phone: updates.phone,
      email: updates.email,
      number: updates.number,
      complement: updates.complement,
      postalCode: updates.postalCode,
      state: updates.state,
    });
    if (updates.number && updates.number.length > 30) {
      throw new Error("Número/endereço muito longo.");
    }

    await ctx.db.patch(id, updates);

    const action =
      updates.active === false
        ? "deactivate"
        : updates.active === true
          ? "activate"
          : "update";
    await ctx.db.insert("auditLogs", {
      userId,
      action,
      entity: "suppliers",
      entityId: id,
      details: `Fornecedor "${supplier.legalName}" — ${JSON.stringify(updates)}`,
      timestamp: Date.now(),
    });

    return id;
  },
});

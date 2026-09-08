import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation } from "./_generated/server";
import { v } from "convex/values";

/** Require admin user. */
async function requireAdmin(ctx: any) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Não autenticado");
  const user = await ctx.db.get(userId);
  if (!user) throw new Error("Perfil de usuário não encontrado");
  if (user.role !== "admin")
    throw new Error("Apenas administradores podem executar esta operação");
  return { userId, user };
}

/**
 * Idempotent seed: create Capivari municipal organizational structure.
 * Safe to run multiple times — never duplicates existing records.
 */
export const seedOrganizations = mutation({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAdmin(ctx);

    // Check if seed was already applied
    const existing = await ctx.db.query("organizations").collect();
    if (existing.length > 0) {
      return {
        message: `Já existem ${existing.length} organizações cadastradas. Seed ignorado.`,
        created: 0,
      };
    }

    const now = Date.now();
    const createdIds: Record<string, string> = {};

    // Helper: find or create org by name
    async function findOrCreate(
      name: string,
      type: string,
      parentId?: string
    ): Promise<string> {
      // Check if already exists by searching (no unique index on name, so scan)
      const orgs = await ctx.db
        .query("organizations")
        .withIndex("by_type", (q) => q.eq("type", type as any))
        .collect();
      const existing = orgs.find(
        (o) => o.name === name && o.parentId === (parentId ?? undefined)
      );
      if (existing) return existing._id;

      const id = await ctx.db.insert("organizations", {
        name,
        type: type as any,
        parentId: parentId as any,
        active: true,
        createdAt: now,
      } as any);
      return id;
    }

    // ── Prefeitura Municipal ──
    const prefeitura = await findOrCreate(
      "Prefeitura Municipal de Capivari",
      "prefeitura"
    );
    createdIds["prefeitura"] = prefeitura;

    // ── Secretaria de Gestão e Governo Digital ──
    const sggd = await findOrCreate(
      "Secretaria de Gestão e Governo Digital",
      "secretaria",
      prefeitura
    );
    createdIds["sggd"] = sggd;

    // ── Departamentos da SGGD ──
    const deptTI = await findOrCreate(
      "Departamento de Tecnologia da Informação",
      "departamento",
      sggd
    );
    createdIds["deptTI"] = deptTI;

    const deptGestao = await findOrCreate(
      "Departamento de Gestão",
      "departamento",
      sggd
    );
    createdIds["deptGestao"] = deptGestao;

    // ── Unidades do Dept TI ──
    const unInfra = await findOrCreate(
      "Infraestrutura de TI",
      "unidade",
      deptTI
    );
    createdIds["unInfra"] = unInfra;

    const unDev = await findOrCreate(
      "Desenvolvimento de Sistemas",
      "unidade",
      deptTI
    );
    createdIds["unDev"] = unDev;

    const unHelpdesk = await findOrCreate(
      "Suporte / Helpdesk",
      "unidade",
      deptTI
    );
    createdIds["unHelpdesk"] = unHelpdesk;

    // ── Outras Secretarias (referência) ──
    const secSaude = await findOrCreate("Secretaria de Saúde", "secretaria", prefeitura);
    const secEducacao = await findOrCreate("Secretaria de Educação", "secretaria", prefeitura);
    const secFinancas = await findOrCreate("Secretaria de Finanças", "secretaria", prefeitura);
    const secAdministracao = await findOrCreate("Secretaria de Administração", "secretaria", prefeitura);
    const secObras = await findOrCreate("Secretaria de Obras", "secretaria", prefeitura);
    const secAssistencia = await findOrCreate("Secretaria de Assistência Social", "secretaria", prefeitura);
    const secCultura = await findOrCreate("Secretaria de Cultura", "secretaria", prefeitura);
    const secEsporte = await findOrCreate("Secretaria de Esportes e Lazer", "secretaria", prefeitura);

    // Audit
    await ctx.db.insert("auditLogs", {
      userId,
      action: "create",
      entity: "seed",
      entityId: prefeitura,
      details: `Seed: estrutura organizacional de Capivari criada (${Object.keys(createdIds).length} nós + referências)`,
      timestamp: now,
    });

    return {
      message: "Estrutura organizacional de Capivari criada com sucesso",
      created: Object.keys(createdIds).length + 8, // +8 referências
      ids: createdIds,
    };
  },
});

/**
 * Idempotent seed: create default storage locations.
 */
export const seedStorageLocations = mutation({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAdmin(ctx);

    const existing = await ctx.db.query("storageLocations").collect();
    if (existing.length > 0) {
      return {
        message: `Já existem ${existing.length} locais cadastrados. Seed ignorado.`,
        created: 0,
      };
    }

    const locations = [
      { name: "Armário TI 01", description: "Armário principal de TI" },
      { name: "Armário TI 02", description: "Armário secundário de TI" },
    ];

    const createdIds: string[] = [];
    for (const loc of locations) {
      const id = await ctx.db.insert("storageLocations", {
        name: loc.name,
        description: loc.description,
        active: true,
      });
      createdIds.push(id);
    }

    await ctx.db.insert("auditLogs", {
      userId,
      action: "create",
      entity: "seed",
      entityId: createdIds[0],
      details: `Seed: ${createdIds.length} locais de armazenamento criados`,
      timestamp: Date.now(),
    });

    return {
      message: "Locais de armazenamento criados",
      created: createdIds.length,
    };
  },
});

/**
 * Full seed: organizations + storage locations.
 * Idempotent — safe to run multiple times.
 */
export const seedAll = mutation({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAdmin(ctx);

    // Seed organizations
    const existingOrgs = await ctx.db.query("organizations").collect();
    let orgsCreated = 0;
    if (existingOrgs.length === 0) {
      // Inline the org creation to avoid calling another mutation
      const now = Date.now();

      async function findOrCreateOrg(
        name: string,
        type: string,
        parentId?: string
      ): Promise<string> {
        const orgs = await ctx.db
          .query("organizations")
          .withIndex("by_type", (q) => q.eq("type", type as any))
          .collect();
        const found = orgs.find(
          (o) => o.name === name && o.parentId === (parentId ?? undefined)
        );
        if (found) return found._id;

        const id = await ctx.db.insert("organizations", {
          name,
          type: type as any,
          parentId: parentId as any,
          active: true,
        } as any);
        orgsCreated++;
        return id;
      }

      const pf = await findOrCreateOrg(
        "Prefeitura Municipal de Capivari",
        "prefeitura"
      );
      const sggd = await findOrCreateOrg(
        "Secretaria de Gestão e Governo Digital",
        "secretaria",
        pf
      );
      const dti = await findOrCreateOrg(
        "Departamento de Tecnologia da Informação",
        "departamento",
        sggd
      );
      await findOrCreateOrg("Departamento de Gestão", "departamento", sggd);
      await findOrCreateOrg("Infraestrutura de TI", "unidade", dti);
      await findOrCreateOrg("Desenvolvimento de Sistemas", "unidade", dti);
      await findOrCreateOrg("Suporte / Helpdesk", "unidade", dti);
      await findOrCreateOrg("Secretaria de Saúde", "secretaria", pf);
      await findOrCreateOrg("Secretaria de Educação", "secretaria", pf);
      await findOrCreateOrg("Secretaria de Finanças", "secretaria", pf);
      await findOrCreateOrg("Secretaria de Administração", "secretaria", pf);
      await findOrCreateOrg("Secretaria de Obras", "secretaria", pf);
      await findOrCreateOrg("Secretaria de Assistência Social", "secretaria", pf);
      await findOrCreateOrg("Secretaria de Cultura", "secretaria", pf);
      await findOrCreateOrg("Secretaria de Esportes e Lazer", "secretaria", pf);
    }

    // Seed storage locations
    const existingLocs = await ctx.db.query("storageLocations").collect();
    let locsCreated = 0;
    if (existingLocs.length === 0) {
      const id1 = await ctx.db.insert("storageLocations", {
        name: "Armário TI 01",
        description: "Armário principal de TI",
        active: true,
      });
      const id2 = await ctx.db.insert("storageLocations", {
        name: "Armário TI 02",
        description: "Armário secundário de TI",
        active: true,
      });
      locsCreated = 2;
    }

    await ctx.db.insert("auditLogs", {
      userId,
      action: "create",
      entity: "seed",
      details: `Seed completo: ${orgsCreated} organizações + ${locsCreated} locais`,
      timestamp: Date.now(),
    });

    return {
      message: "Seed completo executado",
      organizationsCreated: orgsCreated,
      locationsCreated: locsCreated,
    };
  },
});

/**
 * Idempotent seed: create default categories for IT stock.
 */
export const seedCategories = mutation({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAdmin(ctx);

    const existing = await ctx.db.query("categories").collect();
    if (existing.length > 0) {
      return {
        message: `Já existem ${existing.length} categorias. Seed ignorado.`,
        created: 0,
      };
    }

    const categories = [
      "Toner",
      "Ribbon",
      "Bobina",
      "Cartão PVC",
      "Memória RAM",
      "Armazenamento (SSD/HD)",
      "Cabo / Adaptador",
      "No-break",
      "Mouse / Teclado",
      "Monitor",
      "Placa de Rede",
      "Outros",
    ];

    const createdIds: string[] = [];
    for (const name of categories) {
      const id = await ctx.db.insert("categories", {
        name,
        active: true,
      });
      createdIds.push(id);
    }

    await ctx.db.insert("auditLogs", {
      userId,
      action: "create",
      entity: "seed",
      entityId: createdIds[0],
      details: `Seed: ${createdIds.length} categorias padrão criadas`,
      timestamp: Date.now(),
    });

    return {
      message: "Categorias padrão criadas",
      created: createdIds.length,
    };
  },
});

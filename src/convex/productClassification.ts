/**
 * SIGESGD — Classificação oficial dos 53 produtos do estoque de implantação.
 *
 * Alteração EXCLUSIVAMENTE cadastral: cria/reativa as 7 categorias oficiais e
 * atualiza `products.categoryId`.
 *
 * NÃO toca em: quantidades, stock, stockByLocation, lotes, entradas e itens de
 * entrada, movimentações, solicitações, fornecedores, organizações, usuários,
 * auditoria histórica. A mutation tira um snapshot antes/depois dessas tabelas
 * e FALHA (sem gravar) se qualquer uma mudar.
 *
 * As duas funções são `internal` (canal CLI/dashboard do deployment) e exigem
 * confirmação literal — nunca ficam expostas ao cliente web.
 */
import { internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";

const OFFICIAL_ENTRY_NUMBER = "ENT-2026-000001";

const OFFICIAL_CATEGORIES = [
  "Periféricos",
  "Redes e Conectividade",
  "Armazenamento e Hardware",
  "Telefonia e Comunicação",
  "Suprimentos de Impressão",
  "Materiais de Infraestrutura",
  "Ferramentas e Manutenção",
] as const;

type OfficialCategory = (typeof OFFICIAL_CATEGORIES)[number];

/**
 * Distribuição esperada de PRODUTOS distintos por categoria (conferência
 * obrigatória antes de qualquer gravação). Não considera quantidade em estoque.
 */
const EXPECTED_DISTRIBUTION: Record<OfficialCategory, number> = {
  "Periféricos": 11,
  "Redes e Conectividade": 9,
  "Armazenamento e Hardware": 2,
  "Telefonia e Comunicação": 4,
  "Suprimentos de Impressão": 17,
  "Materiais de Infraestrutura": 5,
  "Ferramentas e Manutenção": 5,
};

/**
 * Categorias já existentes que apenas recebem o nome oficial (reuso do mesmo
 * registro, sem criar duplicata).
 */
const CATEGORY_REUSE_BY_RENAME: Array<{ existing: string; official: OfficialCategory }> = [
  { existing: "Redes", official: "Redes e Conectividade" },
  { existing: "Armazenamento", official: "Armazenamento e Hardware" },
];

/**
 * Mapeamento oficial: cada produto é identificado pelo `_id` real do banco —
 * nunca só pelo nome, pois há homônimos (Telefone VoIP TIP 125I, V5502, TIP
 * 125I Montado, Telefone Attimo). O campo `name` é conferido contra o cadastro
 * durante a execução: divergência aborta a operação.
 */
const PRODUCT_CLASSIFICATION: Array<{
  productId: string;
  name: string;
  category: OfficialCategory;
}> = [
  // ── Periféricos (11) ──
  { productId: "kd7c8rpe86k518xfkwy06va4x1vce6na", name: "Adaptador HDMI para VGA", category: "Periféricos" },
  { productId: "kd73p2e032mx1hkfathf26xks8gfrm1k", name: "Cabo adaptador DisplayPort para VGA", category: "Periféricos" },
  { productId: "kd77gqfvsc6xv1dsz9tg4wqx3wbkqzf1", name: "Hub USB 3.0", category: "Periféricos" },
  { productId: "kd795gxachh2xrj83ntdzsxpq9d0ab3z", name: "Kit teclado e mouse", category: "Periféricos" },
  { productId: "kd73bbafnx975nkjtdeymbk50f7h6sxb", name: "Mouse com fio", category: "Periféricos" },
  { productId: "kd70f0sfrmxt0cj7nwsxj378dbyyfe69", name: "Mouse wireless", category: "Periféricos" },
  { productId: "kd784kpqtd14303gw0r35qfeb0g0rszb", name: "Mousepad", category: "Periféricos" },
  { productId: "kd7dxnrs748q15twbp11acxaamq1qmwz", name: "Teclado", category: "Periféricos" },
  { productId: "kd705z2nqbm5g4pxk7b6g57s8pfv17a8", name: "Teclado com fio", category: "Periféricos" },
  { productId: "kd73m4sd428yhvs31s6zwkk415arm090", name: "Teclado KB 110 com fio", category: "Periféricos" },
  { productId: "kd73yf1tevcxttkek1xd6hs8h9tmef1s", name: "Teclado numérico", category: "Periféricos" },
  // ── Redes e Conectividade (9) ──
  { productId: "kd74q6xwtfqdcm778jcngwatbe2ct1ak", name: "Conector linear de emenda para cabo RJ45 CAT6", category: "Redes e Conectividade" },
  { productId: "kd70j7ja3f5280e1gm0148grgcdscamv", name: "Conector RJ45", category: "Redes e Conectividade" },
  { productId: "kd7fkx0z69wr6denhpa3tszvdg361fw9", name: "Conector RJ45 blindado CAT5", category: "Redes e Conectividade" },
  { productId: "kd7aczn9kw3q9yr226rt25yvwqffzs65", name: "Conector RJ45 Cat5E", category: "Redes e Conectividade" },
  { productId: "kd7e2baxwnddv2m3fwhbvry84kpkznmw", name: "Keystone Jack para RJ45", category: "Redes e Conectividade" },
  { productId: "kd7ec5tc4bfc0xwsb8mqtyag0p1f8hpz", name: "RouterBoard", category: "Redes e Conectividade" },
  { productId: "kd782kjmeettqt99pvbw9mgt5gw7m34y", name: "Switch 26 portas", category: "Redes e Conectividade" },
  { productId: "kd77kgsmqs3cy796j7s2xn2wxj8m641b", name: "Switch 5 portas 10/100 PoE", category: "Redes e Conectividade" },
  { productId: "kd778yba6f7nyx9rwcrvgsw0hcbhsfye", name: "Switch JetStream 8 portas", category: "Redes e Conectividade" },
  // ── Armazenamento e Hardware (2) ──
  { productId: "kd765djstdgckchkpk8rgmmntd002gy4", name: "Cooler para processador Intel", category: "Armazenamento e Hardware" },
  { productId: "kd784s7x7jdz4934btv51jqakvhrmg0p", name: "Leitor de DVD", category: "Armazenamento e Hardware" },
  // ── Telefonia e Comunicação (4) ──
  { productId: "kd78xrt000ft0nd3xzbp0hwz9ky6j3pz", name: "Telefone", category: "Telefonia e Comunicação" },
  { productId: "kd74qgp9fxm9dbbnsf5rsz4s3cvvw9dy", name: "Telefone VoIP TIP 125I", category: "Telefonia e Comunicação" },
  { productId: "kd7ebr466x4khfn3gcjw7j3csm4rtkz9", name: "Telefone VoIP TIP 125I — Montado", category: "Telefonia e Comunicação" },
  { productId: "kd75jge7xz4m1x67dsd5950kk7418dd8", name: "Telefone VoIP V5502", category: "Telefonia e Comunicação" },
  // ── Suprimentos de Impressão (17) ──
  { productId: "kd79tf11zqbdtvg8sr8cq86zbtcbvs3f", name: "Cartão PVC para crachá", category: "Suprimentos de Impressão" },
  { productId: "kd7ekp0q766xv75xtakn0ewvjrcfr1pd", name: "Etiqueta para impressão adesiva", category: "Suprimentos de Impressão" },
  { productId: "kd75k6hz4gj7szvar4d44nxnwp9a52qa", name: "Papel para impressora térmica", category: "Suprimentos de Impressão" },
  { productId: "kd75me863v1ym08hdmrpw7h76eazwxg0", name: "Protetor de crachá — caixa fechada", category: "Suprimentos de Impressão" },
  { productId: "kd7dqfja6nxhcr33qmjw2mg85e76jx65", name: "Protetor de crachá — unidade avulsa", category: "Suprimentos de Impressão" },
  { productId: "kd77k3sc9cgvrf2svjdmms95ht2b9ts1", name: "Ribbon para impressora de etiqueta adesiva", category: "Suprimentos de Impressão" },
  { productId: "kd7cm0h4dy5c04kxzt6tqnpnkc7ny2yv", name: "Toner AltaLink — Amarelo", category: "Suprimentos de Impressão" },
  { productId: "kd73hh4taw6qmfkefmdn9aw2x2d4dths", name: "Toner AltaLink — Ciano", category: "Suprimentos de Impressão" },
  { productId: "kd77q3s07rwr3tb5vannbh7y0xp6sn49", name: "Toner AltaLink — Magenta", category: "Suprimentos de Impressão" },
  { productId: "kd7c9nh07rcqy6ep21553jjbdyzfpm1k", name: "Toner AltaLink — Preto", category: "Suprimentos de Impressão" },
  { productId: "kd7a1824vydkd3jrpqz2vy3q6tga9k4v", name: "Toner CX735 — Amarelo", category: "Suprimentos de Impressão" },
  { productId: "kd74zphr0t1ettp589avsqdmabafkw83", name: "Toner CX735 — Magenta", category: "Suprimentos de Impressão" },
  { productId: "kd73jm219xh8099kywwtvhc4rca38v8x", name: "Toner Lexmark XM5365", category: "Suprimentos de Impressão" },
  { productId: "kd79s0w1swbe5nsc806f1kfarkec9ah7", name: "Toner VersaLink — Amarelo", category: "Suprimentos de Impressão" },
  { productId: "kd7bb198gaf6w02w2d3z57dwc6082f1h", name: "Toner VersaLink — Ciano", category: "Suprimentos de Impressão" },
  { productId: "kd7b3m5evq8cn91djtqj2rnkcnjh3dkv", name: "Toner VersaLink — Magenta", category: "Suprimentos de Impressão" },
  { productId: "kd76bdg20hy36kpcebnx7qjeftdaswve", name: "Toner VersaLink — Preto", category: "Suprimentos de Impressão" },
  // ── Materiais de Infraestrutura (5) ──
  { productId: "kd7857pngw9wh2xswpm6md50tg3jmn6p", name: "Abraçadeira de nylon", category: "Materiais de Infraestrutura" },
  { productId: "kd73vq06g7x5p38emxaxkajw0bqptcqy", name: "Cadeado chave tetra", category: "Materiais de Infraestrutura" },
  { productId: "kd76fh1arq4cnjbhapmtq7defr6yrep0", name: "Caixa com tampa de sobrepor para tomada", category: "Materiais de Infraestrutura" },
  { productId: "kd72y7a2hk8wyv4yes2bbvyj5dq4qgab", name: "Fita isolante", category: "Materiais de Infraestrutura" },
  { productId: "kd7axse4j4sgk0407rbvdh44e01v51bw", name: "Módulo para tomada", category: "Materiais de Infraestrutura" },
  // ── Ferramentas e Manutenção (5) ──
  { productId: "kd7abyq2g36b0emq4271ted658xfwgye", name: "Jogo de chaves — 6 peças", category: "Ferramentas e Manutenção" },
  { productId: "kd77yqethnstygy32b85k3077k23pqck", name: "Jogo de chaves — 8 peças", category: "Ferramentas e Manutenção" },
  { productId: "kd74ssjbcjpx0rd4tezba29qsyjskqvq", name: "Limpa contato", category: "Ferramentas e Manutenção" },
  { productId: "kd787djc0xssensmknpc4nwt3k0qc6av", name: "Pasta térmica", category: "Ferramentas e Manutenção" },
  { productId: "kd7bhdcvk6xgjykwb561m92mjyp7teyb", name: "Pilha AAA", category: "Ferramentas e Manutenção" },
];

/** Contexto compartilhado pelas duas funções (produtos oficiais + categorias). */
async function loadContext(ctx: QueryCtx | MutationCtx) {
  const products = await ctx.db.query("products").collect();
  const categories = await ctx.db.query("categories").collect();
  const lots = await ctx.db.query("lots").collect();
  const entries = await ctx.db.query("entries").collect();
  const officialEntry = entries.find(
    (e) => e.entryNumber === OFFICIAL_ENTRY_NUMBER && e.originType === "initial_inventory"
  );
  const officialLots = officialEntry ? lots.filter((l) => l.entryId === officialEntry._id) : [];
  const officialIds = new Set(officialLots.map((l) => l.productId as string));
  return {
    products,
    categories,
    officialEntry,
    officialLots,
    officialIds,
    productById: new Map(products.map((p) => [p._id as string, p])),
    catById: new Map(categories.map((c) => [c._id as string, c])),
  };
}

/** Conferências obrigatórias antes de gravar qualquer coisa. */
function validateMapping(
  ctxData: Awaited<ReturnType<typeof loadContext>>
): void {
  const { products, officialEntry, officialIds, productById } = ctxData;
  if (!officialEntry) {
    throw new Error(`Carga inicial ${OFFICIAL_ENTRY_NUMBER} não encontrada. Operação abortada.`);
  }

  // 1) mapeamento × cadastro real (nome conferido: evita classificar homônimo errado)
  const problems: string[] = [];
  for (const entry of PRODUCT_CLASSIFICATION) {
    const product = productById.get(entry.productId);
    if (!product) problems.push(`produto inexistente: ${entry.productId} (${entry.name})`);
    else if (product.name !== entry.name)
      problems.push(
        `nome divergente em ${entry.productId}: banco="${product.name}" mapeamento="${entry.name}"`
      );
    else if (!officialIds.has(entry.productId))
      problems.push(`produto sem lote da carga oficial: ${entry.name}`);
  }
  if (problems.length > 0) {
    throw new Error(`Conferência do mapeamento falhou: ${problems.join("; ")}`);
  }

  // 2) cobertura total: nenhum produto oficial fora do mapeamento
  const classifiedIds = new Set(PRODUCT_CLASSIFICATION.map((e) => e.productId));
  const officialProducts = products.filter((p) => officialIds.has(p._id as string));
  const unclassified = officialProducts.filter((p) => !classifiedIds.has(p._id as string));
  if (unclassified.length > 0) {
    throw new Error(
      `Há produtos da carga oficial fora do mapeamento: ${unclassified.map((p) => p.name).join(", ")}`
    );
  }
  if (classifiedIds.size !== officialProducts.length) {
    throw new Error(
      `Mapeamento com ${classifiedIds.size} produtos, carga oficial com ${officialProducts.length}. Operação abortada.`
    );
  }

  // 3) distribuição esperada por categoria
  const byCategory: Record<string, number> = {};
  for (const entry of PRODUCT_CLASSIFICATION)
    byCategory[entry.category] = (byCategory[entry.category] ?? 0) + 1;
  for (const category of OFFICIAL_CATEGORIES) {
    if ((byCategory[category] ?? 0) !== EXPECTED_DISTRIBUTION[category]) {
      throw new Error(
        `Distribuição divergente em "${category}": mapeamento=${byCategory[category] ?? 0}, esperado=${EXPECTED_DISTRIBUTION[category]}`
      );
    }
  }
}

/**
 * Prévia (somente leitura): produto → categoria atual → nova categoria, além
 * das conferências exigidas antes da gravação.
 */
export const previewProductClassificationInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const data = await loadContext(ctx);
    const { products, categories, officialIds, productById, catById } = data;

    const rows = PRODUCT_CLASSIFICATION.map((entry) => {
      const product = productById.get(entry.productId);
      const current = product ? catById.get(product.categoryId as string)?.name ?? null : null;
      return {
        productId: entry.productId,
        name: entry.name,
        dbName: product?.name ?? null,
        dbNameMatches: product?.name === entry.name,
        exists: !!product,
        active: product?.active ?? null,
        official: officialIds.has(entry.productId),
        currentCategory: current,
        newCategory: entry.category,
        changes: current !== entry.category,
      };
    });

    const byCategory: Record<string, number> = {};
    for (const r of rows) byCategory[r.newCategory] = (byCategory[r.newCategory] ?? 0) + 1;
    // ATENÇÃO: o Convex não serializa chaves de objeto com acentos
    // ("Periféricos" como CHAVE quebra convexToJson) — sempre arrays.
    const distribution = OFFICIAL_CATEGORIES.map((c) => ({
      category: c,
      products: byCategory[c] ?? 0,
      expected: EXPECTED_DISTRIBUTION[c],
      ok: (byCategory[c] ?? 0) === EXPECTED_DISTRIBUTION[c],
    }));

    const activeProducts = products.filter((p) => p.active);
    return {
      totalClassified: rows.length,
      totalActiveProducts: activeProducts.length,
      missing: rows.filter((r) => !r.exists).map((r) => r.productId),
      nameMismatch: rows
        .filter((r) => !r.dbNameMatches)
        .map((r) => ({ productId: r.productId, expected: r.name, actual: r.dbName })),
      unclassifiedActiveProducts: activeProducts
        .filter((p) => !PRODUCT_CLASSIFICATION.some((e) => e.productId === (p._id as string)))
        .map((p) => p.name),
      withoutOfficialLot: rows.filter((r) => !r.official).map((r) => r.name),
      distribution,
      distributionOk: distribution.every((d) => d.ok),
      existingCategories: categories.map((c) => ({ name: c.name, active: c.active })),
      toCreate: OFFICIAL_CATEGORIES.filter(
        (c) =>
          !categories.some((x) => x.name === c) &&
          !CATEGORY_REUSE_BY_RENAME.some((r) => r.official === c)
      ),
      toReactivate: categories
        .filter((c) => !c.active && (OFFICIAL_CATEGORIES as readonly string[]).includes(c.name))
        .map((c) => c.name),
      toRename: CATEGORY_REUSE_BY_RENAME.map((r) => `${r.existing} → ${r.official}`),
      rows,
    };
  },
});

/**
 * Aplica a classificação oficial dos 53 produtos.
 *
 * Só cadastro: cria/reativa/renomeia as 7 categorias e atualiza
 * `products.categoryId`. Aborta sem gravar se qualquer conferência falhar.
 * O snapshot operacional (stock, stockByLocation, lotes, movimentações,
 * entradas, solicitações, fornecedores, organizações) é comparado antes/depois
 * e a operação lança erro se algo tiver mudado.
 *
 * `dryRun: true` faz apenas a prévia (nenhuma gravação).
 */
export const applyProductClassificationInternal = internalMutation({
  args: { confirm: v.string(), dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    if (args.confirm !== "CLASSIFICAR-53-PRODUTOS") {
      throw new Error('Confirmação inválida. Execute com confirm="CLASSIFICAR-53-PRODUTOS".');
    }
    const dryRun = args.dryRun === true;

    const data = await loadContext(ctx);
    const { products, categories, officialEntry, officialLots, officialIds, productById, catById } = data;
    validateMapping(data);

    const stockRows = await ctx.db.query("stock").collect();
    const sbl = await ctx.db.query("stockByLocation").collect();
    const movements = await ctx.db.query("stockMovements").collect();
    const suppliers = await ctx.db.query("suppliers").collect();
    const requests = await ctx.db.query("requests").collect();
    const orgs = await ctx.db.query("organizations").collect();

    const snapshot = {
      stockTotal: stockRows.reduce((s, r) => s + Number(r.physicalQuantity), 0),
      reservedTotal: stockRows.reduce((s, r) => s + Number(r.reservedQuantity), 0),
      stockByLocationTotal: sbl.reduce((s, r) => s + Number(r.quantity), 0),
      stockByLocationRows: sbl.length,
      movements: movements.length,
      movementsQuantityTotal: movements.reduce((s, m) => s + Number(m.quantity), 0),
      suppliers: suppliers.length,
      requests: requests.length,
      organizations: orgs.length,
    };

    // ── Plano de categorias: reusar / renomear / reativar / criar ──
    const categoryPlan: Array<{ name: OfficialCategory; categoryId: string; action: string }> = [];
    if (!dryRun) {
      for (const official of OFFICIAL_CATEGORIES) {
        const renameSource = CATEGORY_REUSE_BY_RENAME.find((r) => r.official === official);
        let existing = categories.find((c) => c.name === official);
        let action = "reutilizada (já existia ativa)";
        if (!existing && renameSource) {
          existing = categories.find((c) => c.name === renameSource.existing);
          if (existing) action = `reutilizada e renomeada (${renameSource.existing} → ${official})`;
        }
        if (!existing) {
          const id = await ctx.db.insert("categories", {
            name: official,
            description: "Categoria oficial do estoque de implantação — 15/09/2026",
            active: true,
          });
          await ctx.db.insert("auditLogs", {
            userId: undefined,
            action: "create",
            entity: "categories",
            entityId: id,
            details: `Categoria oficial "${official}" criada para a classificação do estoque de implantação`,
            timestamp: Date.now(),
          });
          categoryPlan.push({ name: official, categoryId: id as string, action: "criada" });
          continue;
        }
        const patch: Record<string, unknown> = {};
        if (existing.name !== official) patch.name = official;
        if (!existing.active) patch.active = true;
        if (Object.keys(patch).length > 0) {
          await ctx.db.patch(existing._id, patch);
          await ctx.db.insert("auditLogs", {
            userId: undefined,
            action: "update",
            entity: "categories",
            entityId: existing._id,
            details: `Categoria ${JSON.stringify(patch)} — ${official}`,
            timestamp: Date.now(),
          });
          if (patch.name) {
            action = `reutilizada e renomeada (${existing.name} → ${official})${patch.active ? " — também reativada" : ""}`;
          } else if (patch.active) {
            action = "reativada";
          }
        }
        categoryPlan.push({ name: official, categoryId: existing._id as string, action });
      }
    }

    // ── Atualização de categoryId (somente cadastro) ──
    const changes: Array<{
      productId: string;
      name: string;
      from: string | null;
      to: OfficialCategory;
    }> = [];
    if (!dryRun) {
      const planByName = new Map(categoryPlan.map((p) => [p.name as string, p.categoryId]));
      for (const entry of PRODUCT_CLASSIFICATION) {
        const product = productById.get(entry.productId)!;
        const targetCategoryId = planByName.get(entry.category)!;
        if ((product.categoryId as string) === targetCategoryId) continue;
        const previousName = catById.get(product.categoryId as string)?.name ?? null;
        await ctx.db.patch(product._id, { categoryId: targetCategoryId as Id<"categories"> });
        await ctx.db.insert("auditLogs", {
          userId: undefined,
          action: "update",
          entity: "products",
          entityId: product._id,
          details: `Alteração de categoria do produto "${product.name}": ${previousName ?? "(sem categoria)"} → ${entry.category}`,
          timestamp: Date.now(),
        });
        changes.push({
          productId: entry.productId,
          name: product.name,
          from: previousName,
          to: entry.category,
        });
      }
    }

    // ── Conferência final: estoque e histórico intocados ──
    if (!dryRun) {
      const stockAfter = await ctx.db.query("stock").collect();
      const sblAfter = await ctx.db.query("stockByLocation").collect();
      const movementsAfter = await ctx.db.query("stockMovements").collect();
      const suppliersAfter = await ctx.db.query("suppliers").collect();
      const requestsAfter = await ctx.db.query("requests").collect();
      const orgsAfter = await ctx.db.query("organizations").collect();
      const after = {
        stockTotal: stockAfter.reduce((s, r) => s + Number(r.physicalQuantity), 0),
        reservedTotal: stockAfter.reduce((s, r) => s + Number(r.reservedQuantity), 0),
        stockByLocationTotal: sblAfter.reduce((s, r) => s + Number(r.quantity), 0),
        stockByLocationRows: sblAfter.length,
        movements: movementsAfter.length,
        movementsQuantityTotal: movementsAfter.reduce((s, m) => s + Number(m.quantity), 0),
        suppliers: suppliersAfter.length,
        requests: requestsAfter.length,
        organizations: orgsAfter.length,
      };
      if (JSON.stringify(snapshot) !== JSON.stringify(after)) {
        throw new Error(
          `Operação abortada: dados operacionais mudaram. antes=${JSON.stringify(snapshot)} depois=${JSON.stringify(after)}`
        );
      }
    }

    // ── Distribuição final por categoria ──
    const finalProducts = dryRun ? products : await ctx.db.query("products").collect();
    const finalCategories = dryRun ? categories : await ctx.db.query("categories").collect();
    const finalCatById = new Map(finalCategories.map((c) => [c._id as string, c]));
    const projected: Record<string, number> = {};
    for (const entry of PRODUCT_CLASSIFICATION)
      projected[entry.category] = (projected[entry.category] ?? 0) + 1;
    const distribution = OFFICIAL_CATEGORIES.map((c) => {
      const count = dryRun
        ? projected[c] ?? 0
        : finalProducts.filter((p) => finalCatById.get(p.categoryId as string)?.name === c).length;
      return {
        category: c,
        products: count,
        expected: EXPECTED_DISTRIBUTION[c],
        ok: count === EXPECTED_DISTRIBUTION[c],
      };
    });

    const withoutCategory = finalProducts.filter((p) => !p.categoryId);
    return {
      dryRun,
      ok: true,
      classifiedProducts: PRODUCT_CLASSIFICATION.length,
      productsCreated: 0,
      productsDeleted: 0,
      categoryChanges: dryRun ? [] : changes.length,
      categoryPlan,
      distribution,
      distributionOk: distribution.every((d) => d.ok),
      operationalUnchanged: true,
      snapshot,
      productsWithoutCategory: withoutCategory.map((p) => p.name),
      productsStillInDiversos: finalProducts
        .filter((p) => finalCatById.get(p.categoryId as string)?.name === "Diversos")
        .map((p) => p.name),
      changes,
      officialEntryNumber: officialEntry!.entryNumber,
      officialEntryLots: officialLots.length,
      officialProductsCovered: officialIds.size,
    };
  },
});

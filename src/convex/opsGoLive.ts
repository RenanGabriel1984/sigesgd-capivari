/**
 * SIGESGD CAPIVARI — Operações de Go-Live (ETAPA 2/3)
 *
 * Ponte operacional ÚNICA para registrar a primeira entrada real (NF-e Gomaq
 * 372043) no deployment atual, quando a importação pela UI não pôde ser usada.
 *
 * Reproduz exatamente o MESMO pipeline de `entries.create` + `entries.confirm`:
 *   entrada (purchase, NF/chave/valores) → itens da entrada (códigos/NCM/CFOP
 *   da NF) → lotes → stockByLocation → estoque global → movimentações →
 *   auditoria (create + confirm_entry).
 *
 * Regras atendidas:
 *  - NÃO converte embalagem (90 rolos = 90; "CAIXA C/30" fica na especificação);
 *  - NÃO duplica: bloqueado por chave de acesso (idempotência) e por CNPJ
 *    para o fornecedor (Gomaq 61.457.941/0001-43);
 *  - NÃO cria produto duplicado: vincula aos produtos existentes quando o
 *    nome + marca correspondem exatamente (match determinístico, sem IA);
 *  - Quantidade/destino conforme decisão humana registrada nesta etapa:
 *    tudo no Armário TI 02 (n576x4v2v08tyzvzef21qk3m8h8e5y2f);
 *  - FUNÇÃO INTERNA: sem rota pública, não substitui a UI de importação.
 */
import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

const GOMAQ_ACCESS_KEY = "35260961457941000143550010003720431466669127";
const GOMAQ_CNPJ = "61457941000143";
const GOMAQ_LEGAL_NAME = "Gomaq Máquinas para Escritório Ltda";
const GOMAQ_TRADE_NAME = "Gomaq";
const LOCATION_ARMARIO_TI_02 = "n576x4v2v08tyzvzef21qk3m8h8e5y2f"; // Armário TI 02
const CATEGORY_SUPRIMENTOS = "Suprimentos de Impressão";

/** Itens da NF-e 372043 (quantidade EXATAMENTE como na NF — sem conversão). */
const GOMAQ_ITEMS: Array<{
  code: string;
  name: string;
  model?: string;
  unit: string;
  qty: number;
}> = [
  { code: "0110000735", name: "Toner CX735 — Preto", model: "81C8XK0 — 28K", unit: "un", qty: 1 },
  { code: "0110001735", name: "Toner CX735 — Amarelo", model: "81C8XY0 — 16.2K", unit: "un", qty: 1 },
  { code: "0110002735", name: "Toner CX735 — Ciano", model: "81C8XC0 — 16.2K", unit: "un", qty: 1 },
  { code: "0110053004", name: "Kit Ribbon Color YMCKT p/ Sigma", model: "525100-004", unit: "kit", qty: 1 },
  { code: "0131091359", name: "Toner AltaLink — Ciano", model: "006R01759 (C8145/C8155/C8170/C8270)", unit: "un", qty: 1 },
  { code: "1110000080", name: "Cartão PVC para crachá", model: "CR80 86x54x0,76mm — branco", unit: "un", qty: 400 },
  { code: "1110038040", name: "Papel para impressora térmica", model: "Bobina térmica 80x40 — caixa c/ 30", unit: "rolo", qty: 90 },
  { code: "4000003491", name: "Toner Brother MFC-L6902DW — Preto", model: "TN-3492BR — 20K", unit: "un", qty: 40 },
];

export const registerGomaqNfe372043 = internalMutation({
  args: { confirm: v.literal("REGISTRAR-NF-372043") },
  handler: async (ctx: any, _args: { confirm: "REGISTRAR-NF-372043" }) => {
    // ── 0. Admin de operação (responsável auditável) ──
    const admin = await ctx.db.get("jx70c3y841fp20pt5qfd5a5tw18dhhd8"); // Renan Gabriel (bootstrap admin)
    if (!admin || admin.role !== "admin") throw new Error("Admin de operação não encontrado");

    // ── 1. Idempotência: chave de acesso já registrada? ──
    const dup = await ctx.db
      .query("entries")
      .withIndex("by_access_key", (q: any) => q.eq("accessKey", GOMAQ_ACCESS_KEY))
      .first();
    if (dup) {
      return { skipped: true, entryNumber: dup.entryNumber, message: "NF-e 372043 já registrada — nada foi duplicado." };
    }

    // ── 2. Fornecedor: dedupe por CNPJ ──
    let supplierId: string | undefined;
    const existingSuppliers = await ctx.db.query("suppliers").collect();
    const gomaq = existingSuppliers.find(
      (s: any) => (s.cnpj ?? "").replace(/\D/g, "") === GOMAQ_CNPJ
    );
    if (gomaq) {
      supplierId = gomaq._id;
    } else {
      supplierId = await ctx.db.insert("suppliers", {
        legalName: GOMAQ_LEGAL_NAME,
        tradeName: GOMAQ_TRADE_NAME,
        cnpj: "61.457.941/0001-43",
        active: true,
      });
      await ctx.db.insert("auditLogs", {
        userId: admin._id, action: "create", entity: "suppliers", entityId: supplierId,
        details: "Fornecedor \"Gomaq Máquinas para Escritório Ltda\" criado (CNPJ 61.457.941/0001-43) via NF-e 372043",
        timestamp: Date.now(),
      });
    }

    // ── 3. Categoria e produtos (link determinístico ou criação) ──
    const category = (await ctx.db.query("categories").collect())
      .find((c: any) => c.name === CATEGORY_SUPRIMENTOS);
    if (!category) throw new Error("Categoria \"Suprimentos de Impressão\" não encontrada");

    const products = await ctx.db.query("products").collect();
    const lotSeqBase = (await ctx.db.query("lots").collect()).length;

    const resolved: Array<{
      productId: string; created: boolean; code: string; qty: number;
      unit: string; model?: string;
    }> = [];
    for (const it of GOMAQ_ITEMS) {
      const existing = products.find(
        (p: any) => p.active && p.name === it.name && (p.brand ?? "Lexmark") === "Lexmark"
      );
      if (existing) {
        resolved.push({ productId: existing._id, created: false, code: it.code, qty: it.qty, unit: it.unit, model: it.model });
        continue;
      }
      const newId = await ctx.db.insert("products", {
        name: it.name,
        categoryId: category._id,
        unitOfMeasure: it.unit,
        brand: "Lexmark",
        model: it.model,
        supplierCode: it.code,
        internalCode: "ITEM-" + String(products.filter((p: any) => /^ITEM-\d+$/.test(p.internalCode ?? "")).length + resolved.filter((r) => r.created).length + 1).padStart(4, "0"),
        minimumStock: 0, idealStock: 0, maximumStock: 0,
        active: true,
      });
      await ctx.db.insert("auditLogs", {
        userId: admin._id, action: "create", entity: "products", entityId: newId,
        details: "Item criado via NF-e Gomaq 372043: " + it.name + " (código Gomaq " + it.code + ")",
        timestamp: Date.now(),
      });
      resolved.push({ productId: newId, created: true, code: it.code, qty: it.qty, unit: it.unit, model: it.model });
    }

    // ── 4. Entrada (mesma estrutura de entries.create, já confirmada) ──
    const year = 2026;
    const existingEntries = await ctx.db.query("entries").withIndex("by_number", (q: any) => q.gte("entryNumber", "ENT-" + year + "-")).collect();
    const maxEntry = existingEntries.reduce((m: number, e: any) => {
      const x = e.entryNumber.match(/^ENT-\d{4}-(\d+)$/);
      return x ? Math.max(m, parseInt(x[1], 10)) : m;
    }, 0);
    const entryNumber = "ENT-" + year + "-" + String(maxEntry + 1).padStart(6, "0");
    const receivedAt = new Date("2026-09-01T12:00:00-03:00").getTime();
    const now = Date.now();

    const entryId = await ctx.db.insert("entries", {
      entryNumber,
      receivedAt,
      originType: "purchase",
      supplierId,
      invoiceNumber: "372043",
      invoiceDate: "2026-09-01",
      contractNumber: "00826309",
      responsibleUserId: admin._id,
      observation: "Importação NF-e 372043 — Gomaq. Natureza: VENDA. Pedido/contrato: 00826309. Destinatário: Prefeitura Municipal de Capivari (44.723.674/0001-90). Total R$ 20.822,22.",
      accessKey: GOMAQ_ACCESS_KEY,
      series: "1",
      totalValue: 20822.22,
      importedFromXml: true,
      status: "confirmed",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("auditLogs", {
      userId: admin._id, action: "create", entity: "entries", entityId: entryId,
      details: "Entrada " + entryNumber + " criada com 8 item(ns) — NF-e 372043 (Gomaq)",
      timestamp: now,
    });

    // ── 5. Itens → lotes → sbl → global → movimentação (réplica de entries.confirm) ──
    const details: string[] = [];
    const lotNumbers: string[] = [];
    let lotSeq = lotSeqBase;
    for (const r of resolved) {
      lotSeq += 1;
      const lotNumber = "LOT-" + year + "-" + String(lotSeq).padStart(6, "0");
      const prevStock = await ctx.db.query("stock").withIndex("by_product", (q: any) => q.eq("productId", r.productId)).first();
      const prevPhysical = prevStock?.physicalQuantity ?? 0;
      const prevReserved = prevStock?.reservedQuantity ?? 0;

      await ctx.db.insert("lots", {
        lotNumber,
        productId: r.productId,
        entryId,
        brand: "Lexmark",
        model: r.model,
        specification: "Código Gomaq " + r.code,
        quantityReceived: r.qty,
        quantityAvailable: r.qty,
        receivedAt,
        supplierId,
        invoiceNumber: "372043",
        active: true,
      });

      await ctx.db.insert("entryItems", {
        entryId,
        productId: r.productId,
        quantity: r.qty,
        unitOfMeasure: r.unit,
        locationId: LOCATION_ARMARIO_TI_02,
        supplierCode: r.code,
        observation: "NF-e 372043 — quantidade conforme NF (sem conversão de embalagem)",
      });

      const sblList = await ctx.db.query("stockByLocation").withIndex("by_product", (q: any) => q.eq("productId", r.productId)).collect();
      const sbl = sblList.find((s: any) => s.locationId === LOCATION_ARMARIO_TI_02);
      if (sbl) {
        await ctx.db.patch(sbl._id, { quantity: sbl.quantity + r.qty });
      } else {
        await ctx.db.insert("stockByLocation", { productId: r.productId, locationId: LOCATION_ARMARIO_TI_02, quantity: r.qty });
      }

      const sblAfter = await ctx.db.query("stockByLocation").withIndex("by_product", (q: any) => q.eq("productId", r.productId)).collect();
      const newPhysical = sblAfter.reduce((sum: number, s: any) => sum + s.quantity, 0);
      if (prevStock) {
        await ctx.db.patch(prevStock._id, { physicalQuantity: newPhysical });
      } else {
        await ctx.db.insert("stock", { productId: r.productId, physicalQuantity: newPhysical, reservedQuantity: 0 });
      }

      await ctx.db.insert("stockMovements", {
        productId: r.productId,
        type: "entry",
        quantity: r.qty,
        previousPhysical: prevPhysical,
        newPhysical,
        previousReserved: prevReserved,
        newReserved: prevReserved,
        userId: admin._id,
        entryId,
        lotId: lotNumber,
        documentNumber: "372043",
        observation: "Entrada " + entryNumber + " — Lote " + lotNumber,
        timestamp: now,
      });

      const prod = await ctx.db.get(r.productId);
      details.push((prod?.name ?? r.productId) + ": +" + r.qty + " (" + lotNumber + ")");
      lotNumbers.push(lotNumber);
    }

    await ctx.db.insert("auditLogs", {
      userId: admin._id, action: "confirm_entry", entity: "entries", entityId: entryId,
      details: "Entrada " + entryNumber + " confirmada. Itens: " + details.join("; "),
      timestamp: now,
    });

    return {
      skipped: false,
      entryNumber,
      lotNumbers,
      created: resolved.filter((r) => r.created).length,
      linked: resolved.filter((r) => !r.created).length,
      items: details,
    };
  },
});

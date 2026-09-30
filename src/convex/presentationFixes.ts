/**
 * Gestão de Estoque SGGD — CORREÇÃO CADASTRAL DE APRESENTAÇÃO (backend).
 *
 * Objetivo: a apresentação física do "Limpa contato" não é um "pote" — é um
 * SPRAY. A unidade-base permanece "un" (é assim que o item é contado) e a
 * quantidade física não muda.
 *
 * GARANTIAS:
 *  - grava UM único campo cadastral: `products.packagingUnit`;
 *  - NUNCA toca em `stock`, `stockByLocation`, `lots`, `stockMovements`,
 *    `entries`, `entryItems` nem em NF-e/DANFE/XML;
 *  - NUNCA altera `baseUnit`, `conversionFactor`, nome ou unidade do produto;
 *  - NUNCA cria movimentação — não é entrada, saída nem ajuste;
 *  - idempotente: já estando "spray", retorna sem gravar e sem auditar.
 */

import { internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  decidePresentationUnitFix,
  buildPresentationFixAuditDetail,
  LIMPA_CONTATO_PRESENTATION_FIX,
} from "../lib/presentation-units";

/** Produto "Limpa contato" (id conferido no banco). */
const LIMPA_CONTATO_ID = "kd74ssjbcjpx0rd4tezba29qsyjskqvq" as Id<"products">;

export const fixLimpaContatoPresentation = internalMutation({
  args: {},
  handler: async (ctx) => {
    const product = await ctx.db.get(LIMPA_CONTATO_ID);
    if (!product) {
      return { applied: false, reason: "Produto Limpa contato não encontrado.", audit: false };
    }

    const decision = decidePresentationUnitFix(
      {
        baseUnit: product.baseUnit ?? null,
        packagingUnit: product.packagingUnit ?? null,
        conversionFactor: product.conversionFactor ?? null,
      },
      LIMPA_CONTATO_PRESENTATION_FIX
    );
    if (!decision.shouldApply || !decision.patch) {
      return { applied: false, reason: decision.reason, audit: false };
    }

    // ÚNICA escrita: campo cadastral de APRESENTAÇÃO do produto.
    await ctx.db.patch(LIMPA_CONTATO_ID, decision.patch as never);

    await ctx.db.insert("auditLogs", {
      action: "product_packaging_update",
      entity: "products",
      entityId: LIMPA_CONTATO_ID as string,
      details: buildPresentationFixAuditDetail(product.name, decision),
      timestamp: Date.now(),
    } as never);

    return { applied: true, reason: decision.reason, audit: true };
  },
});

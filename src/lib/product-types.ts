import type { Doc } from "@/convex/_generated/dataModel";

/**
 * Tipos de exibição compartilhados pelas telas de estoque.
 *
 * As queries de Convex (products.list / listActive) retornam o produto
 * enriquecido com categoria, saldo e flag de compatibilidade; estes tipos
 * documentam esse formato para o frontend.
 */

export type ProductStock = {
  physicalQuantity: number;
  reservedQuantity: number;
};

export type ProductView = Doc<"products"> & {
  category: Doc<"categories"> | null;
  stock: ProductStock;
  hasCompat: boolean;
};

export type InitialLoadStatusView = {
  productId: string;
  loaded: boolean;
};
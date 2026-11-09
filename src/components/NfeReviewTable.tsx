/**
 * Tabela de conferência da NF-e (XML ou DANFE/OCR).
 *
 * REGRAS DESTA TELA:
 *  • `canContinueNfeReview(items)` é uma das regras de avanço — nenhum item
 *    avança sem produto associado e "found".
 *  • Um item que o OCR NÃO conseguiu identificar vira uma linha PENDENTE:
 *    campos editáveis/vazios, nunca um produto inventado. O usuário associa
 *    manualmente (ou cria o produto) antes de finalizar.
 *  • A categoria do material fica visível ao lado do produto associado.
 *  • D3: quantidade, unidade, valor unitário e total são SEMPRE editáveis —
 *    mesmo quando o OCR trouxe valores aparentemente válidos. Alterações são
 *    destacadas, o valor reconhecido fica visível, o total é recalculado e uma
 *    divergência matemática bloqueia o avanço (nunca é confirmada em silêncio).
 */
import { useState } from "react";
import type { ChangeEvent } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  formatDecimalInput,
  nfeItemRevision,
  nfeItemTotalMismatch,
  nfeReviewTotals,
  parseMoneyInput,
  parseQuantityInput,
  reconcileItemTotal,
  type NfeItemOriginalValues,
} from "@/lib/nfe-item-edit";
import {
  type NfeItem,
  type ProductAssociationType,
  type ProductForMatch,
  type ProductMatchSource,
  type ProductMatchStatus,
} from "@/lib/nfe";

export type NfeReviewProduct = ProductForMatch & {
  category?: { name: string } | null;
};

export type NfeReviewRow = {
  item: NfeItem;
  productId: string;
  matchStatus: ProductMatchStatus;
  matchScore: number;
  matchSource?: ProductMatchSource;
  matchReason?: string;
  associationType: ProductAssociationType;
  locationId?: string;
  supplierLot?: string;
  /** Valores reconhecidos no documento (comparação/destaque de alteração). */
  originalValues?: NfeItemOriginalValues;
};

export interface NfeReviewTableProps {
  items: NfeReviewRow[];
  products: NfeReviewProduct[];
  locations?: Array<{ _id: string; name: string }>;
  /** Atualiza UMA linha (associação manual, lote, local, quantidade, valores). */
  onUpdate: (index: number, patch: Partial<NfeReviewRow>) => void;
  /** Abre o cadastro de produto para a LINHA indicada (índice do item). */
  onNewProduct?: (index: number) => void;
  /** Origem dos dados lidos (XML ou DANFE/OCR) — apenas informativo. */
  sourceLabel?: string;
  /** Total da nota (valor do documento), para comparar com a soma dos itens. */
  documentTotal?: number;
}

const STATUS_LABEL: Record<ProductMatchStatus, { label: string; className: string }> = {
  found: { label: "Encontrado", className: "bg-emerald-100 text-emerald-800" },
  possible: { label: "Confirme a associação", className: "bg-amber-100 text-amber-800" },
  not_found: { label: "Pendente", className: "bg-amber-100 text-amber-800" },
};

function formatMoney(value: number | undefined | null): string {
  if (value == null || !isFinite(value)) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

/**
 * Estado de associação dos itens — regra pura testável.
 * `allAssociated` é verdadeiro SOMENTE quando existe pelo menos UM item e
 * todos estão associados: lista vazia NUNCA pode exibir
 * "Todos os itens associados" (zero itens ≠ tudo associado).
 */
export function nfeItemsAssociationState(
  items: ReadonlyArray<{ matchStatus: ProductMatchStatus }>,
): { total: number; pendingCount: number; allAssociated: boolean } {
  const total = items.length;
  const pendingCount = items.filter((row) => row.matchStatus !== "found").length;
  return { total, pendingCount, allAssociated: total > 0 && pendingCount === 0 };
}

export function NfeReviewTable({
  items,
  products,
  locations,
  onUpdate,
  onNewProduct,
  sourceLabel,
  documentTotal,
}: NfeReviewTableProps) {
  const { pendingCount, allAssociated } = nfeItemsAssociationState(items);
  const hasInvalidQuantity = items.some((row) => !(Number(row.item.quantity) > 0));
  // Texto em edição por campo — preserva "1," e valores parciais enquanto o
  // usuário digita sem sobrescrever o estado da linha a cada tecla.
  const [editing, setEditing] = useState<Record<string, string>>({});
  const totals = nfeReviewTotals(items, documentTotal);

  const fieldKey = (index: number, field: string) => `${index}:${field}`;

  const textProps = (
    index: number,
    field: string,
    current: number | undefined,
    apply: (raw: string) => void,
  ) => {
    const key = fieldKey(index, field);
    return {
      value: editing[key] ?? formatDecimalInput(current),
      onChange: (event: ChangeEvent<HTMLInputElement>) => {
        const raw = event.target.value;
        setEditing((previous) => ({ ...previous, [key]: raw }));
        apply(raw);
      },
      onBlur: () =>
        setEditing((previous) => {
          const next = { ...previous };
          delete next[key];
          return next;
        }),
    };
  };

  const changedClass = (changed: boolean) =>
    changed ? "mt-1 h-8 border-amber-400 bg-amber-50" : "mt-1 h-8";

  return (
    <div className="min-w-0 max-w-full overflow-x-hidden space-y-3">
      {/* Hierarquia: primeiro o estado geral, depois o que falta conferir. */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge className="bg-muted text-foreground">{items.length} item(ns) da NF-e</Badge>
        {/* Separadores TEXTOS entre os selos: contador, fonte e status nunca
            ficam colados no texto copiado (R31.8 §2). */}
        {sourceLabel && (
          <>
            <span aria-hidden="true">·</span>
            <Badge variant="outline">Fonte: {sourceLabel}</Badge>
          </>
        )}
        {allAssociated && (
          <>
            <span aria-hidden="true">·</span>
            <Badge className="bg-emerald-100 text-emerald-800">Todos os itens associados</Badge>
          </>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Quantidade, unidade e valores podem ser corrigidos aqui: um erro de leitura não pode
        chegar ao estoque. Campos alterados ficam destacados e mostram o valor reconhecido.
      </p>

      {items.length === 0 && (
        <div className="rounded-md border bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Nenhum item identificado na NF-e — a lista está vazia, nenhum item foi associado.
          Informe os itens na conferência antes de continuar.
        </div>
      )}

      {pendingCount > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Produto não identificado automaticamente. Faça a associação manual na conferência.
        </div>
      )}

      <div className="border rounded-lg overflow-x-hidden">
        <div className="min-w-0 max-w-full overflow-x-hidden">
          {items.map((review, index) => {
            const status = STATUS_LABEL[review.matchStatus] ?? STATUS_LABEL.not_found;
            const revision = nfeItemRevision(review.item, review.originalValues);
            const original = review.originalValues;
            const mismatch = nfeItemTotalMismatch(review.item);
            return (
              <div
                key={`${review.item.lineNumber}-${index}`}
                id={`nfe-item-${index}`}
                className="min-w-0 max-w-full overflow-hidden border-b last:border-b-0 p-3 space-y-2"
              >
                <div className="flex flex-wrap items-center gap-2 min-w-0">
                  <span className="text-xs font-mono text-muted-foreground">
                    Item {review.item.lineNumber ?? index + 1}
                  </span>
                  {review.item.code && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="text-xs font-mono text-muted-foreground">
                        cód. {review.item.code}
                      </span>
                    </>
                  )}
                  <span aria-hidden="true">·</span>
                  <Badge className={`${status.className} text-[10px]`}>{status.label}</Badge>
                  {revision.anyChanged && (
                    <>
                      <span aria-hidden="true">·</span>
                      <Badge className="bg-amber-100 text-amber-800 text-[10px]">
                        alterado na conferência
                      </Badge>
                    </>
                  )}
                  {review.matchStatus === "found" && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="text-[10px] text-muted-foreground">
                        {review.matchScore}% · {review.associationType === "manual" ? "manual" : "automática"}
                      </span>
                    </>
                  )}
                </div>

                {/* Descrição: quebra de linha, nunca invade a coluna vizinha */}
                <p className="text-sm font-medium min-w-0 max-w-full break-words">
                  {review.item.description || "Sem descrição identificada"}
                </p>

                {/* NCM e CST: colunas fiscais separadas da descrição (R30 §4). */}
                {(review.item.ncm || review.item.cst) && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    {review.item.ncm ? (
                      <span className="font-mono">NCM {review.item.ncm}</span>
                    ) : null}
                    {/* Separador texto: NCM e CST nunca ficam colados no cópia. */}
                    {review.item.ncm && review.item.cst ? (
                      <span aria-hidden="true">·</span>
                    ) : null}
                    {review.item.cst ? (
                      <span className="font-mono">CST {review.item.cst}</span>
                    ) : null}
                  </div>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {/* Quantidade — sempre editável (D3). */}
                  <div className="min-w-0 max-w-full overflow-hidden">
                    <span className="block text-[10px] uppercase text-muted-foreground">
                      Quantidade
                    </span>
                    <Input
                      type="text"
                      inputMode="decimal"
                      aria-label={`Quantidade do item ${review.item.lineNumber ?? index + 1}`}
                      className={changedClass(revision.quantityChanged)}
                      placeholder="Informe a quantidade"
                      {...textProps(index, "quantity", review.item.quantity, (raw) =>
                        onUpdate(index, {
                          item: reconcileItemTotal(review.item, {
                            quantity: parseQuantityInput(raw) ?? 0,
                          }),
                        }),
                      )}
                    />
                    {original && revision.quantityChanged && (
                      <p className="text-[10px] text-amber-700">
                        reconhecido: {original.quantity}
                      </p>
                    )}
                  </div>

                  {/* Unidade — sempre editável (D3). */}
                  <div className="min-w-0 max-w-full overflow-hidden">
                    <span className="block text-[10px] uppercase text-muted-foreground">
                      Unidade
                    </span>
                    <Input
                      type="text"
                      maxLength={12}
                      aria-label={`Unidade do item ${review.item.lineNumber ?? index + 1}`}
                      className={changedClass(revision.unitChanged)}
                      placeholder="UN"
                      value={review.item.unit ?? ""}
                      onChange={(event) =>
                        onUpdate(index, {
                          item: { ...review.item, unit: event.target.value.toUpperCase() },
                        })
                      }
                    />
                    {original && revision.unitChanged && (
                      <p className="text-[10px] text-amber-700">
                        reconhecido: {original.unit || "—"}
                      </p>
                    )}
                  </div>

                  {/* Valor unitário — sempre editável (D3). */}
                  <div className="min-w-0 max-w-full overflow-hidden">
                    <span className="block text-[10px] uppercase text-muted-foreground">
                      Valor unitário
                    </span>
                    <Input
                      type="text"
                      inputMode="decimal"
                      aria-label={`Valor unitário do item ${review.item.lineNumber ?? index + 1}`}
                      className={changedClass(revision.unitValueChanged)}
                      placeholder="0,00"
                      {...textProps(index, "unitValue", review.item.unitValue, (raw) =>
                        onUpdate(index, {
                          item: reconcileItemTotal(review.item, {
                            unitValue: parseMoneyInput(raw),
                          }),
                        }),
                      )}
                    />
                    {original && revision.unitValueChanged && (
                      <p className="text-[10px] text-amber-700">
                        reconhecido: {formatMoney(original.unitValue)}
                      </p>
                    )}
                  </div>

                  {/* Valor total — sempre editável; recalculado por qtd × unitário. */}
                  <div className="min-w-0 max-w-full overflow-hidden">
                    <span className="block text-[10px] uppercase text-muted-foreground">
                      Valor total
                    </span>
                    <Input
                      type="text"
                      inputMode="decimal"
                      aria-label={`Valor total do item ${review.item.lineNumber ?? index + 1}`}
                      className={changedClass(revision.totalValueChanged)}
                      placeholder="0,00"
                      {...textProps(index, "totalValue", review.item.totalValue, (raw) =>
                        onUpdate(index, {
                          item: reconcileItemTotal(review.item, {
                            totalValue: parseMoneyInput(raw),
                          }),
                        }),
                      )}
                    />
                    {original && revision.totalValueChanged && (
                      <p className="text-[10px] text-amber-700">
                        reconhecido: {formatMoney(original.totalValue)}
                      </p>
                    )}
                  </div>
                </div>

                {mismatch && (
                  <p className="text-[11px] text-amber-700">
                    Total não confere: {review.item.quantity} × {formatMoney(review.item.unitValue)} ={" "}
                    {formatMoney(mismatch.expected)} — informado {formatMoney(review.item.totalValue)}.
                  </p>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Local */}
                  <div className="min-w-0 max-w-full overflow-hidden">
                    <span className="block text-[10px] uppercase text-muted-foreground">
                      Local
                    </span>
                    <Select
                      value={review.locationId || "none"}
                      onValueChange={(value) =>
                        onUpdate(index, { locationId: value === "none" ? "" : value })
                      }
                    >
                      <SelectTrigger className="mt-1 h-8 w-full min-w-0">
                        <SelectValue placeholder="Opcional" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Sem local específico</SelectItem>
                        {(locations ?? []).map((location) => (
                          <SelectItem key={location._id} value={location._id}>
                            {location.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Lote do fornecedor */}
                  <div className="min-w-0 max-w-full overflow-hidden">
                    <span className="block text-[10px] uppercase text-muted-foreground">
                      Lote do fornecedor
                    </span>
                    <Input
                      className="mt-1 h-8"
                      value={review.supplierLot ?? ""}
                      placeholder="Opcional"
                      onChange={(event) => onUpdate(index, { supplierLot: event.target.value })}
                    />
                  </div>
                </div>

                {/* Associação de produto + categoria ao lado */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="min-w-0 max-w-full overflow-hidden">
                    <span className="block text-[10px] uppercase text-muted-foreground">
                      Produto associado:
                    </span>
                    <Select
                      value={review.productId || "none"}
                      onValueChange={(value) =>
                        onUpdate(index, {
                          productId: value === "none" ? "" : value,
                          matchStatus: value === "none" ? "not_found" : "found",
                          matchScore: value === "none" ? 0 : 100,
                          associationType: "manual",
                        })
                      }
                    >
                      <SelectTrigger className="mt-1 h-8 w-full min-w-0">
                        <SelectValue placeholder="Associar produto…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— Associar manualmente —</SelectItem>
                        {products.map((product) => (
                          <SelectItem key={product._id} value={product._id}>
                            {product.name}
                            {product.brand ? ` (${product.brand})` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {review.productId && (
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        <Badge variant="outline" className="text-[10px]">
                          {products.find((product) => product._id === review.productId)?.category?.name ?? "Sem categoria"}
                        </Badge>
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 max-w-full overflow-hidden flex items-end gap-2">
                    {onNewProduct && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8"
                        onClick={() => onNewProduct(index)}
                      >
                        Cadastrar novo produto
                      </Button>
                    )}
                    {review.matchReason && (
                      <span className="text-[10px] text-muted-foreground pb-1.5">
                        {review.matchReason}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {items.length > 0 && (
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
          <p className="font-medium">
            Soma dos itens: {formatMoney(totals.itemsTotal)}
            {totals.documentTotal != null ? ` · Total da nota: ${formatMoney(totals.documentTotal)}` : ""}
          </p>
          {totals.diverges && (
            <p className="mt-1 text-amber-700">
              A soma dos itens difere do total do documento em{" "}
              {formatMoney(Math.abs(totals.difference ?? 0))}. O total da nota será o valor do
              documento — confira os itens antes de confirmar.
            </p>
          )}
        </div>
      )}

      {hasInvalidQuantity && (
        <p className="text-xs text-amber-700">
          Preencha a quantidade real de todos os itens — quantidades não são inventadas.
        </p>
      )}

    </div>
  );
}

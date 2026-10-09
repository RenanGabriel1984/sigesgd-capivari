/**
 * Tabela de conferência da NF-e (XML ou DANFE/OCR).
 *
 * REGRAS DESTA TELA:
 *  • `canContinueNfeReview(items)` é a ÚNICA regra visual e funcional do
 *    avanço — nenhum item pode avançar sem produto associado e "found".
 *  • Um item que o OCR NÃO conseguiu identificar vira uma linha PENDENTE:
 *    campos editáveis/vazios, nunca um produto inventado. O usuário associa
 *    manualmente (ou cria o produto) antes de finalizar.
 *  • A categoria do material fica visível ao lado do produto associado.
 *  • Quantidades/preços vêm do documento fiscal; quando o OCR não trouxe uma
 *    quantidade válida, o campo fica VAZIO para digitação — nunca inventado.
 */
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
  canContinueNfeReview,
  type NfeItem,
  type ProductAssociationType,
  type ProductForMatch,
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
  matchSource?: string;
  matchReason?: string;
  associationType: ProductAssociationType;
  locationId?: string;
  supplierLot?: string;
};

export interface NfeReviewTableProps {
  items: NfeReviewRow[];
  products: NfeReviewProduct[];
  locations?: Array<{ _id: string; name: string }>;
  /** Atualiza UMA linha (associação manual, lote, local, quantidade pendente). */
  onUpdate: (index: number, patch: Partial<NfeReviewRow>) => void;
  /** Abre o cadastro de produto para o item pendente. */
  onNewProduct?: () => void;
  /** Avança para a próxima etapa (destino da NF-e). */
  onContinue?: () => void;
  /** Origem dos dados lidos (XML ou DANFE/OCR) — apenas informativo. */
  sourceLabel?: string;
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

export function NfeReviewTable({
  items,
  products,
  locations,
  onUpdate,
  onNewProduct,
  onContinue,
  sourceLabel,
}: NfeReviewTableProps) {
  const pendingCount = items.filter((row) => row.matchStatus !== "found").length;
  const hasInvalidQuantity = items.some((row) => !(Number(row.item.quantity) > 0));

  return (
    <div className="min-w-0 max-w-full overflow-x-hidden space-y-3">
      {/* Hierarquia: primeiro o estado geral, depois o que falta conferir. */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge className="bg-muted text-foreground">{items.length} item(ns) da NF-e</Badge>
        {sourceLabel && <Badge variant="outline">Fonte: {sourceLabel}</Badge>}
        {pendingCount === 0 && (
          <Badge className="bg-emerald-100 text-emerald-800">Todos os itens associados</Badge>
        )}
      </div>

      {pendingCount > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Produto não identificado automaticamente. Faça a associação manual na conferência.
        </div>
      )}

      <div className="border rounded-lg overflow-x-hidden">
        <div className="min-w-0 max-w-full overflow-x-hidden">
          {items.map((review, index) => {
            const status = STATUS_LABEL[review.matchStatus] ?? STATUS_LABEL.not_found;
            const quantityMissing = !(Number(review.item.quantity) > 0);
            return (
              <div
                key={`${review.item.lineNumber}-${index}`}
                className="min-w-0 max-w-full overflow-hidden border-b last:border-b-0 p-3 space-y-2"
              >
                <div className="flex flex-wrap items-center gap-2 min-w-0">
                  <span className="text-xs font-mono text-muted-foreground">
                    Item {review.item.lineNumber ?? index + 1}
                  </span>
                  {review.item.code && (
                    <span className="text-xs font-mono text-muted-foreground">
                      cód. {review.item.code}
                    </span>
                  )}
                  <Badge className={`${status.className} text-[10px]`}>{status.label}</Badge>
                  {review.matchStatus === "found" && (
                    <span className="text-[10px] text-muted-foreground">
                      {review.matchScore}% · {review.associationType === "manual" ? "manual" : "automática"}
                    </span>
                  )}
                </div>

                {/* Descrição: quebra de linha, nunca invade a coluna vizinha */}
                <p className="text-sm font-medium min-w-0 max-w-full break-words">
                  {review.item.description || "Sem descrição identificada"}
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {/* Quantidade — editável somente quando o documento não trouxe uma
                      quantidade válida (nunca inventamos o valor). */}
                  <div className="min-w-0 max-w-full overflow-hidden">
                    <span className="text-[10px] uppercase text-muted-foreground">Quantidade</span>
                    {quantityMissing ? (
                      <Input
                        type="number"
                        min="0"
                        step="any"
                        value=""
                        placeholder="Informe a quantidade"
                        className="mt-1 h-8"
                        onChange={(event) =>
                          onUpdate(index, {
                            item: { ...review.item, quantity: Number(event.target.value) || 0 },
                          })
                        }
                      />
                    ) : (
                      <p className="text-sm font-mono">
                        {review.item.quantity} {review.item.unit}
                      </p>
                    )}
                  </div>

                  <div className="min-w-0 max-w-full overflow-hidden">
                    <span className="text-[10px] uppercase text-muted-foreground">Valores</span>
                    <p className="text-sm font-mono">
                      {formatMoney(review.item.unitValue)} · total {formatMoney(review.item.totalValue)}
                    </p>
                  </div>

                  {/* Local */}
                  <div className="min-w-0 max-w-full overflow-hidden">
                    <span className="text-[10px] uppercase text-muted-foreground">Local</span>
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
                    <span className="text-[10px] uppercase text-muted-foreground">
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
                    <span className="text-[10px] uppercase text-muted-foreground">
                      Produto associado
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
                      <Button variant="outline" size="sm" className="h-8" onClick={onNewProduct}>
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

      {hasInvalidQuantity && (
        <p className="text-xs text-amber-700">
          Preencha a quantidade real de todos os itens — quantidades não são inventadas.
        </p>
      )}

      {onContinue && (
        <div className="flex justify-end">
          <Button disabled={!canContinueNfeReview(items)} onClick={onContinue}>
            Continuar conferência
          </Button>
        </div>
      )}
    </div>
  );
}

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus } from "lucide-react";
import { canContinueNfeReview, type NfeItem, type ProductAssociationType, type ProductMatchSource, type ProductMatchStatus } from "@/lib/nfe";

export type NfeReviewItem = { item: NfeItem; productId: string; matchStatus: ProductMatchStatus; matchScore: number; matchSource?: ProductMatchSource; matchReason?: string; associationType: ProductAssociationType; locationId: string; supplierLot: string };

export function NfeReviewTable({ items, products, onManualSelect, onConfirmSuggestion, onNewProduct, onBack, onContinue }: {
  items: NfeReviewItem[];
  products: any[];
  onManualSelect: (index: number, productId: string) => void;
  onConfirmSuggestion: (index: number) => void;
  onNewProduct: (index: number) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const badge = (review: NfeReviewItem) => {
    if (review.associationType === "created") return <Badge className="text-[10px] bg-blue-50 text-blue-700 border-blue-200">Produto criado — seleção explícita</Badge>;
    if (review.associationType === "manual") return <Badge className="text-[10px] bg-violet-50 text-violet-700 border-violet-200">Associação manual</Badge>;
    if (review.matchStatus === "found") return <Badge className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">🟢 Encontrado automaticamente{review.matchSource === "supplier_alias" ? " (memorizado)" : ""}</Badge>;
    if (review.matchStatus === "possible") return <Badge className="text-[10px] bg-amber-50 text-amber-700 border-amber-200">🟡 Possível correspondência — confirmar</Badge>;
    return <Badge className="text-[10px] bg-rose-50 text-rose-700 border-rose-200">🔴 Não encontrado</Badge>;
  };
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex shrink-0 flex-wrap gap-2 text-xs">
      <Badge className="text-[10px] bg-emerald-50 text-emerald-700">🟢 {items.filter((item) => item.matchStatus === "found" && item.associationType === "automatic").length} encontrados</Badge>
      <Badge className="text-[10px] bg-amber-50 text-amber-700">🟡 {items.filter((item) => item.matchStatus === "possible").length} possíveis</Badge>
      <Badge className="text-[10px] bg-rose-50 text-rose-700">🔴 {items.filter((item) => !item.productId || item.matchStatus === "not_found").length} não encontrados</Badge>
      {items.some((item) => item.associationType !== "automatic") && <Badge className="text-[10px] bg-violet-50 text-violet-700">{items.filter((item) => item.associationType !== "automatic").length} revisados manualmente</Badge>}
    </div>
    <div className="mt-3 min-h-0 flex-1 overflow-auto rounded-lg border">
      <Table className="min-w-[760px]"><TableHeader className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm"><TableRow><TableHead className="text-xs">#</TableHead><TableHead className="text-xs">Produto da NF</TableHead><TableHead className="text-xs text-center">Qtd</TableHead><TableHead className="text-xs">Unid.</TableHead><TableHead className="text-xs">Situação</TableHead><TableHead className="text-xs">Produto no estoque</TableHead></TableRow></TableHeader>
        <TableBody>{items.map((review, index) => <TableRow key={index} className={!review.productId ? "bg-rose-50/40" : ""}>
          <TableCell className="text-xs text-muted-foreground">{review.item.lineNumber}</TableCell>
          <TableCell className="text-xs max-w-[220px]"><p className="font-medium leading-tight">{review.item.description}</p><p className="text-[10px] text-muted-foreground font-mono">{review.item.code}{review.item.ncm ? ` · NCM ${review.item.ncm}` : ""}{review.item.cfop ? ` · CFOP ${review.item.cfop}` : ""}</p></TableCell>
          <TableCell className="text-center font-mono text-sm">{review.item.quantity}</TableCell>
          <TableCell className="text-xs">{review.item.unit}</TableCell>
          <TableCell>{badge(review)}{review.matchReason && <p className="text-[9px] text-muted-foreground mt-1 max-w-[150px]">{review.matchReason}{review.matchScore ? ` (${review.matchScore}%)` : ""}</p>}</TableCell>
          <TableCell className="min-w-[220px]"><div className="flex items-center gap-1">
            {review.productId && <Badge variant="secondary" className="hidden sm:inline-flex text-[9px] shrink-0 max-w-[96px] whitespace-normal app-break">{products.find((product) => product._id === review.productId)?.category?.name}</Badge>}
            <Select value={review.productId} onValueChange={(value) => onManualSelect(index, value)}><SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Selecionar" /></SelectTrigger><SelectContent>{products.map((product) => <SelectItem key={product._id} value={product._id}>{product.name}{product.brand ? ` (${product.brand})` : ""}</SelectItem>)}</SelectContent></Select>
            <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" title="Cadastrar produto" onClick={() => onNewProduct(index)}><Plus className="h-3.5 w-3.5" /></Button>
          </div>{review.matchStatus === "possible" && review.productId && <Button size="sm" variant="outline" className="mt-1 h-6 w-full text-[10px]" onClick={() => onConfirmSuggestion(index)}>Confirmar correspondência</Button>}</TableCell>
        </TableRow>)}</TableBody>
      </Table>
    </div>
    <div className="flex shrink-0 items-center justify-between gap-3 pt-2"><Button variant="outline" onClick={onBack}>Voltar</Button><div className="text-right"><Button disabled={!canContinueNfeReview(items)} onClick={onContinue}>Continuar → Localização</Button><p className="text-[9px] text-muted-foreground mt-1">Desabilitado enquanto houver item sem produto ou sugestão possível não confirmada.</p></div></div>
  </div>;
}

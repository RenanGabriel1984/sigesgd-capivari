import { useParams, Link, useNavigate } from "react-router";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { FileUpload } from "@/components/FileUpload";
import { ArrowLeft, Package, Tag, BarChart3, Clock, User, Boxes, MapPin, Layers, Info } from "lucide-react";
import { MOVEMENT_TYPE_LABELS, MOVEMENT_TYPE_COLORS, type MovementType, UNIT_LABELS } from "@/types/constants";
import { getStockSituation, STOCK_SITUATION_LABELS, STOCK_SITUATION_BADGE_CLASSES } from "@/lib/stock-status";

const ORIGIN_LABELS: Record<string, string> = {
  purchase: "Compra",
  donation: "Doação",
  transfer: "Transferência",
  return: "Devolução",
  initial_inventory: "Inventário Inicial",
  gomaq: "Gomaq",
  other: "Outro",
};

type ProductDetailView = Doc<"products"> & {
  category: Doc<"categories"> | null;
  stock: { physicalQuantity: number; reservedQuantity: number };
  recentMovements: Array<Doc<"stockMovements"> & { user: Doc<"users"> | null }>;
  lots: Array<Doc<"lots"> & { entry: Doc<"entries"> | null; supplier: Doc<"suppliers"> | null }>;
  locations: Array<{ location: Doc<"storageLocations"> | null; quantity: number }>;
};

export default function ProductDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const product = useQuery(api.products.getById, id ? { id: id as any } : "skip") as ProductDetailView | null | undefined;

  if (product === undefined) {
    return (<AppShell><div className="max-w-5xl mx-auto"><div className="animate-pulse space-y-4"><div className="h-8 w-48 bg-muted rounded" /><div className="h-64 bg-muted rounded-lg" /></div></div></AppShell>);
  }

  if (product === null) {
    return (
      <AppShell>
        <div className="max-w-5xl mx-auto text-center py-20">
          <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold mb-2">Item não encontrado</h2>
          <p className="text-muted-foreground mb-6">O item que você procura não existe ou foi removido.</p>
          <Button asChild><Link to="/products">Voltar ao Catálogo</Link></Button>
        </div>
      </AppShell>
    );
  }

  const stock = product.stock;
  const physical = stock.physicalQuantity;
  const reserved = stock.reservedQuantity;
  const available = Math.max(physical - reserved, 0);
  const maxStock = product.maximumStock || 100;
  const stockPercentage = Math.min(100, (physical / maxStock) * 100);
  const situation = getStockSituation(physical, product.minimumStock, product.idealStock);
  const isLow = situation === "critical" || situation === "below_min";
  const locationTotal = (product.locations ?? []).reduce((sum, l) => sum + l.quantity, 0);

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto space-y-6">
        <Button variant="ghost" size="sm" className="gap-1.5 -ml-1" onClick={() => navigate("/products")}>
          <ArrowLeft className="h-4 w-4" /> Voltar ao Catálogo
        </Button>

        <div className="flex flex-col sm:flex-row sm:items-start gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-start gap-3">
              <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0"><Package className="h-7 w-7" /></div>
              <div className="min-w-0">
                <h1 className="text-2xl font-bold tracking-tight truncate">{product.name}</h1>
                <div className="flex flex-wrap items-center gap-2 mt-1.5">
                  {product.category && <Badge variant="secondary" className="text-xs"><Tag className="h-3 w-3 mr-1" />{product.category.name}</Badge>}
                  <Badge variant={product.active ? "default" : "secondary"} className="text-[10px]">{product.active ? "Ativo" : "Inativo"}</Badge>
                  <Badge className={`text-[10px] ${STOCK_SITUATION_BADGE_CLASSES[situation]}`}>
                    {STOCK_SITUATION_LABELS[situation]}
                  </Badge>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          <Info className="h-4 w-4 mt-0.5 shrink-0" />
          <p>O estoque atual é calculado pelas movimentações e não é editado diretamente no cadastro do produto.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="border-border/50"><CardContent className="p-5">
            <div className="flex items-center gap-3 mb-3"><div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600"><Boxes className="h-4.5 w-4.5" /></div><span className="text-sm font-medium text-muted-foreground">Estoque Atual</span></div>
            <p className="text-3xl font-bold">{physical}</p><p className="text-xs text-muted-foreground mt-1">de {maxStock} máximo</p><Progress value={stockPercentage} className="h-1.5 mt-3" />
          </CardContent></Card>
          <Card className="border-border/50"><CardContent className="p-5">
            <div className="flex items-center gap-3 mb-3"><div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-50 text-amber-600"><Clock className="h-4.5 w-4.5" /></div><span className="text-sm font-medium text-muted-foreground">Reservado</span></div>
            <p className="text-3xl font-bold">{reserved}</p><p className="text-xs text-muted-foreground mt-1">comprometido em solicitações aprovadas</p>
          </CardContent></Card>
          <Card className="border-border/50"><CardContent className="p-5">
            <div className="flex items-center gap-3 mb-3"><div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600"><BarChart3 className="h-4.5 w-4.5" /></div><span className="text-sm font-medium text-muted-foreground">Disponível</span></div>
            <p className="text-3xl font-bold">{available}</p><p className="text-xs text-muted-foreground mt-1">pronto para novas solicitações</p>
          </CardContent></Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="border-border/50"><CardHeader className="pb-3"><CardTitle className="text-base">Parâmetros de Controle</CardTitle></CardHeader><CardContent>
            <dl className="space-y-3">
              <div className="flex items-center justify-between"><dt className="text-sm text-muted-foreground">Estoque mínimo</dt><dd className="text-sm font-semibold">{product.minimumStock} {UNIT_LABELS[product.unitOfMeasure] ?? product.unitOfMeasure}</dd></div>
              <div className="flex items-center justify-between"><dt className="text-sm text-muted-foreground">Estoque ideal</dt><dd className="text-sm font-semibold">{product.idealStock} {UNIT_LABELS[product.unitOfMeasure] ?? product.unitOfMeasure}</dd></div>
              <div className="flex items-center justify-between"><dt className="text-sm text-muted-foreground">Estoque máximo</dt><dd className="text-sm font-semibold">{product.maximumStock} {UNIT_LABELS[product.unitOfMeasure] ?? product.unitOfMeasure}</dd></div>
              <p className="text-xs text-muted-foreground pt-1 border-t border-border/50">
                Níveis de alerta e planejamento — não alteram o saldo.
              </p>
            </dl>
          </CardContent></Card>
          <Card className="border-border/50"><CardHeader className="pb-3"><CardTitle className="text-base">Dados Cadastrais</CardTitle></CardHeader><CardContent>
            <dl className="space-y-3">
              {product.description && <div><dt className="text-xs text-muted-foreground">Descrição</dt><dd className="text-sm mt-0.5">{product.description}</dd></div>}
              <div className="grid grid-cols-2 gap-4"><div><dt className="text-xs text-muted-foreground">Código Interno</dt><dd className="text-sm font-mono mt-0.5">{product.internalCode || "—"}</dd></div><div><dt className="text-xs text-muted-foreground">Unidade</dt><dd className="text-sm mt-0.5">{UNIT_LABELS[product.unitOfMeasure] ?? product.unitOfMeasure}</dd></div></div>
              <div className="grid grid-cols-2 gap-4"><div><dt className="text-xs text-muted-foreground">Fabricante</dt><dd className="text-sm mt-0.5">{product.manufacturer || "—"}</dd></div><div><dt className="text-xs text-muted-foreground">Marca</dt><dd className="text-sm mt-0.5">{product.brand || "—"}</dd></div></div>
              <div className="grid grid-cols-2 gap-4"><div><dt className="text-xs text-muted-foreground">Modelo</dt><dd className="text-sm mt-0.5">{product.model || "—"}</dd></div><div><dt className="text-xs text-muted-foreground">Nº de série / patrimônio</dt><dd className="text-sm mt-0.5">{product.hasSerial ? "Sim" : "Não"}</dd></div></div>
              {product.specification && <div><dt className="text-xs text-muted-foreground">Especificação</dt><dd className="text-sm mt-0.5">{product.specification}</dd></div>}
              {product.observation && <div><dt className="text-xs text-muted-foreground">Observações</dt><dd className="text-sm mt-0.5">{product.observation}</dd></div>}
              {product.photo && (
                <div><dt className="text-xs text-muted-foreground mb-1">Foto</dt><FileUpload storageId={product.photo} onUpload={() => {}} disabled /></div>
              )}
            </dl>
          </CardContent></Card>
        </div>

        <Card className="border-border/50"><CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><MapPin className="h-4 w-4 text-primary" /> Localizações</CardTitle></CardHeader><CardContent>
          {(product.locations ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum saldo registrado em localizações.</p>
          ) : (
            <div className="space-y-2">
              {(product.locations ?? []).map((l, idx) => (
                <div key={idx} className="flex items-center justify-between border rounded-lg px-3 py-2 text-sm">
                  <span className="font-medium">{l.location?.name ?? "Local removido"}</span>
                  <span className="font-mono font-semibold">{l.quantity}</span>
                </div>
              ))}
              <p className="text-xs text-muted-foreground pt-1">
                Total nas localizações: <span className="font-mono font-semibold">{locationTotal}</span> — o saldo global ({physical}) é a soma dos locais.
              </p>
            </div>
          )}
        </CardContent></Card>

        <Card className="border-border/50"><CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Layers className="h-4 w-4 text-primary" /> Lotes (Rastreabilidade)</CardTitle></CardHeader><CardContent>
          {(product.lots ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum lote registrado para este item.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b border-border/50">
                    <th className="py-2 pr-3 font-medium">Lote</th>
                    <th className="py-2 pr-3 font-medium">Lote do fornecedor</th>
                    <th className="py-2 pr-3 font-medium text-center">Disponível</th>
                    <th className="py-2 pr-3 font-medium">Origem</th>
                    <th className="py-2 pr-3 font-medium">Fornecedor</th>
                    <th className="py-2 pr-3 font-medium">NF</th>
                    <th className="py-2 pr-3 font-medium">Data</th>
                    <th className="py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(product.lots ?? []).map((l) => (
                    <tr key={l._id} className="border-b border-border/30 last:border-0">
                      <td className="py-2 pr-3 font-mono text-xs">{l.lotNumber}</td>
                      <td className="py-2 pr-3 text-xs">{l.supplierLotNumber ?? "—"}</td>
                      <td className="py-2 pr-3 text-center font-mono">{l.quantityAvailable} / {l.quantityReceived}</td>
                      <td className="py-2 pr-3 text-xs">{l.entry ? `${ORIGIN_LABELS[l.entry.originType] ?? l.entry.originType}${l.entry.entryNumber ? ` (${l.entry.entryNumber})` : ""}` : "—"}</td>
                      <td className="py-2 pr-3 text-xs">{l.supplier?.legalName ?? "—"}</td>
                      <td className="py-2 pr-3 text-xs font-mono">{l.invoiceNumber ?? "—"}</td>
                      <td className="py-2 pr-3 text-xs">{new Date(l.receivedAt).toLocaleDateString("pt-BR")}</td>
                      <td className="py-2">
                        {l.active ? (
                          <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-200 bg-emerald-50">Ativo</Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[10px]">Inativo</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent></Card>

        {product.recentMovements && product.recentMovements.length > 0 && (
          <Card className="border-border/50"><CardHeader className="pb-3"><CardTitle className="text-base">Atividade Recente</CardTitle></CardHeader><CardContent>
            <div className="space-y-3">
              {product.recentMovements.map((m) => (
                <div key={m._id} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted shrink-0"><User className="h-4 w-4 text-muted-foreground" /></div>
                    <div className="min-w-0"><p className="text-sm font-medium truncate">{m.user?.name ?? "Sistema"}</p><p className="text-xs text-muted-foreground">{new Date(m.timestamp).toLocaleString("pt-BR")}</p></div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-3">
                    <Badge variant="secondary" className={MOVEMENT_TYPE_COLORS[m.type as MovementType]}>{MOVEMENT_TYPE_LABELS[m.type as MovementType]}</Badge>
                    <span className="font-mono text-sm font-semibold">{m.type === "entry" || m.type === "return" ? "+" : m.type === "exit" ? "-" : ""}{m.quantity}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent></Card>
        )}
      </div>
    </AppShell>
  );
}
import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Search, Warehouse } from "lucide-react";

export default function Stock() {
  const products = useQuery(api.products.list);
  const [search, setSearch] = useState("");
  const filtered = products?.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()) || p.internalCode?.toLowerCase().includes(search.toLowerCase()));
  const getStockStatus = (physical: number, min: number, ideal: number) => {
    if (physical < min) return { label: "Baixo", color: "destructive" as const };
    if (physical <= ideal) return { label: "Adequado", color: "secondary" as const };
    return { label: "Bom", color: "default" as const };
  };

  return (
    <AppShell>
      <div className="space-y-6 max-w-7xl mx-auto">
        <div><h1 className="text-2xl font-bold tracking-tight">Estoque</h1><p className="text-sm text-muted-foreground">Visão geral do estoque de produtos</p></div>
        <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input placeholder="Buscar produto..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 max-w-md" /></div>
        <Card className="border-border/50"><CardContent className="p-0"><div className="overflow-x-auto"><Table>
          <TableHeader><TableRow><TableHead>Produto</TableHead><TableHead>Categoria</TableHead><TableHead className="text-center">Físico</TableHead><TableHead className="text-center">Reservado</TableHead><TableHead className="text-center">Disponível</TableHead><TableHead>Nível</TableHead><TableHead className="w-[120px]">Status</TableHead></TableRow></TableHeader>
          <TableBody>
            {filtered?.map((p) => { const physical = p.stock?.physicalQuantity ?? 0; const reserved = p.stock?.reservedQuantity ?? 0; const available = physical - reserved; const status = getStockStatus(physical, p.minimumStock, p.idealStock); const percentage = p.maximumStock > 0 ? Math.min(100, (physical / p.maximumStock) * 100) : 0;
              return (<TableRow key={p._id}><TableCell><div><p className="font-medium">{p.name}</p><p className="text-xs text-muted-foreground">{p.manufacturer} {p.model}</p></div></TableCell><TableCell><Badge variant="secondary" className="text-xs">{p.category?.name ?? "—"}</Badge></TableCell><TableCell className="text-center font-mono font-semibold">{physical}</TableCell><TableCell className="text-center font-mono text-amber-600">{reserved}</TableCell><TableCell className="text-center font-mono">{available}</TableCell><TableCell className="text-center text-xs text-muted-foreground">{p.minimumStock} / {p.idealStock} / {p.maximumStock}</TableCell><TableCell><div className="flex items-center gap-2"><Progress value={percentage} className="h-1.5 flex-1" /><Badge variant={status.color} className="text-[10px] shrink-0">{status.label}</Badge></div></TableCell></TableRow>);
            })}
            {filtered?.length === 0 && (<TableRow><TableCell colSpan={7} className="text-center py-12"><Warehouse className="h-8 w-8 mx-auto text-muted-foreground mb-2" /><p className="text-muted-foreground">Nenhum produto em estoque</p></TableCell></TableRow>)}
          </TableBody>
        </Table></div></CardContent></Card>
      </div>
    </AppShell>
  );
}

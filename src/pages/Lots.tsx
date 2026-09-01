import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Boxes, Search } from "lucide-react";

export default function Lots() {
  const lots = useQuery(api.lots.list);
  const [search, setSearch] = useState("");

  const filtered = lots?.filter((l) => {
    const term = search.toLowerCase();
    return (
      l.lotNumber.toLowerCase().includes(term) ||
      l.product?.name.toLowerCase().includes(term) ||
      l.product?.internalCode?.toLowerCase().includes(term) ||
      l.supplier?.legalName?.toLowerCase().includes(term) ||
      l.invoiceNumber?.toLowerCase().includes(term) ||
      l.brand?.toLowerCase().includes(term) ||
      l.model?.toLowerCase().includes(term)
    );
  });

  const activeLots = filtered?.filter((l) => l.active) ?? [];
  const inactiveLots = filtered?.filter((l) => !l.active) ?? [];

  return (
    <AppShell>
      <div className="space-y-6 max-w-7xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Lotes</h1>
          <p className="text-sm text-muted-foreground">
            Rastreabilidade de lotes de entrada — {lots?.length ?? 0} lote(s) total
          </p>
        </div>

        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por lote, produto, fornecedor, NF, marca..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {lots?.length === 0 ? (
          <Card className="border-border/50">
            <CardContent className="py-16 text-center">
              <Boxes className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-muted-foreground">Nenhum lote registrado</p>
              <p className="text-xs text-muted-foreground mt-1">Lotes são criados automaticamente ao confirmar uma entrada</p>
            </CardContent>
          </Card>
        ) : (
          <>
            {activeLots.length > 0 && (
              <Card className="border-border/50">
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Lote</TableHead>
                          <TableHead className="text-xs">Produto</TableHead>
                          <TableHead className="text-xs">Marca / Modelo</TableHead>
                          <TableHead className="text-xs text-center">Recebido</TableHead>
                          <TableHead className="text-xs text-center">Disponível</TableHead>
                          <TableHead className="text-xs">Custo Unit.</TableHead>
                          <TableHead className="text-xs">Fornecedor</TableHead>
                          <TableHead className="text-xs">NF</TableHead>
                          <TableHead className="text-xs">Data</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {activeLots.map((l) => (
                          <TableRow key={l._id}>
                            <TableCell>
                              <Badge variant="outline" className="text-[10px] font-mono">{l.lotNumber}</Badge>
                            </TableCell>
                            <TableCell>
                              <div>
                                <p className="font-medium text-sm">{l.product?.name ?? "—"}</p>
                                <p className="text-[10px] text-muted-foreground">{l.product?.internalCode ?? ""}</p>
                              </div>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {l.brand ?? "—"} {l.model ? `/ ${l.model}` : ""}
                            </TableCell>
                            <TableCell className="text-center font-mono text-sm">{l.quantityReceived}</TableCell>
                            <TableCell className="text-center">
                              <span className={`font-mono text-sm ${l.quantityAvailable === 0 ? "text-muted-foreground line-through" : "text-emerald-600 font-semibold"}`}>
                                {l.quantityAvailable}
                              </span>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {l.unitCost != null ? `R$ ${l.unitCost.toFixed(2)}` : "—"}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground max-w-[150px] truncate">
                              {l.supplier?.legalName ?? "—"}
                            </TableCell>
                            <TableCell className="text-xs font-mono text-muted-foreground">
                              {l.invoiceNumber ?? "—"}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                              {new Date(l.receivedAt).toLocaleDateString("pt-BR")}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}

            {inactiveLots.length > 0 && (
              <details className="group">
                <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground transition-colors">
                  Lotes inativos / estornados ({inactiveLots.length})
                </summary>
                <Card className="border-border/50 mt-2">
                  <CardContent className="p-0 opacity-60">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">Lote</TableHead>
                            <TableHead className="text-xs">Produto</TableHead>
                            <TableHead className="text-xs text-center">Recebido</TableHead>
                            <TableHead className="text-xs text-center">Disponível</TableHead>
                            <TableHead className="text-xs">Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {inactiveLots.map((l) => (
                            <TableRow key={l._id}>
                              <TableCell>
                                <Badge variant="secondary" className="text-[10px] font-mono line-through">{l.lotNumber}</Badge>
                              </TableCell>
                              <TableCell className="text-sm">{l.product?.name ?? "—"}</TableCell>
                              <TableCell className="text-center font-mono text-sm">{l.quantityReceived}</TableCell>
                              <TableCell className="text-center font-mono text-sm line-through text-muted-foreground">{l.quantityAvailable}</TableCell>
                              <TableCell>
                                <Badge variant="destructive" className="text-[10px]">Inativo</Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              </details>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

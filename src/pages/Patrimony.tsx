import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ClipboardCheck, Search, Tag } from "lucide-react";
import { toast } from "sonner";

type PendingPatrimony = {
  _id: string;
  entryNumber: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  receivedAt: number;
  supplierName?: string | null;
  productName: string;
  serialNumber?: string;
  manufacturer?: string;
  model?: string;
  createdAt: number;
};

type AssetType =
  | "desktop" | "notebook" | "monitor" | "server" | "printer" | "switch"
  | "router" | "access_point" | "ups" | "storage" | "phone" | "other";

const ASSET_TYPES: Array<{ value: AssetType; label: string }> = [
  { value: "desktop", label: "Computador desktop" },
  { value: "notebook", label: "Notebook" },
  { value: "monitor", label: "Monitor" },
  { value: "server", label: "Servidor" },
  { value: "printer", label: "Impressora" },
  { value: "switch", label: "Switch" },
  { value: "router", label: "Roteador" },
  { value: "access_point", label: "Ponto de acesso" },
  { value: "ups", label: "Nobreak" },
  { value: "storage", label: "Armazenamento" },
  { value: "phone", label: "Telefonia" },
  { value: "other", label: "Outro" },
];

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat("pt-BR").format(new Date(timestamp));
}

export default function PatrimonyPage() {
  const pending = useQuery(api.entries.listPendingPatrimony, {}) as PendingPatrimony[] | undefined;
  const assignPatrimony = useMutation(api.entries.assignPatrimony);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<PendingPatrimony | null>(null);
  const [number, setNumber] = useState("");
  const [assetType, setAssetType] = useState<AssetType>("desktop");
  const [saving, setSaving] = useState(false);

  const rows = (pending ?? []).filter((unit) => {
    const q = search.trim().toLocaleLowerCase("pt-BR");
    if (!q) return true;
    return [
      unit.productName, unit.entryNumber, unit.invoiceNumber ?? "",
      unit.supplierName ?? "", unit.serialNumber ?? "", unit.manufacturer ?? "",
      unit.model ?? "",
    ].some((value) => value.toLocaleLowerCase("pt-BR").includes(q));
  });

  const openAssignment = (unit: PendingPatrimony) => {
    setSelected(unit);
    setNumber("");
    const text = `${unit.productName} ${unit.model ?? ""}`.toLocaleLowerCase("pt-BR");
    setAssetType(text.includes("notebook") ? "notebook" : text.includes("monitor") ? "monitor" : text.includes("impressora") ? "printer" : "desktop");
  };

  const handleAssign = async () => {
    if (!selected) return;
    if (!number.trim()) {
      toast.error("Informe o número oficial de patrimônio.");
      return;
    }
    setSaving(true);
    try {
      await assignPatrimony({
        entryItemUnitId: selected._id as never,
        patrimonyNumber: number.trim(),
        assetType,
      });
      toast.success("Tombamento registrado e equipamento vinculado ao recebimento.");
      setSelected(null);
      setNumber("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível atribuir o patrimônio.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <ClipboardCheck className="h-6 w-6 text-primary" />
              <h1 className="text-2xl font-semibold">Pendências de tombamento patrimonial</h1>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Equipamentos recebidos pelo TI que aguardam o número oficial do setor de Patrimônio.
            </p>
          </div>
          <Badge variant="outline" className="w-fit">
            {pending?.length ?? "—"} pendente(s)
          </Badge>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Unidades aguardando tombamento</CardTitle>
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" placeholder="Buscar produto, entrada, NF, fornecedor ou série..." />
            </div>
          </CardHeader>
          <CardContent>
            {pending === undefined ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Carregando pendências…</p>
            ) : rows.length === 0 ? (
              <div className="py-12 text-center">
                <Tag className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
                <p className="font-medium">{pending.length === 0 ? "Nenhuma pendência de tombamento" : "Nenhum resultado encontrado"}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {pending.length === 0 ? "As novas unidades de material permanente aparecerão aqui após a confirmação da entrada." : "Altere o termo de busca."}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Equipamento</TableHead>
                      <TableHead>Entrada / Nota fiscal</TableHead>
                      <TableHead>Fornecedor</TableHead>
                      <TableHead>Recebimento</TableHead>
                      <TableHead>Série</TableHead>
                      <TableHead className="text-right">Ação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((unit) => (
                      <TableRow key={unit._id}>
                        <TableCell>
                          <div className="font-medium">{unit.productName}</div>
                          <div className="text-xs text-muted-foreground">{[unit.manufacturer, unit.model].filter(Boolean).join(" · ") || "Dados técnicos não informados"}</div>
                        </TableCell>
                        <TableCell>
                          <div>{unit.entryNumber}</div>
                          <div className="text-xs text-muted-foreground">NF {unit.invoiceNumber || "não informada"}</div>
                        </TableCell>
                        <TableCell>{unit.supplierName || "—"}</TableCell>
                        <TableCell>{formatDate(unit.receivedAt)}</TableCell>
                        <TableCell>{unit.serialNumber || "—"}</TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" onClick={() => openAssignment(unit)}>Atribuir patrimônio</Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!selected} onOpenChange={(open) => { if (!open && !saving) setSelected(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Atribuir número patrimonial</DialogTitle>
            <DialogDescription>
              {selected?.productName} · Entrada {selected?.entryNumber}. Esta operação cria ou vincula o cadastro do equipamento sem alterar o saldo da entrada.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="patrimony-number">Número oficial de patrimônio</Label>
              <Input id="patrimony-number" value={number} onChange={(event) => setNumber(event.target.value)} placeholder="Informe o tombamento" maxLength={80} autoFocus />
            </div>
            <div className="space-y-2">
              <Label>Tipo de equipamento</Label>
              <Select value={assetType} onValueChange={(value) => setAssetType(value as AssetType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ASSET_TYPES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelected(null)} disabled={saving}>Cancelar</Button>
            <Button onClick={() => void handleAssign()} disabled={saving || !number.trim()}>
              {saving ? "Registrando..." : "Registrar tombamento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

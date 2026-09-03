import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Plus, Key, Eye, EyeOff, Link, Unlink } from "lucide-react";
import { toast } from "sonner";
import type { Id } from "@/convex/_generated/dataModel";

const LICENSE_TYPE_LABELS: Record<string, string> = {
  oem: "OEM", volume: "Volume", retail: "Varejo",
  subscription: "Assinatura", trial: "Avaliação", other: "Outro",
};

export default function LicensesPage() {
  const [showNew, setShowNew] = useState(false);
  const [showDetail, setShowDetail] = useState<any>(null);
  const [showAssign, setShowAssign] = useState<any>(null);
  const [filter, setFilter] = useState("");

  const licenses = useQuery(api.licenses.list, {});
  const createLicense = useMutation(api.licenses.create);
  const assignLicense = useMutation(api.licenses.assignToAsset);
  const removeAssignment = useMutation(api.licenses.removeFromAsset);
  const assets = useQuery(api.assets.list, {});

  const [form, setForm] = useState({
    productName: "", edition: "", licenseType: "oem", key: "", quantity: 1,
    expirationDate: "", supplier: "", invoiceNumber: "", observation: "",
  });
  const [assignAssetId, setAssignAssetId] = useState("");

  const filtered = (licenses ?? []).filter((l: any) =>
    !filter || l.productName.toLowerCase().includes(filter.toLowerCase())
  );

  const handleCreate = async () => {
    if (!form.productName) { toast.error("Nome do produto é obrigatório"); return; }
    if (form.quantity <= 0) { toast.error("Quantidade deve ser maior que zero"); return; }
    try {
      await createLicense({
        productName: form.productName,
        edition: form.edition || undefined,
        licenseType: form.licenseType,
        key: form.key || undefined,
        quantity: form.quantity,
        expirationDate: form.expirationDate || undefined,
        supplier: form.supplier || undefined,
        invoiceNumber: form.invoiceNumber || undefined,
        observation: form.observation || undefined,
      });
      toast.success("Licença criada com sucesso");
      setShowNew(false);
      setForm({ productName: "", edition: "", licenseType: "oem", key: "", quantity: 1, expirationDate: "", supplier: "", invoiceNumber: "", observation: "" });
    } catch (e: any) { toast.error(e.message); }
  };

  const handleAssign = async () => {
    if (!showAssign || !assignAssetId) { toast.error("Selecione um equipamento"); return; }
    try {
      await assignLicense({
        licenseId: showAssign._id as Id<"licenses">,
        assetId: assignAssetId as Id<"assets">,
      });
      toast.success("Licença vinculada com sucesso");
      setShowAssign(null); setAssignAssetId("");
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl tracking-tight font-bold">Licenças de Software</h1>
            <p className="text-sm text-muted-foreground">Controle de licenças e vinculação a equipamentos</p>
          </div>
          <Button onClick={() => setShowNew(true)} className="gap-2"><Plus className="h-4 w-4" /> Nova Licença</Button>
        </div>

        <Card>
          <CardContent className="pt-6 space-y-4">
            <Input placeholder="Filtrar por produto..." value={filter} onChange={(e) => setFilter(e.target.value)} />

            {!licenses ? <p className="text-muted-foreground">Carregando...</p> : filtered.length === 0 ? (
              <p className="text-muted-foreground">Nenhuma licença encontrada</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Produto</TableHead>
                      <TableHead>Edição</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Chave</TableHead>
                      <TableHead>Qtd</TableHead>
                      <TableHead>Atribuídas</TableHead>
                      <TableHead>Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((l: any) => (
                      <TableRow key={l._id}>
                        <TableCell className="text-sm font-medium">{l.productName}</TableCell>
                        <TableCell className="text-sm">{l.edition ?? "—"}</TableCell>
                        <TableCell className="text-sm">{LICENSE_TYPE_LABELS[l.licenseType] ?? l.licenseType}</TableCell>
                        <TableCell className="text-xs font-mono">{l.key ?? "—"}</TableCell>
                        <TableCell>{l.quantity}</TableCell>
                        <TableCell>{l.quantity}</TableCell>
                        <TableCell>
                          <Button variant="ghost" size="sm" className="gap-1" onClick={() => { setShowAssign(l); }}>
                            <Link className="h-3 w-3" /> Vincular
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* New License Dialog */}
        <Dialog open={showNew} onOpenChange={setShowNew}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle className="flex items-center gap-2"><Key className="h-5 w-5" /> Nova Licença</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div><Label>Produto *</Label><Input className="mt-1" value={form.productName} onChange={(e) => setForm({ ...form, productName: e.target.value })} placeholder="Ex: Windows 11 Pro" /></div>
              <div><Label>Edição / Versão</Label><Input className="mt-1" value={form.edition} onChange={(e) => setForm({ ...form, edition: e.target.value })} placeholder="Ex: 23H2" /></div>
              <div>
                <Label>Tipo</Label>
                <select className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.licenseType} onChange={(e) => setForm({ ...form, licenseType: e.target.value })}>
                  {Object.entries(LICENSE_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div><Label>Chave de Licença</Label><Input className="mt-1 font-mono" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="XXXX-XXXX-XXXX-XXXX" /></div>
              <div><Label>Quantidade</Label><Input type="number" min={1} className="mt-1" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} /></div>
              <div><Label>Data de Expiração</Label><Input type="date" className="mt-1" value={form.expirationDate} onChange={(e) => setForm({ ...form, expirationDate: e.target.value })} /></div>
              <div><Label>Fornecedor</Label><Input className="mt-1" value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} /></div>
              <div><Label>NF / AF</Label><Input className="mt-1" value={form.invoiceNumber} onChange={(e) => setForm({ ...form, invoiceNumber: e.target.value })} /></div>
              <div><Label>Observação</Label><Textarea className="mt-1" value={form.observation} onChange={(e) => setForm({ ...form, observation: e.target.value })} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowNew(false)}>Cancelar</Button>
              <Button onClick={handleCreate}>Criar Licença</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Assign Dialog */}
        <Dialog open={!!showAssign} onOpenChange={() => setShowAssign(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle className="flex items-center gap-2"><Link className="h-5 w-5" /> Vincular Licença a Equipamento</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Licença: <span className="font-medium">{showAssign?.productName}</span> — {showAssign?.quantity} licença(s) disponível(is)
              </p>
              <div>
                <Label>Equipamento</Label>
                <select className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={assignAssetId} onChange={(e) => setAssignAssetId(e.target.value)}>
                  <option value="">Selecione...</option>
                  {(assets ?? []).filter((a: any) => a.active).map((a: any) => (
                    <option key={a._id} value={a._id}>{a.patrimonyNumber ?? a.serialNumber ?? a._id} — {a.manufacturer} {a.model}</option>
                  ))}
                </select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAssign(null)}>Cancelar</Button>
              <Button onClick={handleAssign}>Vincular</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}

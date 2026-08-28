import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, ShoppingCart } from "lucide-react";
import { toast } from "sonner";

export default function Entries() {
  const products = useQuery(api.products.listActive);
  const suppliers = useQuery(api.suppliers.listActive);
  const movements = useQuery(api.stockMovements.list);
  const createEntry = useMutation(api.stockMovements.createEntry);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [supplierId, setSupplierId] = useState("");
  const [documentNumber, setDocumentNumber] = useState("");
  const [observation, setObservation] = useState("");

  const recentEntries = movements?.filter((m) => m.type === "entry").slice(0, 50) ?? [];

  const handleSave = async () => {
    if (!productId || quantity <= 0) {
      toast.error("Selecione um produto e quantidade válida");
      return;
    }
    try {
      await createEntry({
        productId: productId as any,
        quantity,
        supplierId: supplierId ? (supplierId as any) : undefined,
        documentNumber: documentNumber || undefined,
        observation: observation || undefined,
      });
      toast.success("Entrada registrada com sucesso");
      setDialogOpen(false);
      setProductId("");
      setQuantity(1);
      setSupplierId("");
      setDocumentNumber("");
      setObservation("");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao registrar entrada");
    }
  };

  return (
    <AppShell>
      <div className="space-y-6 max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Entradas</h1>
            <p className="text-sm text-muted-foreground">Registrar entradas de estoque</p>
          </div>
          <Button onClick={() => setDialogOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            Nova Entrada
          </Button>
        </div>

        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Últimas Entradas</CardTitle>
          </CardHeader>
          <CardContent>
            {recentEntries.length === 0 ? (
              <div className="text-center py-8">
                <ShoppingCart className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-muted-foreground text-sm">Nenhuma entrada registrada</p>
              </div>
            ) : (
              <div className="space-y-3">
                {recentEntries.map((m) => (
                  <div key={m._id} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
                    <div>
                      <p className="font-medium text-sm">{m.product?.name ?? "Produto"}</p>
                      <p className="text-xs text-muted-foreground">
                        {m.user?.name ?? "Usuário"}
                        {m.supplier ? ` • ${m.supplier.legalName}` : ""}
                        {m.documentNumber ? ` • Doc: ${m.documentNumber}` : ""}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono font-semibold text-emerald-600">+{m.quantity}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {new Date(m.timestamp).toLocaleDateString("pt-BR")}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nova Entrada</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Produto *</Label>
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger><SelectValue placeholder="Selecionar produto" /></SelectTrigger>
                <SelectContent>
                  {products?.map((p) => (
                    <SelectItem key={p._id} value={p._id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Quantidade *</Label>
              <Input type="number" min="1" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} />
            </div>
            <div>
              <Label>Fornecedor</Label>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger><SelectValue placeholder="Nenhum" /></SelectTrigger>
                <SelectContent>
                  {suppliers?.map((s) => (
                    <SelectItem key={s._id} value={s._id}>{s.legalName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Número do Documento</Label>
              <Input value={documentNumber} onChange={(e) => setDocumentNumber(e.target.value)} placeholder="NF, OS, etc." />
            </div>
            <div>
              <Label>Observação</Label>
              <Textarea value={observation} onChange={(e) => setObservation(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave}>Registrar Entrada</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

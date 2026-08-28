import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
import { Plus, Pencil, Building2, ChevronRight, ChevronDown } from "lucide-react";
import { ORG_TYPE_LABELS, type OrgType } from "@/types/constants";
import { toast } from "sonner";

interface OrgForm {
  name: string;
  type: OrgType | "";
  parentId: string;
  observation: string;
  startDate: string;
  endDate: string;
}

const emptyForm: OrgForm = { name: "", type: "", parentId: "", observation: "", startDate: "", endDate: "" };

function OrgTreeNode({
  org,
  children: childOrgs,
  allOrgs,
  onEdit,
  level = 0,
}: {
  org: any;
  children: any[];
  allOrgs: any[];
  onEdit: (org: any) => void;
  level?: number;
}) {
  const [expanded, setExpanded] = useState(level < 1);
  const grandchildren = allOrgs.filter((o) => o.parentId === org._id);

  return (
    <div>
      <div
        className="flex items-center gap-2 py-2 px-3 rounded-lg hover:bg-muted/50 transition-colors group"
        style={{ paddingLeft: `${level * 24 + 12}px` }}
      >
        {grandchildren.length > 0 ? (
          <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => setExpanded(!expanded)}>
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </Button>
        ) : (
          <div className="w-6 shrink-0" />
        )}
        <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium truncate">{org.name}</span>
          <Badge variant="secondary" className="ml-2 text-[10px]">
            {ORG_TYPE_LABELS[org.type as OrgType]}
          </Badge>
        </div>
        <Badge variant={org.active ? "default" : "secondary"} className="text-[10px] shrink-0">
          {org.active ? "Ativo" : "Inativo"}
        </Badge>
        <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100 shrink-0" onClick={() => onEdit(org)}>
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      </div>
      {expanded && grandchildren.map((child) => (
        <OrgTreeNode
          key={child._id}
          org={child}
          children={[]}
          allOrgs={allOrgs}
          onEdit={onEdit}
          level={level + 1}
        />
      ))}
    </div>
  );
}

export default function Organization() {
  const orgData = useQuery(api.organizations.list);
  const createOrg = useMutation(api.organizations.create);
  const updateOrg = useMutation(api.organizations.update);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<OrgForm>(emptyForm);

  const rootOrgs = orgData?.orgs.filter((o) => !o.parentId) ?? [];

  const openCreate = (parentId?: string) => {
    setForm({ ...emptyForm, parentId: parentId ?? "" });
    setEditingId(null);
    setDialogOpen(true);
  };

  const openEdit = (org: any) => {
    setForm({
      name: org.name,
      type: org.type,
      parentId: org.parentId ?? "",
      observation: org.observation ?? "",
      startDate: org.startDate ?? "",
      endDate: org.endDate ?? "",
    });
    setEditingId(org._id);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.type) { toast.error("Nome e tipo são obrigatórios"); return; }
    try {
      const data = {
        name: form.name,
        type: form.type as OrgType,
        parentId: (form.parentId || undefined) as any,
        observation: form.observation || undefined,
        startDate: form.startDate || undefined,
        endDate: form.endDate || undefined,
      };
      if (editingId) {
        await updateOrg({ id: editingId as any, ...data });
        toast.success("Unidade atualizada");
      } else {
        await createOrg(data);
        toast.success("Unidade criada");
      }
      setDialogOpen(false);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar");
    }
  };

  return (
    <AppShell>
      <div className="space-y-6 max-w-5xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Organização</h1>
            <p className="text-sm text-muted-foreground">Estrutura organizacional hierárquica</p>
          </div>
          <Button onClick={() => openCreate()} className="gap-2">
            <Plus className="h-4 w-4" />
            Nova Unidade
          </Button>
        </div>

        <Card className="border-border/50">
          <CardContent className="p-2">
            {rootOrgs.length === 0 ? (
              <div className="text-center py-12">
                <Building2 className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-muted-foreground">Nenhuma unidade organizacional cadastrada</p>
              </div>
            ) : (
              rootOrgs.map((org) => (
                <OrgTreeNode
                  key={org._id}
                  org={org}
                  children={[]}
                  allOrgs={orgData?.orgs ?? []}
                  onEdit={openEdit}
                />
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Editar Unidade" : "Nova Unidade"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Nome *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <Label>Tipo *</Label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as OrgType })}>
                <SelectTrigger><SelectValue placeholder="Selecionar tipo" /></SelectTrigger>
                <SelectContent>
                  {Object.entries(ORG_TYPE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Unidade Superior</Label>
              <Select value={form.parentId} onValueChange={(v) => setForm({ ...form, parentId: v })}>
                <SelectTrigger><SelectValue placeholder="Nenhuma (raiz)" /></SelectTrigger>
                <SelectContent>
                  {orgData?.orgs.filter((o) => o._id !== editingId).map((o) => (
                    <SelectItem key={o._id} value={o._id}>{o.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Data Início</Label>
                <Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
              </div>
              <div>
                <Label>Data Término</Label>
                <Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>Observações</Label>
              <Textarea value={form.observation} onChange={(e) => setForm({ ...form, observation: e.target.value })} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave}>{editingId ? "Salvar" : "Criar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

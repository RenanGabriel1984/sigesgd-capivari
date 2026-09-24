import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { PATRIMONY_STATUS_LABELS, PATRIMONY_STATUS_VALUES, validateEntryUnits, type PatrimonyUnitDraft } from "@/lib/material-types";

export function PatrimonyUnitsEditor({ items, itemIds, unitsByItem, products, locations, organizations, saving, onChange, onSave }: {
  items: Array<{ productId: string; quantity: string }>;
  itemIds: string[];
  unitsByItem: Record<string, PatrimonyUnitDraft[]>;
  products: any[];
  locations: any[];
  organizations: any[];
  saving: boolean;
  onChange: (itemId: string, units: PatrimonyUnitDraft[]) => void;
  onSave: () => void;
}) {
  return <div className="border-t pt-3 space-y-3">
    <div className="flex items-center justify-between gap-2">
      <Label className="text-sm font-medium">Unidades patrimoniais</Label>
      <Button size="sm" variant="outline" onClick={onSave} disabled={saving}>{saving ? "Salvando..." : "Salvar Unidades"}</Button>
    </div>
    <p className="text-xs text-muted-foreground">Produto → Unidade patrimonial → Patrimônio/Serial. Uma unidade por quantidade recebida. Valores contábeis são apenas registrados, nunca calculados.</p>
    {items.map((item, idx) => {
      const itemId = itemIds[idx];
      if (!itemId || itemId.startsWith("temp_")) return null;
      const units = unitsByItem[itemId] ?? [];
      const qty = Number(item.quantity) || 0;
      const product = products.find((candidate) => candidate._id === item.productId);
      const unitError = units.length > 0 || qty > 0 ? validateEntryUnits({ materialType: "permanent", quantity: qty, units, productName: product?.name }) : null;
      const update = (unitIndex: number, patch: Partial<PatrimonyUnitDraft>) => onChange(itemId, units.map((unit, i) => i === unitIndex ? { ...unit, ...patch } : unit));
      const orgsOfType = (type: string) => organizations.filter((org) => org.type === type && org.active !== false);
      return <div key={itemId} className="border rounded-lg p-3 bg-background space-y-2">
        <div className="flex items-center justify-between"><p className="text-xs font-medium">{product?.name ?? "Produto"} — quantidade: {qty} · unidades: {units.length}</p>
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => onChange(itemId, [...units, { patrimonyNumber: "", serialNumber: "", manufacturer: "", model: "", acquisitionDate: "", incorporationDate: "", acquisitionValue: "", accountingValue: "", residualValue: "", accumulatedDepreciation: "", netBookValue: "", locationId: "", secretariaId: "", departamentoId: "", unidadeId: "", responsibleDestiny: "", patrimonyStatus: "in_stock", observation: "" }])} disabled={units.length >= qty}><Plus className="h-3 w-3 mr-1" /> Unidade</Button>
        </div>
        {unitError && units.length !== qty && <p className="text-[11px] text-amber-700">{unitError}</p>}
        {units.map((unit, unitIndex) => <div key={unitIndex} className="rounded-md border p-2 space-y-2">
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 items-end">
            <div><Label className="text-[10px]">Patrimônio *</Label><Input value={unit.patrimonyNumber ?? ""} onChange={(e) => update(unitIndex, { patrimonyNumber: e.target.value })} className="h-7 text-xs" /></div>
            <div><Label className="text-[10px]">Série</Label><Input value={unit.serialNumber ?? ""} onChange={(e) => update(unitIndex, { serialNumber: e.target.value })} className="h-7 text-xs" /></div>
            <div><Label className="text-[10px]">Fabricante</Label><Input value={unit.manufacturer ?? ""} onChange={(e) => update(unitIndex, { manufacturer: e.target.value })} className="h-7 text-xs" /></div>
            <div><Label className="text-[10px]">Modelo</Label><Input value={unit.model ?? ""} onChange={(e) => update(unitIndex, { model: e.target.value })} className="h-7 text-xs" /></div>
            <div><Label className="text-[10px]">Aquisição</Label><Input type="date" value={unit.acquisitionDate ?? ""} onChange={(e) => update(unitIndex, { acquisitionDate: e.target.value })} className="h-7 text-xs" /></div>
            <div><Label className="text-[10px]">Tombamento</Label><Input type="date" value={unit.incorporationDate ?? ""} onChange={(e) => update(unitIndex, { incorporationDate: e.target.value })} className="h-7 text-xs" /></div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {([['acquisitionValue', 'Valor aquisição'], ['accountingValue', 'Valor contábil'], ['residualValue', 'Valor residual'], ['accumulatedDepreciation', 'Depreciação acumulada'], ['netBookValue', 'Valor líquido']] as const).map(([field, label]) => <div key={field}><Label className="text-[10px]">{label}</Label><Input type="number" step="0.01" min="0" value={unit[field] ?? ""} onChange={(e) => update(unitIndex, { [field]: e.target.value })} className="h-7 text-xs" /></div>)}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div><Label className="text-[10px]">Secretaria</Label><Select value={unit.secretariaId ?? ""} onValueChange={(value) => update(unitIndex, { secretariaId: value })}><SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Opcional" /></SelectTrigger><SelectContent>{orgsOfType('secretaria').map((org) => <SelectItem key={org._id} value={org._id}>{org.name}</SelectItem>)}</SelectContent></Select></div>
            <div><Label className="text-[10px]">Departamento</Label><Select value={unit.departamentoId ?? ""} onValueChange={(value) => update(unitIndex, { departamentoId: value })}><SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Opcional" /></SelectTrigger><SelectContent>{orgsOfType('departamento').map((org) => <SelectItem key={org._id} value={org._id}>{org.name}</SelectItem>)}</SelectContent></Select></div>
            <div><Label className="text-[10px]">Unidade</Label><Select value={unit.unidadeId ?? ""} onValueChange={(value) => update(unitIndex, { unidadeId: value })}><SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Opcional" /></SelectTrigger><SelectContent>{orgsOfType('unidade').map((org) => <SelectItem key={org._id} value={org._id}>{org.name}</SelectItem>)}</SelectContent></Select></div>
            <div><Label className="text-[10px]">Situação</Label><Select value={unit.patrimonyStatus ?? 'in_stock'} onValueChange={(value) => update(unitIndex, { patrimonyStatus: value as PatrimonyUnitDraft['patrimonyStatus'] })}><SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger><SelectContent>{PATRIMONY_STATUS_VALUES.map((status) => <SelectItem key={status} value={status}>{PATRIMONY_STATUS_LABELS[status]}</SelectItem>)}</SelectContent></Select></div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
            <div><Label className="text-[10px]">Localização</Label><Select value={unit.locationId ?? ""} onValueChange={(value) => update(unitIndex, { locationId: value })}><SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Opcional" /></SelectTrigger><SelectContent>{locations.map((location) => <SelectItem key={location._id} value={location._id}>{location.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="col-span-2"><Label className="text-[10px]">Responsável/destino</Label><Input value={unit.responsibleDestiny ?? ""} onChange={(e) => update(unitIndex, { responsibleDestiny: e.target.value })} className="h-7 text-xs" /></div>
            <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => onChange(itemId, units.filter((_, i) => i !== unitIndex))}><Trash2 className="h-3 w-3 text-destructive" /></Button>
          </div>
          <Input value={unit.observation ?? ""} onChange={(e) => update(unitIndex, { observation: e.target.value })} className="h-7 text-xs" placeholder="Observação (opcional)" />
        </div>)}
      </div>;
    })}
  </div>;
}

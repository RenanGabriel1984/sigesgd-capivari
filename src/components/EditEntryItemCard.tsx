import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2 } from "lucide-react";
import { FileUpload } from "@/components/FileUpload";
import { UNITS_OF_MEASURE, UNIT_LABELS } from "@/types/constants";

export function EditEntryItemCard({ index, item, products, locations, onUpdate, onRemove }: {
  index: number;
  item: any;
  products: any[];
  locations: any[];
  onUpdate: (index: number, field: any, value: string) => void;
  onRemove: (index: number) => Promise<void>;
}) {
  if (!item) return null;
  return <div className="border rounded-lg p-3 mb-2 space-y-2 bg-muted/30">
    <div className="flex items-center justify-between"><span className="text-xs font-medium text-muted-foreground">Item {index + 1}</span><Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => void onRemove(index)}><Trash2 className="h-3 w-3 text-destructive" /></Button></div>
    <div className="grid grid-cols-4 gap-2">
      <div className="col-span-2"><Label className="text-xs">Produto *</Label><Select value={item.productId} onValueChange={(value) => onUpdate(index, 'productId', value)}><SelectTrigger className="mt-1 h-8"><SelectValue placeholder="Selecionar" /></SelectTrigger><SelectContent>{products.map((product) => <SelectItem key={product._id} value={product._id}>{product.name} {product.brand ? `(${product.brand})` : ""}</SelectItem>)}</SelectContent></Select></div>
      <div><Label className="text-xs">Qtd *</Label><Input type="number" min="1" value={item.quantity} onChange={(event) => onUpdate(index, 'quantity', event.target.value)} className="mt-1 h-8" /></div>
      <div><Label className="text-xs">UM</Label><Select value={item.unitOfMeasure} onValueChange={(value) => onUpdate(index, 'unitOfMeasure', value)}><SelectTrigger className="mt-1 h-8"><SelectValue /></SelectTrigger><SelectContent>{UNITS_OF_MEASURE.map((unit) => <SelectItem key={unit} value={unit}>{UNIT_LABELS[unit] ?? unit}</SelectItem>)}</SelectContent></Select></div>
    </div>
    <div className="grid grid-cols-4 gap-2">
      <div><Label className="text-xs">Marca</Label><Input value={item.brand} onChange={(event) => onUpdate(index, 'brand', event.target.value)} className="mt-1 h-8" /></div>
      <div><Label className="text-xs">Modelo</Label><Input value={item.model} onChange={(event) => onUpdate(index, 'model', event.target.value)} className="mt-1 h-8" /></div>
      <div><Label className="text-xs">Custo Unit.</Label><Input type="number" step="0.01" min="0" value={item.unitCost} onChange={(event) => onUpdate(index, 'unitCost', event.target.value)} placeholder="R$" className="mt-1 h-8" /></div>
      <div><Label className="text-xs">Local</Label><Select value={item.locationId} onValueChange={(value) => onUpdate(index, 'locationId', value)}><SelectTrigger className="mt-1 h-8"><SelectValue placeholder="Opcional" /></SelectTrigger><SelectContent>{locations.map((location) => <SelectItem key={location._id} value={location._id}>{location.name}</SelectItem>)}</SelectContent></Select></div>
    </div>
    <div><Label className="text-xs">Especificação</Label><Input value={item.specification} onChange={(event) => onUpdate(index, 'specification', event.target.value)} className="mt-1 h-8" /></div>
    <div><Label className="text-xs">Observação</Label><Input value={item.observation} onChange={(event) => onUpdate(index, 'observation', event.target.value)} className="mt-1 h-8" /></div>
    <div><Label className="text-xs">Foto do Item</Label><FileUpload storageId={item.photoStorageId} onUpload={(id) => onUpdate(index, 'photoStorageId', id)} onRemove={() => onUpdate(index, 'photoStorageId', '')} size="sm" label="Foto do item recebido" /></div>
  </div>;
}

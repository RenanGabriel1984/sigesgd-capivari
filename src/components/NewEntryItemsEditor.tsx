import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ExternalLink, Plus, Trash2 } from "lucide-react";
import { FileUpload } from "@/components/FileUpload";
import { UNITS_OF_MEASURE, UNIT_LABELS } from "@/types/constants";

export function NewEntryItemsEditor({ items, products, locations, onUpdateItem, onAddItem, onRemoveItem, onNewProduct }: {
  items: any[];
  products: any[];
  locations: any[];
  onUpdateItem: (index: number, field: any, value: string) => void;
  onAddItem: () => void;
  onRemoveItem: (index: number) => void;
  onNewProduct: () => void;
}) {
  return <div className="border-t pt-4">
    <div className="flex items-center justify-between mb-2"><Label className="text-sm font-medium">Itens da Entrada *</Label><Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs gap-1 text-primary" onClick={onNewProduct}><ExternalLink className="h-3 w-3" /> Novo Item</Button></div>
    {items.map((item, index) => <div key={index} className="border rounded-lg p-3 mb-2 space-y-2 bg-muted/30">
      <div className="flex items-center justify-between"><span className="text-xs font-medium text-muted-foreground">Item {index + 1}</span>{items.length > 1 && <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onRemoveItem(index)}><Trash2 className="h-3 w-3 text-destructive" /></Button>}</div>
      <div className="grid grid-cols-4 gap-2">
        <div className="col-span-2"><Label className="text-xs">Produto *</Label><Select value={item.productId} onValueChange={(value) => onUpdateItem(index, 'productId', value)}><SelectTrigger className="mt-1 h-8"><SelectValue placeholder="Selecionar" /></SelectTrigger><SelectContent>{products.map((product) => <SelectItem key={product._id} value={product._id}>{product.name} {product.brand ? `(${product.brand})` : ""}</SelectItem>)}</SelectContent></Select></div>
        <div><Label className="text-xs">Quantidade *</Label><Input type="number" min="1" value={item.quantity} onChange={(event) => onUpdateItem(index, 'quantity', event.target.value)} className="mt-1 h-8" /></div>
        <div><Label className="text-xs">Unidade</Label><Select value={item.unitOfMeasure} onValueChange={(value) => onUpdateItem(index, 'unitOfMeasure', value)}><SelectTrigger className="mt-1 h-8"><SelectValue /></SelectTrigger><SelectContent>{UNITS_OF_MEASURE.map((unit) => <SelectItem key={unit} value={unit}>{UNIT_LABELS[unit] ?? unit}</SelectItem>)}</SelectContent></Select></div>
      </div>
      <div className="grid grid-cols-4 gap-2">
        <div><Label className="text-xs">Marca</Label><Input value={item.brand} onChange={(event) => onUpdateItem(index, 'brand', event.target.value)} className="mt-1 h-8" /></div>
        <div><Label className="text-xs">Modelo</Label><Input value={item.model} onChange={(event) => onUpdateItem(index, 'model', event.target.value)} className="mt-1 h-8" /></div>
        <div><Label className="text-xs">Custo Unit.</Label><Input type="number" step="0.01" min="0" value={item.unitCost} onChange={(event) => onUpdateItem(index, 'unitCost', event.target.value)} placeholder="R$" className="mt-1 h-8" /></div>
        <div><Label className="text-xs">Local</Label><Select value={item.locationId} onValueChange={(value) => onUpdateItem(index, 'locationId', value)}><SelectTrigger className="mt-1 h-8"><SelectValue placeholder="Opcional" /></SelectTrigger><SelectContent>{locations.map((location) => <SelectItem key={location._id} value={location._id}>{location.name}</SelectItem>)}</SelectContent></Select></div>
      </div>
      <div className="grid grid-cols-2 gap-2"><div><Label className="text-xs">Lote do Fornecedor</Label><Input value={item.supplierLotNumber} onChange={(event) => onUpdateItem(index, 'supplierLotNumber', event.target.value)} className="mt-1 h-8" /></div><div><Label className="text-xs">Especificação</Label><Input value={item.specification} onChange={(event) => onUpdateItem(index, 'specification', event.target.value)} className="mt-1 h-8" /></div></div>
      <div><Label className="text-xs">Foto do Item</Label><FileUpload storageId={item.photoStorageId} onUpload={(id) => onUpdateItem(index, 'photoStorageId', id)} onRemove={() => onUpdateItem(index, 'photoStorageId', '')} size="sm" label="Foto do item recebido" /></div>
    </div>)}
    <Button variant="outline" size="sm" className="gap-1 mt-2" onClick={onAddItem}><Plus className="h-3 w-3" /> Adicionar Item</Button>
  </div>;
}

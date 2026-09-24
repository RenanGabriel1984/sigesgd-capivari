import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileUpload } from "@/components/FileUpload";
import { MATERIAL_TYPE_LABELS, PATRIMONY_STATUS_LABELS, type MaterialType, type PatrimonyStatus } from "@/lib/material-types";
import { NO_AREA_LABEL } from "@/lib/stock-areas";

export function EntryDetailsDialog({ entry, statusLabels, statusColors, originLabels, onClose }: {
  entry: any;
  statusLabels: Record<string, string>;
  statusColors: Record<string, string>;
  originLabels: Record<string, string>;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!entry} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{entry?.entryNumber ?? "Entrada"}</DialogTitle></DialogHeader>
        {entry && <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div><span className="text-muted-foreground">Status:</span> <Badge className={`text-[10px] ${statusColors[entry.status]}`}>{statusLabels[entry.status]}</Badge></div>
            <div><span className="text-muted-foreground">Origem:</span> {originLabels[entry.originType]}</div>
            <div><span className="text-muted-foreground">Tipo de material:</span> {MATERIAL_TYPE_LABELS[(entry.materialType ?? "consumption") as MaterialType]}</div>
            <div><span className="text-muted-foreground">Área/Subestoque:</span> {entry.area?.name ?? NO_AREA_LABEL}</div>
            <div><span className="text-muted-foreground">Recebido:</span> {new Date(entry.receivedAt).toLocaleDateString("pt-BR")}</div>
            <div><span className="text-muted-foreground">Responsável:</span> {entry.responsible?.name ?? "—"}</div>
            {entry.supplier && <div><span className="text-muted-foreground">Fornecedor:</span> {entry.supplier.legalName}</div>}
            {entry.invoiceNumber && <div><span className="text-muted-foreground">NF:</span> {entry.invoiceNumber}</div>}
            {entry.invoiceDate && <div><span className="text-muted-foreground">Data NF:</span> {entry.invoiceDate}</div>}
            {entry.series && <div><span className="text-muted-foreground">Série:</span> {entry.series}</div>}
            {entry.totalValue != null && <div><span className="text-muted-foreground">Valor total NF:</span> R$ {entry.totalValue.toFixed(2)}</div>}
            {entry.accessKey && <div className="col-span-2"><span className="text-muted-foreground">Chave de acesso:</span> <span className="font-mono text-xs break-all">{entry.accessKey}</span></div>}
            {entry.purchaseAuthorizationNumber && <div><span className="text-muted-foreground">AF:</span> {entry.purchaseAuthorizationNumber}</div>}
            {entry.processNumber && <div><span className="text-muted-foreground">Processo:</span> {entry.processNumber}</div>}
            {entry.contractNumber && <div><span className="text-muted-foreground">Contrato:</span> {entry.contractNumber}</div>}
          </div>
          {entry.observation && <div className="text-sm"><span className="text-muted-foreground">Observação:</span> {entry.observation}</div>}
          {(entry.documentStorageId || entry.xmlStorageId) && <div className="rounded-lg border p-3 space-y-2">
            <h4 className="font-medium text-sm">Documentos da NF-e</h4>
            {entry.xmlStorageId && <div className="flex flex-wrap items-center gap-2"><span className="text-xs text-muted-foreground">XML da NF-e</span><FileUpload storageId={entry.xmlStorageId} onUpload={() => {}} size="sm" label="XML original da NF-e" disabled /></div>}
            {entry.documentStorageId && <div className="flex flex-wrap items-center gap-2"><span className="text-xs text-muted-foreground">DANFE PDF / documento da entrada</span><FileUpload storageId={entry.documentStorageId} onUpload={() => {}} size="sm" label="DANFE PDF" disabled /></div>}
          </div>}
          <div>
            <h4 className="font-medium text-sm mb-2">Itens da Entrada</h4>
            <div className="border rounded-lg overflow-x-auto"><Table><TableHeader><TableRow><TableHead className="text-xs">Produto</TableHead><TableHead className="text-xs text-center">Qtd</TableHead><TableHead className="text-xs">UM</TableHead><TableHead className="text-xs">Associação NF-e</TableHead><TableHead className="text-xs">Marca/Modelo</TableHead><TableHead className="text-xs">Local</TableHead></TableRow></TableHeader>
              <TableBody>{entry.items?.map((item: any) => <TableRow key={item._id}>
                <TableCell className="text-sm font-medium">{item.product?.name ?? "—"}</TableCell>
                <TableCell className="text-center font-mono">{item.quantity}</TableCell>
                <TableCell className="text-xs">{item.unitOfMeasure}</TableCell>
                <TableCell className="text-[10px] text-muted-foreground">{item.associationType === "manual" ? "Manual" : item.associationType === "created" ? "Produto criado" : item.matchSource ?? "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{item.brand ?? "—"} {item.model ? `/ ${item.model}` : ""}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{item.location?.name ?? "—"}</TableCell>
              </TableRow>)}</TableBody></Table>
            </div>
          </div>
          {entry.lots?.length > 0 && <div><h4 className="font-medium text-sm mb-2">Lotes Gerados</h4><div className="flex flex-wrap gap-2">{entry.lots.map((lot: any) => <Badge key={lot._id} variant={lot.active ? "default" : "secondary"} className="text-[10px] font-mono">{lot.lotNumber} — {lot.quantityAvailable}/{lot.quantityReceived} disp.</Badge>)}</div></div>}
          {entry.items?.some((item: any) => (item.units?.length ?? 0) > 0) && <div>
            <h4 className="font-medium text-sm mb-2">Unidades patrimoniais</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{entry.items.flatMap((item: any) => (item.units ?? []).map((unit: any) => <div key={unit._id} className="rounded-md border p-3 text-xs space-y-1">
              <p className="font-medium">{item.product?.name ?? "—"}</p>
              <p className="font-mono">Patrimônio: {unit.patrimonyNumber ?? "—"} · Série: {unit.serialNumber ?? "—"}</p>
              <p>{unit.manufacturer ?? "—"} {unit.model ?? ""}</p>
              <p>Aquisição: {unit.acquisitionDate ?? "—"} · Tombamento: {unit.incorporationDate ?? "—"}</p>
              <p>Valor aquisição: {unit.acquisitionValue ?? "—"} · Contábil: {unit.accountingValue ?? "—"} · Residual: {unit.residualValue ?? "—"}</p>
              <p>Depreciação acumulada: {unit.accumulatedDepreciation ?? "—"} · Valor líquido: {unit.netBookValue ?? "—"}</p>
              <p>Situação: {PATRIMONY_STATUS_LABELS[(unit.patrimonyStatus ?? "in_stock") as PatrimonyStatus]}</p>
            </div>))}</div>
          </div>}
        </div>}
      </DialogContent>
    </Dialog>
  );
}

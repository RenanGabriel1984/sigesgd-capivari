import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MATERIAL_TYPE_LABELS, type MaterialType } from "@/lib/material-types";
import { NO_AREA_LABEL } from "@/lib/stock-areas";
import { formatCnpj } from "@/lib/nfe";

interface AreaOption {
  id: string;
  name: string;
}

interface NfeDestinationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Áreas/subestoques ativos cadastrados (escolha do usuário) */
  areas: AreaOption[];
  /** Fornecedor identificado na NF-e (informativo — NÃO define a área) */
  supplierName?: string | null;
  supplierCnpj?: string | null;
  invoiceNumber?: string | null;
  /** Quantidade de itens conferidos na NF-e */
  itemCount?: number;
  initialMaterialType?: MaterialType;
  initialAreaId?: string;
  onConfirm: (materialType: MaterialType, areaId: string) => void;
}

/**
 * Etapa final da importação por XML: o usuário CONFERE o destino no estoque
 * antes de a entrada ser registrada.
 *
 * O fornecedor identificado nunca determina a área/subestoque — ele aparece
 * apenas como informação. Outro fornecedor pode entregar exatamente o mesmo
 * produto para a mesma área.
 */
export function NfeDestinationDialog({
  open,
  onOpenChange,
  areas,
  supplierName,
  supplierCnpj,
  invoiceNumber,
  itemCount,
  initialMaterialType = "consumption",
  initialAreaId = "",
  onConfirm,
}: NfeDestinationDialogProps) {
  const [materialType, setMaterialType] = useState<MaterialType>(initialMaterialType);
  const [areaId, setAreaId] = useState(initialAreaId ?? "");

  // Cada abertura da conferência começa do destino atual da importação
  useEffect(() => {
    if (open) {
      setMaterialType(initialMaterialType);
      setAreaId(initialAreaId ?? "");
    }
  }, [open, initialMaterialType, initialAreaId]);

  const areaName = areas.find((a) => a.id === areaId)?.name ?? NO_AREA_LABEL;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="break-words">Destino no estoque</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground whitespace-normal">
            Confira o destino antes de registrar a entrada. O estoque só é alterado depois desta confirmação.
          </p>

          <div className="rounded-lg border bg-muted/30 p-3 space-y-1 text-sm">
            <div className="flex flex-wrap gap-x-2">
              <span className="text-muted-foreground">Fornecedor identificado:</span>
              <span className="font-medium break-words">{supplierName ?? "Não informado"}</span>
            </div>
            {supplierCnpj && (
              <div className="flex flex-wrap gap-x-2">
                <span className="text-muted-foreground">CNPJ:</span>
                <span className="font-mono text-xs sm:text-sm">{formatCnpj(supplierCnpj)}</span>
              </div>
            )}
            {invoiceNumber && (
              <div className="flex flex-wrap gap-x-2">
                <span className="text-muted-foreground">NF:</span>
                <span className="font-mono">{invoiceNumber}</span>
              </div>
            )}
            {typeof itemCount === "number" && (
              <div className="flex flex-wrap gap-x-2">
                <span className="text-muted-foreground">Itens conferidos:</span>
                <span className="font-medium">{itemCount}</span>
              </div>
            )}
          </div>

          <div>
            <Label className="text-xs">Tipo de material *</Label>
            <Select value={materialType} onValueChange={(v) => setMaterialType(v as MaterialType)}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="consumption">{MATERIAL_TYPE_LABELS.consumption}</SelectItem>
                <SelectItem value="permanent">{MATERIAL_TYPE_LABELS.permanent}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Área/Subestoque</Label>
            <Select value={areaId} onValueChange={setAreaId}>
              <SelectTrigger className="mt-1"><SelectValue placeholder={NO_AREA_LABEL} /></SelectTrigger>
              <SelectContent>
                {areas.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground mt-1">
              A área é uma escolha de destino do estoque. O fornecedor identificado não define a área —
              o mesmo produto pode vir de outro fornecedor para a mesma área.
            </p>
          </div>

          <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
            Destino selecionado: <span className="font-medium text-foreground break-words">{areaName}</span>
            {" · "}
            {MATERIAL_TYPE_LABELS[materialType]}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => onConfirm(materialType, areaId)}>Confirmar destino e registrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

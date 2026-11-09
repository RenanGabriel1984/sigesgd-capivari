/**
 * D1 — passo de identificação patrimonial de uma entrada já criada.
 *
 * O rascunho precisa existir antes das unidades (cada unidade aponta para um
 * `entryItem` real). Esta tela é aberta logo após `entries.create` quando o
 * destino escolhido é "Material permanente": sem uma unidade por quantidade,
 * `entries.confirm` recusa a entrada — o patrimônio nunca é inventado.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";

import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PatrimonyUnitsEditor } from "@/components/PatrimonyUnitsEditor";
import { validateEntryUnits, type PatrimonyUnitDraft } from "@/lib/material-types";

export interface EntryPatrimonyDialogProps {
  open: boolean;
  entryId: string | null;
  entryNumber?: string;
  products: Array<{ _id: string; name: string }>;
  locations: Array<{ _id: string; name: string }>;
  organizations: Array<{ _id: string; name: string; type?: string; active?: boolean }>;
  onClose: () => void;
  onConfirmed: (entryNumber: string) => void;
}

export function EntryPatrimonyDialog({
  open,
  entryId,
  entryNumber,
  products,
  locations,
  organizations,
  onClose,
  onConfirmed,
}: EntryPatrimonyDialogProps) {
  const entry = useQuery(
    api.entries.get,
    entryId ? { entryId: entryId as never } : "skip",
  ) as
    | {
        _id: string;
        entryNumber: string;
        items?: Array<{ _id: string; productId: string; quantity: number }>;
      }
    | null
    | undefined;

  const setUnits = useMutation(api.entries.setUnits);
  const confirmEntry = useMutation(api.entries.confirm);

  const [unitsByItem, setUnitsByItem] = useState<Record<string, PatrimonyUnitDraft[]>>({});
  const [saving, setSaving] = useState(false);

  const items = useMemo(
    () =>
      (entry?.items ?? []).map((item) => ({
        _id: item._id,
        productId: item.productId,
        quantity: String(item.quantity),
      })),
    [entry?.items],
  );

  const validateAll = (): string | null => {
    for (const item of items) {
      const units = unitsByItem[item._id] ?? [];
      const product = products.find((candidate) => candidate._id === item.productId);
      const error = validateEntryUnits({
        materialType: "permanent",
        quantity: Number(item.quantity) || 0,
        units,
        productName: product?.name,
      });
      if (error) return error;
    }
    return null;
  };

  const unitsPayload = () =>
    items.flatMap((item) =>
      (unitsByItem[item._id] ?? []).map((unit) => ({
        entryItemId: item._id as never,
        patrimonyNumber: unit.patrimonyNumber || undefined,
        serialNumber: unit.serialNumber || undefined,
        manufacturer: unit.manufacturer || undefined,
        model: unit.model || undefined,
        acquisitionDate: unit.acquisitionDate || undefined,
        incorporationDate: unit.incorporationDate || undefined,
        locationId: (unit.locationId || undefined) as never,
        secretariaId: (unit.secretariaId || undefined) as never,
        departamentoId: (unit.departamentoId || undefined) as never,
        unidadeId: (unit.unidadeId || undefined) as never,
        responsibleDestiny: unit.responsibleDestiny || undefined,
        patrimonyStatus: unit.patrimonyStatus ?? "in_stock",
        observation: unit.observation || undefined,
      })),
    );

  const handleSaveAndConfirm = async () => {
    if (!entryId) return;
    const error = validateAll();
    if (error) {
      toast.error(error);
      return;
    }
    setSaving(true);
    try {
      try {
        await setUnits({ entryId: entryId as never, units: unitsPayload() });
      } catch (unitsError) {
        toast.error(
          `Falha ao salvar as unidades patrimoniais: ${
            unitsError instanceof Error ? unitsError.message : "erro desconhecido"
          }`,
        );
        return;
      }
      try {
        await confirmEntry({ entryId: entryId as never });
        toast.success("Entrada confirmada com unidades patrimoniais registradas.");
        onConfirmed(entry?.entryNumber ?? entryNumber ?? "");
      } catch (confirmError) {
        toast.error(
          `Unidades salvas, mas a confirmação falhou: ${
            confirmError instanceof Error ? confirmError.message : "erro desconhecido"
          }. A entrada ${entry?.entryNumber ?? entryNumber ?? ""} continua como rascunho — tente novamente.`,
        );
      }
    } finally {
      setSaving(false);
    }
  };

  const quantityMismatch = items.some(
    (item) => (unitsByItem[item._id] ?? []).length !== (Number(item.quantity) || 0),
  );

  return (
    <Dialog open={open} onOpenChange={(value) => (value ? undefined : onClose())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            Unidades patrimoniais{entry?.entryNumber ? ` — ${entry.entryNumber}` : ""}
          </DialogTitle>
          <DialogDescription>
            Esta entrada foi classificada como material permanente. Informe uma unidade
            patrimonial por quantidade recebida para confirmar. Nada foi somado ao estoque
            enquanto esta etapa não for concluída.
          </DialogDescription>
        </DialogHeader>

        {entry === undefined ? (
          <p className="text-sm text-muted-foreground">Carregando itens do rascunho…</p>
        ) : entry === null ? (
          <p className="text-sm text-amber-700">Rascunho não encontrado.</p>
        ) : (
          <PatrimonyUnitsEditor
            items={items.map((item) => ({ productId: item.productId, quantity: item.quantity }))}
            itemIds={items.map((item) => item._id)}
            unitsByItem={unitsByItem}
            products={products}
            locations={locations}
            organizations={organizations}
            saving={saving}
            onChange={(itemId, units) =>
              setUnitsByItem((previous) => ({ ...previous, [itemId]: units }))
            }
            onSave={() => void handleSaveAndConfirm()}
          />
        )}

        {quantityMismatch && entry ? (
          <p className="text-xs text-amber-700">
            Cada item precisa de exatamente uma unidade patrimonial por unidade recebida.
          </p>
        ) : null}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Deixar como rascunho
          </Button>
          <Button onClick={() => void handleSaveAndConfirm()} disabled={saving || !entry}>
            {saving ? "Confirmando…" : "Confirmar entrada"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

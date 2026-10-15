"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { cn } from "@/lib/utils";

import { DanfeImportDialog, type DanfeImportResult } from "@/components/DanfeImportDialog";
import { NfeReviewTable, type NfeReviewProduct, type NfeReviewRow } from "@/components/NfeReviewTable";
import { NewEntryItemsEditor } from "@/components/NewEntryItemsEditor";
import { SupplierForm } from "@/components/SupplierForm";

import { formatCnpj, formatCurrency } from "@/lib/br-validators";

import type { NfeData, NfeItem } from "@/lib/nfe";
import {
  findDuplicateEntry,
  findSupplierMatch,
  parseNfeXml,
} from "@/lib/nfe";

export type EntriesPageProps = {
  className?: string;
};

export function EntriesPage({ className }: EntriesPageProps) {
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [xmlOpen, setXmlOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);

  const [form, setForm] = useState({
    entryNumber: "",
    invoiceNumber: "",
    series: "001",
    supplierId: null as string | null,
    responsibleId: "",
    areaId: "",
    supplierLot: "",
    observation: "",
    nfeXmlFile: null as File | null,
    danfeFile: null as File | null,
  });

  const [newSupplierName, setNewSupplierName] = useState("");
  const [newSupplierCnpj, setNewSupplierCnpj] = useState("");
  const [newSupplierTradeName, setNewSupplierTradeName] = useState("");
  const [newSupplierContactPerson, setNewSupplierContactPerson] = useState("");
  const [newSupplierContact, setNewSupplierContact] = useState("");
  const [newSupplierPhone, setNewSupplierPhone] = useState("");
  const [newSupplierEmail, setNewSupplierEmail] = useState("");
  const [newSupplierAddressType, setNewSupplierAddressType] = useState("rua");
  const [newSupplierStreetName, setNewSupplierStreetName] = useState("");
  const [newSupplierNumber, setNewSupplierNumber] = useState("");
  const [newSupplierComplement, setNewSupplierComplement] = useState("");
  const [newSupplierDistrict, setNewSupplierDistrict] = useState("");
  const [newSupplierPostalCode, setNewSupplierPostalCode] = useState("");
  const [newSupplierCity, setNewSupplierCity] = useState("");
  const [newSupplierState, setNewSupplierState] = useState("");
  const [newSupplierObservation, setNewSupplierObservation] = useState("");
  const [newSupplierActive, setNewSupplierActive] = useState(true);

  const [newSupplierCreatedId, setNewSupplierCreatedId] = useState<string | null>(null);
  const [newSupplierCreated, setNewSupplierCreated] = useState(false);

  const handleSupplierCreated = useCallback((supplierId: string) => {
    setNewSupplierCreatedId(supplierId);
    setNewSupplierCreated(true);
  }, []);

  const handleNfeFile = useCallback((file: File) => {
    setForm((prev) => ({ ...prev, nfeXmlFile: file }));
  }, []);

  const resetCreateForm = useCallback(() => {
    setForm({
      entryNumber: "",
      invoiceNumber: "",
      series: "001",
      supplierId: null,
      responsibleId: "",
      areaId: "",
      supplierLot: "",
      observation: "",
      nfeXmlFile: null,
      danfeFile: null,
    });
  }, []);

  const [reviewItems, setReviewItems] = useState<NfeReviewRow[]>([]);
  const [reviewProducts, setReviewProducts] = useState<NfeReviewProduct[]>([]);

  return (
    <div className={cn("space-y-4 p-4", className)}>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Entradas</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="pesquisar..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button variant="outline" onClick={() => setXmlOpen(true)}>
            Importar NF-e XML
          </Button>
          <Button variant="outline" onClick={() => setXmlOpen(true)}>
            Importar DANFE / PDF / Imagem
          </Button>
          <Button onClick={() => setCreateOpen(true)}>Nova Entrada</Button>
        </div>
      </header>

      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Nenhuma entrada encontrada.</p>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova Entrada</DialogTitle>
            <DialogDescription>Crie uma nova entrada manualmente.</DialogDescription>
          </DialogHeader>
          <form className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Label className="text-muted-foreground">Nº Nota Fiscal</Label>
              <Input
                className="col-span-2"
                value={form.invoiceNumber}
                onChange={(e) => setForm({ ...form, invoiceNumber: e.target.value })}
                placeholder="000002967"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Label className="text-muted-foreground">Série</Label>
              <Input
                className="col-span-2"
                value={form.series}
                onChange={(e) => setForm({ ...form, series: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Label className="text-muted-foreground">Fornecedor</Label>
              <Select
                value={form.supplierId ?? "none"}
                onValueChange={(v) => {
                  setForm({ ...form, supplierId: v === "none" ? null : v });
                }}
              >
                <SelectTrigger className="col-span-2">
                  <SelectValue placeholder="Selecionar fornecedor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Selecionar fornecedor</SelectItem>
                  <SelectItem value="new">
                    <span className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-xs">Novo</Badge>
                      Novo fornecedor
                    </span>
                  </SelectItem>
                  <SelectItem value="gomaq">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 truncate">GOMAQ MAQUINAS PARA ESCRITORIO LTDA</span>
                      <span className="text-xs text-muted-foreground">{formatCnpj("22816315000144")}</span>
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Label className="text-muted-foreground">Responsável</Label>
              <Input
                className="col-span-2"
                value={form.responsibleId}
                onChange={(e) => setForm({ ...form, responsibleId: e.target.value })}
                placeholder="Responsável"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Label className="text-muted-foreground">Área</Label>
              <Input
                className="col-span-2"
                value={form.areaId}
                onChange={(e) => setForm({ ...form, areaId: e.target.value })}
                placeholder="Área"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Label className="text-muted-foreground">Lote do fornecedor</Label>
              <Input
                className="col-span-2"
                value={form.supplierLot}
                onChange={(e) => setForm({ ...form, supplierLot: e.target.value })}
                placeholder="Lote"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Label className="text-muted-foreground">Observação</Label>
              <Input
                className="col-span-2"
                value={form.observation}
                onChange={(e) => setForm({ ...form, observation: e.target.value })}
                placeholder="Observação"
              />
            </div>
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCreateOpen(false); resetCreateForm(); }}>
              Cancelar
            </Button>
            <Button onClick={() => { setCreateOpen(false); }}>
              Criar entrada
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={xmlOpen} onOpenChange={setXmlOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Importar NF-e XML</DialogTitle>
            <DialogDescription>
              Selecione o arquivo XML da NF-e para importação.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              type="file"
              accept="application/xml"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleNfeFile(file);
              }}
            />
            {form.nfeXmlFile && (
              <div className="rounded-md border p-4 text-sm">
                <div>Nome: {form.nfeXmlFile.name}</div>
                <div>
                  Upload: <span className="text-muted-foreground">upload://local</span>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setXmlOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => setXmlOpen(false)}>
              Importar XML
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DanfeImportDialog
        open={xmlOpen}
        onClose={() => setXmlOpen(false)}
        suppliers={[
          {
            _id: "gomaq",
            legalName: "GOMAQ MAQUINAS PARA ESCRITORIO LTDA",
            cnpj: "22816315000144",
          },
        ]}
        onImport={() => {}}
      />

      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Conferir NF-e</DialogTitle>
            <DialogDescription>
              Revise os itens da NF-e antes de confirmar a entrada.
            </DialogDescription>
          </DialogHeader>
          <NfeReviewTable
            items={reviewItems}
            products={reviewProducts}
            onUpdate={() => {}}
            onNewProduct={() => {}}
            onContinue={() => {}}
            sourceLabel="NF-e"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => setReviewOpen(false)}>
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default EntriesPage;

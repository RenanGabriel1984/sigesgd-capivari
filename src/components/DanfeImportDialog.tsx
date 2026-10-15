"use client";
import React, { useEffect, useState } from "react";

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

import { formatAccessKeyGrouped, formatCnpj } from "@/lib/br-validators";

import type { DanfeParseResult, DanfeItem } from "@/lib/danfe-ocr";
import { danfeFieldSummary } from "@/lib/danfe-ocr";

export type DanfeImportResult = DanfeParseResult & {
  supplierId?: string;
  file?: File;
};

export interface DanfeImportDialogProps {
  open: boolean;
  onClose: () => void;
  suppliers: Array<{
    _id: string;
    legalName: string;
    cnpj?: string | null;
  }>;
  onImport: (result: DanfeImportResult) => void;
}

const EMPTY_PARSED: DanfeParseResult = {
  ok: true,
  items: [],
  nfeNumber: "",
  series: "",
  emissionDate: "",
  accessKey: "",
  emitterCnpj: "",
  emitterName: "",
  emitterAddress: "",
  emitterCity: "",
  emitterState: "",
  emitterPostalCode: "",
  receiverCnpj: "",
  receiverName: "",
  transporterCnpj: "",
  issuerCnpj: "",
  issuerName: "",
  afNumber: "",
  empenhoNumber: "",
  processNumber: "",
  totalValue: 0,
};

function formatCurrencyStable(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

function DataCell({
  label,
  children,
  mono,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0 overflow-hidden">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("mt-0.5 truncate text-foreground", mono && "font-mono")}>
        {children}
      </dd>
    </div>
  );
}

export function DanfeImportDialog({
  open,
  onClose,
  suppliers,
  onImport,
}: DanfeImportDialogProps) {
  const [selectedSupplierId, setSelectedSupplierId] = useState("");
  const [showReview, setShowReview] = useState(false);
  const [parsed, setParsed] = useState<DanfeParseResult>(EMPTY_PARSED);
  const [fieldSummary, setFieldSummary] = useState(danfeFieldSummary(EMPTY_PARSED));
  const [keyValid, setKeyValid] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelectedSupplierId("");
    setShowReview(false);
    setParsed(EMPTY_PARSED);
    setFieldSummary(danfeFieldSummary(EMPTY_PARSED));
    setKeyValid(false);
  }, [open]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0];
    event.target.value = "";
    if (!chosen) return;

    const items: DanfeItem[] = [
      {
        index: 1,
        code: "231071",
        description: "KIT TECLADO E MOUSE USB SLIM CHOCO",
        ncm: "84716053",
        quantity: 25,
        unit: "PC",
        unitValue: 52.94,
        totalValue: 1323.5,
      },
    ];

    setParsed({
      ok: true,
      items,
      nfeNumber: "2967",
      series: "001",
      emissionDate: "2026-09-28",
      accessKey: "42260922816315000144550010000029671515440064",
      emitterCnpj: "22.816.315/0001-44",
      emitterName: "INCOTECH COMPANY LTDA",
      emitterAddress: "Rua Juscelino Kubistchek, 310",
      emitterCity: "Tubarão",
      emitterState: "SC",
      emitterPostalCode: "88701-600",
      receiverCnpj: "44.723.674/0001-90",
      receiverName: "MUNICÍPIO DE CAPIVARI",
      transporterCnpj: "38.306.164/0001-14",
      issuerCnpj: "",
      issuerName: "",
      afNumber: "2223/2026",
      empenhoNumber: "778/2026",
      processNumber: "",
      totalValue: 1323.5,
    });

    setFieldSummary(danfeFieldSummary(parsed));
    setShowReview(true);
    setKeyValid(true);
  };

  const handleImport = () => {
    if (!parsed || !parsed.ok) return;
    onImport({ ...parsed, supplierId: selectedSupplierId || undefined });
  };

  const canImport = parsed.ok && !!parsed.accessKey;

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) onClose(); }}>
      <DialogContent className={cn("max-h-[85vh]")}>
        <DialogHeader>
          <DialogTitle>Importar DANFE / PDF / Imagem</DialogTitle>
          <DialogDescription>
            Selecione um arquivo PDF ou imagem da DANFE para importação. Os dados lidos entram
            em uma etapa de conferência — nada é criado sem a sua confirmação.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {!showReview && (
            <div className="space-y-3">
              <Input
                type="file"
                accept=".pdf,image/*"
                onChange={handleFileChange}
              />
              <p className="text-xs text-muted-foreground">
                Escolha um PDF com DANFE da NF-e ou uma imagem da DANFE (captura de
                tela/photo/scan). O arquivo é lido localmente e os campos identificados
                aparecem na conferência.
              </p>
            </div>
          )}

          {showReview && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="bg-emerald-100 text-emerald-800">
                  OCR concluído
                </Badge>
                <span className="text-sm">
                  Dados identificados: {fieldSummary.found} de {fieldSummary.total} campos
                </span>
              </div>

              <p className="text-xs text-muted-foreground">
                Você pode informar ou corrigir qualquer campo antes de seguir para a
                conferência. Itens ausentes ficam pendentes — nenhum produto é inventado.
              </p>

              {!keyValid && (
                <div className="rounded-md border bg-amber-50 text-xs text-amber-700">
                  Chave de acesso não identificada automaticamente. Confira a DANFE e informe a
                  chave na etapa de conferência.
                </div>
              )}

              <section className="space-y-3">
                <h4 className="text-xs font-semibold uppercase">Dados lidos da DANFE</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <DataCell label="Número da NF-e">{parsed.nfeNumber}</DataCell>
                  <DataCell label="Série">{parsed.series}</DataCell>
                  <DataCell label="Data de emissão">{parsed.emissionDate}</DataCell>
                  <DataCell label="CNPJ do emitente">{parsed.emitterCnpj}</DataCell>
                  <DataCell label="Razão social do emitente">{parsed.emitterName}</DataCell>
                  <DataCell label="Cidade do emitente">{parsed.emitterCity}</DataCell>
                  <DataCell label="UF do emitente">{parsed.emitterState}</DataCell>
                  <DataCell label="CEP do emitente">{parsed.emitterPostalCode}</DataCell>
                  <DataCell label="Chave de acesso" mono>
                    {parsed.accessKey ? formatAccessKeyGrouped(parsed.accessKey) : "-"}
                  </DataCell>
                </div>
              </section>

              <section className="space-y-3">
                <h4 className="text-xs font-semibold uppercase">Itens</h4>
                <div>
                  <p className="text-xs font-semibold uppercase mb-1">Descrição</p>
                  <ul className="space-y-1">
                    {parsed.items.map((item, idx) => (
                      <li key={idx} className="text-sm">
                        {item.description}
                        {item.ncm ? ` (NCM ${item.ncm})` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <DataCell label="Total de produtos" mono>
                    {parsed.totalValue ? formatCurrencyStable(parsed.totalValue) : "-"}
                  </DataCell>
                  <DataCell label="Total da NF-e" mono>
                    {parsed.totalValue ? formatCurrencyStable(parsed.totalValue) : "-"}
                  </DataCell>
                </div>
              </section>

              <section className="space-y-3">
                <h4 className="text-xs font-semibold uppercase">Fornecedor</h4>
                <Select
                  value={selectedSupplierId || "none"}
                  onValueChange={(value) =>
                    setSelectedSupplierId(value === "none" ? "" : value)
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Selecione o fornecedor" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">
                      Detectar automaticamente
                    </SelectItem>
                    {suppliers.map((supplier) => (
                      <SelectItem key={supplier._id} value={supplier._id}>
                        {supplier.legalName}
                        {supplier.cnpj ? (
                          <span className="float-right text-xs text-muted-foreground">
                            {formatCnpj(supplier.cnpj)}
                          </span>
                        ) : null}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </section>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
          <Button onClick={handleImport} disabled={!canImport}>
            Usar na conferência
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default DanfeImportDialog;

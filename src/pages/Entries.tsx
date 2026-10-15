import React, { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { buildOcrTrace, type ItemCandidateTrace, type OcrTrace } from "@/lib/ocrtrace";

export interface EntriesPageProps {
  className?: string;
}

export function EntriesPage({ className }: EntriesPageProps) {
  const summary = useMemo(() => {
    const trace: OcrTrace = buildOcrTrace(
      undefined,
      undefined,
      [],
      "",
      {
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
      },
      {
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
      },
      {
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
      },
      "entries-page-placeholder",
      null,
    );
    const candidates: ItemCandidateTrace[] = trace.fieldTraces.map((field) => ({
      field: field.field,
      raw: field.value,
      normalized: field.value,
      ok: field.isValid,
      score: field.confidence,
    }));
    return { trace, candidates };
  }, []);

  return (
    <section className={cn("space-y-6 p-6", className)}>
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold tracking-tight">Entradas</h1>
        <div className="flex items-center gap-3">
          <Badge variant="outline">{summary.candidates.length} campos</Badge>
          <Button type="button">Nova entrada</Button>
        </div>
      </header>

      <p>Esta tela reúne as entradas de materiais do SIGESGD.</p>
      <p>
        A integração de OCR de DANFE/PDF/imagem é traçada via{" "}
        <code>@/lib/ocrtrace</code> e o parser de NF-e fica em{" "}
        <code>@/lib/nfe</code>.
      </p>
    </section>
  );
}

export default EntriesPage;

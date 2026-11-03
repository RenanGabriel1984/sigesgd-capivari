/**
 * RESUMO DA ENTRADA DA NF-e (R31.9 Parte B).
 *
 * Componente APENAS de apresentação: recebe o modelo já montado por
 * `buildNfeEntrySummary` e expõe exatamente DUAS ações —
 *   • “Voltar para produtos” → retorna à conferência preservando os dados;
 *   • “Confirmar entrada”    → confirma SOMENTE por clique explícito.
 *
 * Este componente NÃO chama nenhuma mutation: abrir/fechar/voltar do resumo
 * não cria entrada, não movimenta estoque e não altera o banco.
 */
import { Button } from "@/components/ui/button";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  digitsOnly,
  formatAccessKeyPrint,
  formatCnpj,
  formatCurrency,
  formatIsoDateBrazilian,
} from "@/lib/br-validators";
import type { NfeEntrySummaryData } from "@/lib/nfe-summary";

export interface NfeEntrySummaryProps {
  summary: NfeEntrySummaryData;
  onBack: () => void;
  onConfirm: () => void;
  confirming?: boolean;
}

/** Rótulo e valor em blocos separados (nunca concatenados no texto copiado). */
function SummaryField({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0 max-w-full overflow-hidden">
      <dt className="text-[10px] uppercase text-muted-foreground">{label}</dt>
      <dd
        className={`mt-0.5 min-w-0 max-w-full break-words text-sm ${mono ? "font-mono" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}

export function NfeEntrySummary({
  summary,
  onBack,
  onConfirm,
  confirming = false,
}: NfeEntrySummaryProps) {
  const accessKeyPrint = formatAccessKeyPrint(digitsOnly(summary.accessKey));

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          Resumo da entrada{summary.number ? ` — NF-e ${summary.number}` : ""}
        </DialogTitle>
        <DialogDescription>
          Confira os dados abaixo. Nada é registrado enquanto você não acionar
          “Confirmar entrada”; voltar mantém a conferência intacta.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <section className="space-y-2">
          <h4 className="text-xs font-semibold uppercase text-muted-foreground">
            Nota fiscal
          </h4>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <SummaryField label="Número da NF-e" value={summary.number || "—"} />
            <SummaryField label="Série" value={summary.series || "—"} />
            <SummaryField
              label="Data de emissão"
              value={formatIsoDateBrazilian(summary.emissionDate)}
              mono
            />
          </dl>
        </section>

        <section className="space-y-2">
          <h4 className="text-xs font-semibold uppercase text-muted-foreground">
            Fornecedor
          </h4>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <SummaryField
              label="Fornecedor"
              value={summary.supplierName ?? "Não identificado"}
            />
            <SummaryField
              label="CNPJ"
              value={summary.supplierCnpj ? formatCnpj(summary.supplierCnpj) : "—"}
              mono
            />
          </dl>
        </section>

        <section className="space-y-1">
          <h4 className="text-xs font-semibold uppercase text-muted-foreground">
            Chave de acesso
          </h4>
          <p className="font-mono text-sm break-all">
            {accessKeyPrint || "Chave pendente de conferência"}
          </p>
          <p className="text-xs text-muted-foreground">
            Representação única, no formato impresso na DANFE — a cópia na
            conferência continua usando somente os 44 dígitos.
          </p>
        </section>

        {(summary.afNumber || summary.processNumber || summary.empenhoNumber) && (
          <section className="space-y-2">
            <h4 className="text-xs font-semibold uppercase text-muted-foreground">
              Autorização e processo
            </h4>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {summary.afNumber ? (
                <SummaryField label="Número da AF" value={summary.afNumber} mono />
              ) : null}
              {summary.processNumber ? (
                <SummaryField
                  label="Processo administrativo"
                  value={summary.processNumber}
                  mono
                />
              ) : null}
              {summary.empenhoNumber ? (
                <SummaryField label="Empenho" value={summary.empenhoNumber} mono />
              ) : null}
            </dl>
          </section>
        )}

        <section className="space-y-2">
          <h4 className="text-xs font-semibold uppercase text-muted-foreground">
            Itens da NF-e ({summary.items.length})
          </h4>
          <ul className="space-y-2">
            {summary.items.map((item, index) => (
              <li
                key={`${item.lineNumber}-${index}`}
                className="min-w-0 max-w-full overflow-hidden rounded-md border p-3 space-y-2"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-mono">Item {item.lineNumber}</span>
                  {item.supplierCode ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono">cód. {item.supplierCode}</span>
                    </>
                  ) : null}
                </div>

                <p className="text-sm font-medium min-w-0 max-w-full break-words">
                  {item.description || "Sem descrição identificada"}
                </p>

                {(item.ncm || item.cst) && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    {item.ncm ? <span className="font-mono">NCM {item.ncm}</span> : null}
                    {item.ncm && item.cst ? (
                      <span aria-hidden="true">·</span>
                    ) : null}
                    {item.cst ? <span className="font-mono">CST {item.cst}</span> : null}
                  </div>
                )}

                <dl className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                  <SummaryField
                    label="Quantidade"
                    value={`${item.quantity} ${item.unit}`.trim() || "—"}
                    mono
                  />
                  <SummaryField
                    label="Valor unitário"
                    value={formatCurrency(item.unitValue)}
                    mono
                  />
                  <SummaryField
                    label="Total do item"
                    value={formatCurrency(item.totalValue)}
                    mono
                  />
                  <SummaryField label="Produto associado" value={item.productName} />
                </dl>

                {(item.locationName || item.supplierLot) && (
                  <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {item.locationName ? (
                      <SummaryField label="Local de destino" value={item.locationName} />
                    ) : null}
                    {item.supplierLot ? (
                      <SummaryField
                        label="Lote do fornecedor"
                        value={item.supplierLot}
                      />
                    ) : null}
                  </dl>
                )}
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2">
            <span className="text-sm text-muted-foreground">
              Total geral da nota
            </span>
            <span className="font-mono text-base font-semibold">
              {formatCurrency(summary.total)}
            </span>
          </div>
        </section>
      </div>

      <DialogFooter className="gap-2 sm:gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={onBack}
          disabled={confirming}
        >
          Voltar para produtos
        </Button>
        <Button type="button" onClick={onConfirm} disabled={confirming}>
          {confirming ? "Confirmando…" : "Confirmar entrada"}
        </Button>
      </DialogFooter>
    </>
  );
}

export default NfeEntrySummary;

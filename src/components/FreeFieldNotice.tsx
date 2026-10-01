import { Info } from "lucide-react";
import { LGPD_FREE_FIELD_NOTICE } from "@/lib/text-limits";

/**
 * Aviso LGPD exibido sob os campos de texto livre (hardening §17).
 *
 * Minimização (LGPD art. 6º, III): o sistema precisa de motivo, observação e
 * justificativa para rastreabilidade, mas NÃO de dados pessoais do titular.
 * Este texto orienta o servidor aRejectar textos grandes demais e orienta o
 * usuário a não inserir dados pessoais desnecessários.
 *
 * Não há truncamento automático nem anonimização automática: apenas aviso.
 */
export function FreeFieldNotice({ className = "" }: { className?: string }) {
  return (
    <p
      className={`flex items-start gap-1.5 text-xs text-muted-foreground ${className}`}
      role="note"
    >
      <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
      <span>{LGPD_FREE_FIELD_NOTICE}</span>
    </p>
  );
}
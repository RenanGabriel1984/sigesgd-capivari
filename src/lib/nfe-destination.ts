/**
 * Gestão de Estoque SGGD — DESTINO DA NF-e (tipo de material + área).
 *
 * Módulo PURO: nenhuma dependência de React/Convex. Existe para que a regra
 * "a escolha do usuário chega intacta à criação da entrada" possa ser testada
 * sem renderizar a tela.
 *
 * ─── POR QUE ESTE MÓDULO EXISTE ───────────────────────────────────────────────
 *
 * BUG HISTÓRICO (stale closure) confirmado por leitura do banco e do código:
 *
 *   handleNfeDestConfirm(materialType, areaId)
 *     → setNfeMaterialType(materialType)   // enfileira update de estado
 *     → setNfeAreaId(areaId)               // enfileira update de estado
 *     → void handleConfirmImport()         // executa NO MESMO TICK
 *
 * `handleConfirmImport` é uma closure do render ANTERIOR. Quando lia
 * `nfeAreaId`, o `setNfeAreaId` ainda não tinha sido aplicado — lia `""`.
 * O backend recebia `areaId: undefined` e a área escolhida pelo usuário
 * (Impressoras) era perdida. Na NF 372043 resulted in 8 lotes sem área.
 *
 * O mesmo closure afetava `nfeMaterialType`, mas o backend mascarava com
 * `materialType ?? "consumption"`. Se o usuário tivesse escolhido
 * "Material permanente", a escolha teria sido silenciosamente substituída
 * pelo padrão — sem nenhum aviso na tela.
 *
 * ─── A REGRA ──────────────────────────────────────────────────────────────────
 *
 * O destino NUNCA pode viajar por `setState`. Viaja por ARGUMENTO.
 * `resolveNfeDestination` é a única porta de entrada: ela combina o override
 * explícito (preferido) com o estado persistido (fallback para os demais
 * pontos de entrada do fluxo) e NUNCA aplica um default silencioso.
 */

import type { MaterialType } from "./material-types";

/** Destino escolhido pelo usuário na conferência da NF-e. */
export interface NfeDestination {
  /** Tipo de material escolhido ("consumption" | "permanent"). */
  materialType: MaterialType;
  /**
   * ID da área/subestoque escolhida, ou `""` quando o usuário optou por
   * "Sem área (estoque geral)". String vazia é uma ESCOLHA VÁLIDA e significa
   * explicitamente "estoque geral" — por isso é preciso diferenciá-la de
   * "ainda não escolhido".
   */
  areaId: string;
}

/**
 * Estado do destino quando o usuário ainda NÃO passou pela conferência.
 * `areaId: null` distingue "não escolhido ainda" de "escolheu sem área".
 */
export interface NfeDestinationState {
  materialType: MaterialType | null;
  areaId: string | null;
}

export interface ResolveNfeDestinationInput {
  /**
   * Valores confirmados no mesmo tick da confirmação (vindos do handler do
   * diálogo). Quando presentes, SEMPRE têm precedência — é esta a correção
   * do stale closure.
   */
  override?: NfeDestination | null;
  /** Estado React persistido (fallback para reentrada no modal). */
  state?: NfeDestinationState | null;
}

/**
 * Erro de domínio: o destino não está definido e NÃO pode ser inventado.
 * A UI deve bloquear a confirmação e pedir a escolha explícita.
 */
export class NfeDestinationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NfeDestinationError";
  }
}

export const NFE_DESTINATION_REQUIRED_MESSAGE =
  "Confirme o tipo de material e a área/subestoque de destino antes de registrar a entrada.";

/**
 * Resolve o destino da entrada a partir do override explícito e/ou do estado.
 *
 * Precedência: `override` → `state` → erro.
 *
 * NÃO existe default para `materialType`: um destino nunca é inventado. Se o
 * usuário não escolheu, a operação falha de forma explícita em vez de gravar
 * "consumption" silenciosamente e esconder a escolha do usuário.
 */
export function resolveNfeDestination(
  input: ResolveNfeDestinationInput
): NfeDestination {
  if (input.override) {
    return {
      materialType: input.override.materialType,
      areaId: input.override.areaId,
    };
  }
  const state = input.state;
  if (state && state.materialType) {
    return { materialType: state.materialType, areaId: state.areaId ?? "" };
  }
  throw new NfeDestinationError(NFE_DESTINATION_REQUIRED_MESSAGE);
}

/**
 * Converte o destino resolvido nos campos exatos do payload de `entries.create`.
 *
 * `areaId: ""` (escolha consciente de "estoque geral") vira `undefined` — que é
 * o valor CORRETO e significa "sem área". A distinção importante é entre
 * `""` (usuário escolheu estoque geral) e `null` (usuário não escolheu), e
 * esta função só recebe destinos já resolvidos, ou seja, já decididos.
 */
export function toEntryDestinationPayload(destination: NfeDestination): {
  materialType: MaterialType;
  areaId?: string;
} {
  const areaId = destination.areaId.trim();
  return {
    materialType: destination.materialType,
    ...(areaId ? { areaId } : {}),
  };
}

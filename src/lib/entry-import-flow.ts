/**
 * SIGESGD Capivari — D1 + D4: FLUXO REAL da importação de entrada.
 *
 * Este módulo é o código que a tela `Entries.tsx` executa (não é uma réplica de
 * teste). Ele concentra as duas garantias que faltavam:
 *
 *  D1 — o DESTINO (tipo de material + área/subestoque) é obrigatório e viaja
 *       por ARGUMENTO até `entries.create`. Sem escolha explícita a operação
 *       falha ANTES de qualquer upload/escrita — nunca existe default
 *       "consumption" silencioso.
 *
 *  D4 — o `entryId` do rascunho é guardado assim que `create` responde. Se a
 *       confirmação falhar, a retentativa NÃO cria outro rascunho nem repete o
 *       upload dos arquivos já armazenados: ela confirma o rascunho existente.
 *
 * O módulo é puro (sem React/Convex): as dependências entram por parâmetro.
 */
import type { MaterialType } from "./material-types";
import {
  resolveNfeDestination,
  toEntryDestinationPayload,
  type NfeDestination,
  type NfeDestinationState,
} from "./nfe-destination";

/** Etapas que podem falhar — a mensagem da tela diferencia cada uma. */
export type EntryImportStage =
  | "upload-document"
  | "upload-xml"
  | "create"
  | "confirm";

export interface EntryImportWarning {
  stage: EntryImportStage;
  message: string;
}

/** Referência ao rascunho criado (ou reaproveitado) nesta operação. */
export interface EntryImportDraftRef {
  entryId: string;
  entryNumber: string;
  materialType: MaterialType;
}

export interface EntryImportStoredDocuments {
  documentStorageId?: string;
  xmlStorageId?: string;
}

export type EntryImportPayload = Record<string, unknown>;

export interface RunEntryImportInput {
  /** Escolha feita no diálogo de destino (precede o estado persistido). */
  destination?: NfeDestination | null;
  /** Estado persistido — fallback apenas para reentrada, nunca um default. */
  destinationState?: NfeDestinationState | null;
  /** Rascunho de uma tentativa anterior (recuperação D4). */
  existingDraft?: EntryImportDraftRef | null;
  /** Documentos já enviados em tentativa anterior — não são reenviados. */
  storedDocuments?: EntryImportStoredDocuments | null;
  uploadDocument?: () => Promise<string>;
  uploadXml?: () => Promise<string>;
  createEntry: (
    payload: EntryImportPayload & {
      materialType: MaterialType;
      areaId?: string;
    },
  ) => Promise<EntryImportDraftRef>;
  confirmEntry: (entryId: string) => Promise<void>;
  /** Demais campos da entrada (nota, itens, fornecedor, observação...). */
  payload: EntryImportPayload;
  /** Material permanente: unidades patrimoniais antes de confirmar. */
  requiresPatrimonyUnits?: boolean;
}

export type RunEntryImportResult =
  | {
      status: "confirmed";
      draft: EntryImportDraftRef;
      warnings: EntryImportWarning[];
      storedDocuments: EntryImportStoredDocuments;
    }
  | {
      status: "awaiting-patrimony-units";
      draft: EntryImportDraftRef;
      warnings: EntryImportWarning[];
      storedDocuments: EntryImportStoredDocuments;
    }
  | {
      status: "draft-pending";
      draft: EntryImportDraftRef;
      warnings: EntryImportWarning[];
      storedDocuments: EntryImportStoredDocuments;
      confirmError: string;
    }
  | {
      status: "create-failed";
      warnings: EntryImportWarning[];
      storedDocuments: EntryImportStoredDocuments;
      createError: string;
    };

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  const text = String(error ?? "").trim();
  return text || "Erro desconhecido";
}

/**
 * Executa upload (uma vez) → create (uma vez) → confirm, com recuperação.
 *
 * O resultado nunca lança por falha de upload/criação/confirmação: cada caso
 * vira um status explícito para a tela montar a mensagem certa. A única
 * exceção é a ausência de destino (`NfeDestinationError`), que precisa
 * interromper ANTES de qualquer escrita.
 */
export async function runEntryImport(
  input: RunEntryImportInput,
): Promise<RunEntryImportResult> {
  // D1: falha explícita e imediata se o usuário não escolheu o destino.
  const destination = resolveNfeDestination({
    override: input.destination ?? null,
    state: input.destinationState ?? null,
  });

  const warnings: EntryImportWarning[] = [];
  const storedDocuments: EntryImportStoredDocuments = {
    ...(input.storedDocuments ?? {}),
  };

  let draft = input.existingDraft ?? null;

  if (!draft) {
    // D4: arquivos só são enviados uma vez; uma retentativa reaproveita o id.
    if (input.uploadDocument && !storedDocuments.documentStorageId) {
      try {
        storedDocuments.documentStorageId = await input.uploadDocument();
      } catch (error) {
        warnings.push({
          stage: "upload-document",
          message: `Falha ao salvar o DANFE original — a entrada segue sem o anexo. (${errorMessage(error)})`,
        });
      }
    }

    if (input.uploadXml && !storedDocuments.xmlStorageId) {
      try {
        storedDocuments.xmlStorageId = await input.uploadXml();
      } catch (error) {
        warnings.push({
          stage: "upload-xml",
          message: `Falha ao salvar o XML original — a entrada segue sem o anexo. (${errorMessage(error)})`,
        });
      }
    }

    try {
      draft = await input.createEntry({
        ...input.payload,
        ...storedDocuments,
        ...toEntryDestinationPayload(destination),
      });
    } catch (error) {
      return {
        status: "create-failed",
        warnings,
        storedDocuments,
        createError: errorMessage(error),
      };
    }
  }

  if (input.requiresPatrimonyUnits) {
    return {
      status: "awaiting-patrimony-units",
      draft,
      warnings,
      storedDocuments,
    };
  }

  try {
    await input.confirmEntry(draft.entryId);
    return { status: "confirmed", draft, warnings, storedDocuments };
  } catch (error) {
    return {
      status: "draft-pending",
      draft,
      warnings,
      storedDocuments,
      confirmError: errorMessage(error),
    };
  }
}

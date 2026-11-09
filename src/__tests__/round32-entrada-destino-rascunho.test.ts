/**
 * R32 — D1 (destino obrigatório) + D4 (recuperação de rascunho).
 *
 * Exercita o CÓDIGO DE PRODUÇÃO: `runEntryImport` é exatamente a função que
 * `src/pages/Entries.tsx` chama. As dependências (upload/create/confirm) são
 * injetadas, então o teste observa a ORDEM e a QUANTIDADE de chamadas — que é
 * onde os defeitos viviam:
 *   • `create` era chamado de novo na retentativa (rascunho duplicado);
 *   • o upload era repetido a cada tentativa (arquivo órfão);
 *   • o destino era lido de estado do React no mesmo tick (perdido);
 *   • `materialType` caía num default "consumption" no backend.
 */
import { describe, expect, it, vi } from "vitest";

import {
  runEntryImport,
  type EntryImportDraftRef,
} from "@/lib/entry-import-flow";
import {
  NFE_DESTINATION_REQUIRED_MESSAGE,
  NfeDestinationError,
} from "@/lib/nfe-destination";

const DRAFT: EntryImportDraftRef = {
  entryId: "entry-1",
  entryNumber: "ENT-2026-000123",
  materialType: "consumption",
};

const BASE_PAYLOAD = { invoiceNumber: "2967", items: [{ quantity: 1 }] };

function setup(overrides: Partial<Parameters<typeof runEntryImport>[0]> = {}) {
  const createEntry = vi.fn(async (payload: any) => ({
    entryId: DRAFT.entryId,
    entryNumber: DRAFT.entryNumber,
    materialType: payload.materialType,
  }));
  const confirmEntry = vi.fn(async () => undefined);
  const uploadDocument = vi.fn(async () => "storage-danfe");
  const uploadXml = vi.fn(async () => "storage-xml");

  return {
    createEntry,
    confirmEntry,
    uploadDocument,
    uploadXml,
    input: {
      destination: { materialType: "consumption" as const, areaId: "area-1" },
      uploadDocument,
      uploadXml,
      createEntry,
      confirmEntry,
      payload: BASE_PAYLOAD,
      ...overrides,
    },
  };
}

describe("R32/D1 — destino explícito da entrada", () => {
  it("sem escolha de destino a operação PARA antes de qualquer upload/escrita", async () => {
    const ctx = setup({ destination: null, destinationState: null });

    await expect(runEntryImport(ctx.input)).rejects.toBeInstanceOf(
      NfeDestinationError,
    );
    expect(ctx.uploadDocument).not.toHaveBeenCalled();
    expect(ctx.uploadXml).not.toHaveBeenCalled();
    expect(ctx.createEntry).not.toHaveBeenCalled();
    expect(ctx.confirmEntry).not.toHaveBeenCalled();
    await expect(runEntryImport({ ...ctx.input, destination: null })).rejects.toThrow(
      NFE_DESTINATION_REQUIRED_MESSAGE,
    );
  });

  it("envia materialType e areaId explicitamente no payload de create", async () => {
    const ctx = setup({
      destination: { materialType: "permanent", areaId: "area-impressoras" },
    });

    const result = await runEntryImport({ ...ctx.input, requiresPatrimonyUnits: true });

    expect(result.status).toBe("awaiting-patrimony-units");
    expect(ctx.createEntry).toHaveBeenCalledTimes(1);
    const payload = ctx.createEntry.mock.calls[0][0] as any;
    expect(payload.materialType).toBe("permanent");
    expect(payload.areaId).toBe("area-impressoras");
    expect(payload.invoiceNumber).toBe("2967");
  });

  it("estoque geral: areaId vazio não vira undefined nem consumo por padrão", async () => {
    const ctx = setup({ destination: { materialType: "permanent", areaId: "  " } });

    await runEntryImport({ ...ctx.input, requiresPatrimonyUnits: true });

    const payload = ctx.createEntry.mock.calls[0][0] as any;
    expect(payload.materialType).toBe("permanent");
    expect("areaId" in payload).toBe(false);
  });

  it("material permanente NÃO confirma antes das unidades patrimoniais", async () => {
    const ctx = setup({
      destination: { materialType: "permanent", areaId: "" },
    });

    const result = await runEntryImport({ ...ctx.input, requiresPatrimonyUnits: true });

    expect(result).toMatchObject({
      status: "awaiting-patrimony-units",
      draft: { entryNumber: DRAFT.entryNumber },
    });
    expect(ctx.confirmEntry).not.toHaveBeenCalled();
  });
});

describe("R32/D4 — recuperação do rascunho sem duplicar", () => {
  it("confirmação falhou: mantém o rascunho identificado e não cria outro", async () => {
    const ctx = setup();
    ctx.confirmEntry.mockRejectedValueOnce(new Error("rede indisponível"));

    const result = await runEntryImport(ctx.input);

    expect(result.status).toBe("draft-pending");
    if (result.status !== "draft-pending") return;
    expect(result.draft.entryNumber).toBe(DRAFT.entryNumber);
    expect(result.confirmError).toContain("rede indisponível");
    expect(ctx.createEntry).toHaveBeenCalledTimes(1);
  });

  it("retentativa com rascunho existente confirma o MESMO id, sem novo create/upload", async () => {
    const ctx = setup({
      existingDraft: DRAFT,
      storedDocuments: { documentStorageId: "storage-danfe" },
    });

    const result = await runEntryImport(ctx.input);

    expect(result.status).toBe("confirmed");
    expect(ctx.createEntry).not.toHaveBeenCalled();
    expect(ctx.uploadDocument).not.toHaveBeenCalled();
    expect(ctx.uploadXml).not.toHaveBeenCalled();
    expect(ctx.confirmEntry).toHaveBeenCalledWith(DRAFT.entryId);
  });

  it("arquivo já armazenado não é reenviado quando o create falhou", async () => {
    const ctx = setup({ storedDocuments: { documentStorageId: "storage-danfe" } });

    const result = await runEntryImport(ctx.input);

    expect(ctx.uploadDocument).not.toHaveBeenCalled();
    // sem xmlFile informado, só o documento já guardado é reaproveitado
    expect(ctx.uploadXml).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("confirmed");
  });

  it("falha de upload não impede a entrada e é reportada como etapa própria", async () => {
    const ctx = setup();
    ctx.uploadDocument.mockRejectedValueOnce(new Error("quota"));
    ctx.uploadXml.mockRejectedValueOnce(new Error("timeout"));

    const result = await runEntryImport(ctx.input);

    expect(result.status).toBe("confirmed");
    expect(result.warnings.map((warning) => warning.stage)).toEqual([
      "upload-document",
      "upload-xml",
    ]);
    expect(ctx.createEntry).toHaveBeenCalledTimes(1);
  });

  it("falha de criação é distinta de falha de confirmação", async () => {
    const ctx = setup();
    ctx.createEntry.mockRejectedValueOnce(new Error("Esta NF-e já foi registrada"));

    const result = await runEntryImport(ctx.input);

    expect(result.status).toBe("create-failed");
    if (result.status !== "create-failed") return;
    expect(result.createError).toContain("já foi registrada");
    expect(result.storedDocuments.documentStorageId).toBe("storage-danfe");
    expect(ctx.confirmEntry).not.toHaveBeenCalled();
  });

  it("estado persistido só vale como fallback de reentrada", async () => {
    const ctx = setup({
      destination: null,
      destinationState: { materialType: "consumption", areaId: "area-2" },
    });

    const result = await runEntryImport(ctx.input);

    expect(result.status).toBe("confirmed");
    const payload = ctx.createEntry.mock.calls[0][0] as any;
    expect(payload.materialType).toBe("consumption");
    expect(payload.areaId).toBe("area-2");
  });
});

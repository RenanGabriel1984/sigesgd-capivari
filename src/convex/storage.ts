import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requirePermission } from "./rbac";

/**
 * Gestão de Estoque SGGD — ARMAZENAMENTO DE DOCUMENTOS.
 *
 * ─── Hardening §16 ──────────────────────────────────────────────────────────
 * CONTEXTUALIZAÇÃO (o que JÁ estava correto):
 *  • Todas as funções exigem sessão autenticada com um perfil SIGESGD válido
 *    (`stock.view`). Identidades anônimas e sem `role` são recusadas por
 *    `requirePermission` (fail closed, B-01).
 *  • Os arquivos NÃO são servidos pela origem do SIGESGD: o Convex Storage
 *    emite URLs em seu próprio domínio. Um HTML/SVG malicioso enviado por
 *    upload, portanto, NÃO executa script na origem da aplicação — não há
 *    XSS armazenado no origin.
 *
 * LIMITE RESIDUAL DOCUMENTADO (não corrigível sem migration de dados):
 *  `getUrl` resolve QUALQUER `storageId` do deployment a partir do valor
 *  recebido do cliente. Não existe vínculo servidor entre o arquivo e a
 *  entidade dona (entrada, produto, ativo), porque hoje nenhum documento é
 *  referenciado por `storageId` no backend — o vínculo existe apenas no
 *  estado do navegador. Criar esse vínculo exigiria uma migration que
 *  associaria cada `storageId` já gravado à sua entrada/produto, o que
 *  estava FORA do escopo desta rodada ("não alterar documentos").
 *
 *  Mitigações em vigor: os IDs do Convex Storage são tokens opacos de alta
 *  entropia (não enumeráveis) e a URL assinada é servida de outro domínio,
 *  sem cookies do SIGESGD.
 *
 *  W-05 (melhoria futura): registrar `storageId → entidade` no banco e exigir
 *  permissão sobre a entidade dona antes de resolver a URL.
 */

/** Limite de IDs resolvidos em uma única chamada em lote (evita abuso). */
const MAX_URLS_PER_CALL = 50;

/** Formato esperado de um ID do Convex Storage (base64url). */
const STORAGE_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

function assertValidStorageId(storageId: unknown): string {
  if (typeof storageId !== "string" || !STORAGE_ID_PATTERN.test(storageId)) {
    throw new Error("Identificador de arquivo inválido.");
  }
  return storageId;
}

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    // RBAC central: upload exige sessão com visão de estoque (XML, DANFE, fotos).
    //
    // NOTA: a validação de tamanho (10 MB) e de tipo (`accept`) existe apenas
    // no cliente e é apenas uma conveniência de UX. O Convex Storage emite a
    // URL de upload diretamente ao navegador e não permite impor MIME/extensão
    // no lado do servidor; por isso, nenhum envio é considerado confiável e
    // nenhum arquivo é executado na origem do app. W-05 pendente: validar o
    // tipo no consumo (download) em vez de no envio.
    await requirePermission(ctx, "stock.view");
    return await ctx.storage.generateUploadUrl();
  },
});

export const getUrl = query({
  args: { storageId: v.string() },
  handler: async (ctx, args) => {
    // RBAC central: documentos/fotos são internos — exige visão de estoque.
    await requirePermission(ctx, "stock.view");
    const storageId = assertValidStorageId(args.storageId);
    const url = await ctx.storage.getUrl(storageId as any);
    return url;
  },
});

export const getUrls = query({
  args: { storageIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    // RBAC central: documentos/fotos são internos — exige visão de estoque.
    await requirePermission(ctx, "stock.view");
    if (args.storageIds.length > MAX_URLS_PER_CALL) {
      throw new Error(
        `Máximo de ${MAX_URLS_PER_CALL} arquivos por chamada. Solicite em lotes.`,
      );
    }
    const urls: Record<string, string | null> = {};
    for (const raw of args.storageIds) {
      const id = assertValidStorageId(raw);
      urls[id] = await ctx.storage.getUrl(id as any);
    }
    return urls;
  },
});

/**
 * Confirma que a sessão autenticada corresponde a um usuário SIGESGD ativo com
 * perfil válido — used by `FileUpload` before requesting an upload URL.
 * Não devolve dados do usuário.
 */
export const canUpload = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { allowed: false, reason: "unauthenticated" };
    const user = await ctx.db.get(userId);
    if (!user || user.active === false) {
      return { allowed: false, reason: "inactive" };
    }
    if ((user as { isAnonymous?: boolean }).isAnonymous === true) {
      return { allowed: false, reason: "anonymous" };
    }
    if (!user.role) return { allowed: false, reason: "no-role" };
    return { allowed: true };
  },
});
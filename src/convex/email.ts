import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { action, internalAction, internalQuery, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { roleHasPermission, type AppRole } from "../lib/rbac";
import { generateSecureNumericCode, hashResetCode, verifyPassword } from "./auth/passwords";

/**
 * Gestão de Estoque SGGD — Transporte de e-mail.
 *
 * ─── Hardening B-07 (segredos) ───────────────────────────────────────────────
 * A credencial do serviço de e-mail NÃO vive mais no código-fonte. Ela é lida
 * de `FREEBUFF_EMAIL_API_KEY` (variável de ambiente/secret do deployment).
 *
 * A chave que estava versionada (`fb_email_...`) deve ser considerada
 * COMPROMETIDA e ROTACIONADA no provedor. Sem a variável configurada, o
 * envio falha FECHADO: nenhuma requisição sai, nenhum segredo é escrito em
 * log e nenhum dado do usuário vaza.
 *
 * ─── Recuperação de senha ───────────────────────────────────────────────────
 * (`passwords.requestPasswordReset`)
 *  - a mutation agenda esta ação INTERNA passando apenas o `resetId`;
 *  - esta ação gera o código em memória, deriva um hash PBKDF2 com salt
 *    aleatório e persiste somente hash/salt em `passwordResets`;
 *  - o código em texto segue diretamente ao provedor de e-mail, sem ser
 *    gravado na tabela, no payload agendado, em resposta pública ou em logs;
 *  - se o registro já foi consumido (`usedAt`), expirou ou esgotou as
 *    tentativas, nada é enviado.
 */

const SEND_OTP_ENDPOINT = "https://auth.freebuff.app/send_otp";

/** Escape dynamic values before embedding them in transactional HTML. */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

/** Nome da variável de ambiente que guarda a chave do serviço de e-mail. */
export const EMAIL_API_KEY_ENV = "FREEBUFF_EMAIL_API_KEY";
export const RESEND_API_KEY_ENV = "RESEND_API_KEY";

/**
 * Lê uma credencial de e-mail do ambiente. Ausente/vazia ⇒ `null` (falha fechada).
 * O valor NUNCA é retornado, logado ou incluído em mensagens de erro.
 */
function readEmailApiKey(): string | null {
  const key = process.env[EMAIL_API_KEY_ENV];
  return typeof key === "string" && key.trim().length > 0 ? key.trim() : null;
}

/** Resend is a separate provider and must use its own API credential. */
function readResendApiKey(): string | null {
  const key = process.env[RESEND_API_KEY_ENV];
  return typeof key === "string" && key.trim().length > 0 ? key.trim() : null;
}

/**
 * Envia o e-mail transacional (recuperação de senha).
 *
 * Usa `fetch` nativo das actions do Convex — nenhum segredo é escrito no
 * bundle do frontend (este módulo é exclusivamente backend).
 */
async function sendOtpEmail(to: string, otp: string): Promise<void> {
  const apiKey = readEmailApiKey();
  if (!apiKey) {
    // Falha fechada: sem credencial não há envio e não há log de conteúdo.
    throw new Error(`email_not_configured:${EMAIL_API_KEY_ENV}`);
  }
  const response = await fetch(SEND_OTP_ENDPOINT, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to,
      otp,
      appName: process.env.VLY_APP_NAME || "a freebuff.com application",
    }),
  });
  if (!response.ok) {
    // Nunca incluir corpo/código do fornecedor no erro (evita vazar dados).
    throw new Error(`send_otp_failed_${response.status}`);
  }
}

/**
 * Lê, no servidor, o e-mail do usuário e o código do reset indicado.
 * Retorna null se o registro não existir, já foi usado, expirou ou esgotou
 * as tentativas — nesses casos o e-mail NÃO é enviado (e nada vaza).
 */
export const getPasswordResetForEmailInternal = internalQuery({
  args: { resetId: v.id("passwordResets") },
  handler: async (ctx, args) => {
    const reset = await ctx.db.get(args.resetId);
    if (!reset) return null;
    if (reset.usedAt) return null;
    if (reset.expiresAt <= Date.now()) return null;
    if ((reset.attempts ?? 0) >= 5) return null;

    const user = await ctx.db.get(reset.userId);
    if (!user?.email || user.active === false) return null;
    // B-01: identidade anônima ou sem perfil válido nunca recebe recuperação.
    if ((user as { isAnonymous?: boolean }).isAnonymous === true) return null;
    if (!roleHasPermission(user.role as AppRole, "settings.view")) return null;

    return { email: user.email };
  },
});

/**
 * Ação interna agendada por `passwords.requestPasswordReset`.
 * Envia o código de recuperação pelo mesmo serviço do SIGESGD. Nunca loga o
 * código — apenas metadados de erro.
 */
export const sendPasswordResetEmailInternal = internalAction({
  args: { resetId: v.id("passwordResets") },
  handler: async (ctx, args) => {
    const payload = await ctx.runQuery(internal.email.getPasswordResetForEmailInternal, {
      resetId: args.resetId,
    });

    if (!payload) {
      console.error(
        "[Estoque SGGD] Recuperação: registro de reset inexistente/consumido/expirado — e-mail não enviado.",
      );
      return { sent: false, reason: "reset-not-found" };
    }

    // Generate the OTP inside this internal action. It exists only in memory
    // and is passed to an internal mutation as a salted hash, never as a DB value.
    const code = generateSecureNumericCode();
    const { hash, salt } = await hashResetCode(code);
    const stored = await ctx.runMutation(
      internal.passwords.storePasswordResetHashInternal,
      { resetId: args.resetId, tokenHash: hash, tokenSalt: salt },
    );
    if (!stored) {
      return { sent: false, reason: "reset-not-active" };
    }

    try {
      await sendOtpEmail(payload.email, code);
      return { sent: true };
    } catch (error: any) {
      // Invalidate the code if delivery fails; never log the code or payload.
      await ctx.runMutation(
        internal.passwords.invalidatePasswordResetInternal,
        { resetId: args.resetId },
      );
      console.error(
        "[Estoque SGGD] Falha no envio do e-mail de recuperação:",
        error?.response?.status ?? error?.code ?? error?.message ?? "erro-desconhecido",
      );
      return { sent: false, reason: "send-failed" };
    }
  },
});

/**
 * Confere a identidade administrativa e o destinatário antes do envio.
 * O hash da senha temporária é retornado somente à action interna para
 * validação; nunca é exposto ao cliente.
 */
export const getFirstAccessRecipientInternal = internalQuery({
  args: {
    adminUserId: v.id("users"),
    to: v.string(),
  },
  handler: async (ctx, args) => {
    const admin = await ctx.db.get(args.adminUserId);
    if (
      !admin ||
      admin.active === false ||
      (admin as { isAnonymous?: boolean }).isAnonymous === true ||
      !roleHasPermission(admin.role as AppRole, "users.manage")
    ) {
      throw new Error("Acesso negado.");
    }

    const to = args.to.trim().toLowerCase();
    if (!to) throw new Error("E-mail do destinatário é obrigatório");

    const target = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", to))
      .first();
    if (!target || target.active === false) {
      throw new Error("Destinatário não encontrado ou inativo.");
    }
    if (
      (target as { isAnonymous?: boolean }).isAnonymous === true ||
      !roleHasPermission(target.role as AppRole, "settings.view") ||
      target.requiresPasswordReset !== true
    ) {
      throw new Error("Usuário sem primeiro acesso pendente.");
    }

    const passwordRecord = await ctx.db
      .query("passwords")
      .withIndex("by_user", (q) => q.eq("userId", target._id))
      .first();
    if (!passwordRecord || passwordRecord.requiresReset !== true) {
      throw new Error("Credencial temporária não encontrada.");
    }

    return {
      userId: target._id,
      email: target.email ?? to,
      name: target.name ?? "Servidor",
      passwordHash: passwordRecord.passwordHash,
      salt: passwordRecord.salt,
    };
  },
});

/** Registra somente metadados do envio; nunca registra a senha temporária. */
export const recordFirstAccessEmailAuditInternal = internalMutation({
  args: {
    adminUserId: v.id("users"),
    targetUserId: v.id("users"),
    delivered: v.boolean(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const target = await ctx.db.get(args.targetUserId);
    await ctx.db.insert("auditLogs", {
      userId: args.adminUserId,
      action: "create",
      entity: "passwords",
      entityId: args.targetUserId,
      details: args.delivered
        ? `Acesso inicial enviado para "${target?.name ?? String(args.targetUserId)}" pelo administrador.`
        : `Envio de acesso inicial para "${target?.name ?? String(args.targetUserId)}" não realizado: ${args.reason ?? "falha no envio"}.`,
      timestamp: Date.now(),
    });
    return true;
  },
});

/**
 * Envia a senha temporária em uma ACTION (mutations Convex não podem fazer
 * chamadas HTTP). A identidade do administrador é obtida da sessão autenticada
 * e o destinatário/senha são conferidos no backend antes do envio.
 */
export const sendFirstAccessEmail = action({
  args: {
    to: v.string(),
    name: v.optional(v.string()),
    temporaryPassword: v.string(),
  },
  handler: async (ctx, args) => {
    const adminId = await getAuthUserId(ctx);
    if (!adminId) throw new Error("Não autenticado");

    const to = args.to.trim().toLowerCase();
    if (!to) throw new Error("E-mail do destinatário é obrigatório");
    if (args.temporaryPassword.length < 8 || args.temporaryPassword.length > 200) {
      throw new Error("Senha temporária inválida.");
    }

    const target = await ctx.runQuery(internal.email.getFirstAccessRecipientInternal, {
      adminUserId: adminId,
      to,
    });
    const passwordMatches = await verifyPassword(
      args.temporaryPassword,
      target.passwordHash,
      target.salt,
    );
    if (!passwordMatches) {
      throw new Error("A senha temporária informada não corresponde à credencial atual.");
    }

    const apiKey = readResendApiKey();
    const fromEmail =
      process.env.EMAIL_FROM || "Gestão de Estoque SGGD <noreply@capivari.sp.gov.br>";

    if (!apiKey) {
      await ctx.runMutation(internal.email.recordFirstAccessEmailAuditInternal, {
        adminUserId: adminId,
        targetUserId: target.userId,
        delivered: false,
        reason: `serviço de primeiro acesso não configurado (${RESEND_API_KEY_ENV})`,
      });
      throw new Error(
        `Serviço de primeiro acesso não configurado (${RESEND_API_KEY_ENV}). Configure a credencial Resend antes de enviar acessos iniciais.`,
      );
    }

    const safeName = target.name || args.name?.trim() || "Servidor";
    const htmlSafeName = escapeHtml(safeName);
    const htmlSafeTemporaryPassword = escapeHtml(args.temporaryPassword);

    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [target.email],
          subject: "Bem-vindo ao Gestão de Estoque SGGD — Acesso Inicial",
          html: `
            <!DOCTYPE html>
            <html>
            <head><meta charset="utf-8"></head>
            <body style="margin:0;padding:0;background-color:#f8faf9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
              <div style="max-width:480px;margin:0 auto;padding:32px 16px;">
                <div style="text-align:center;margin-bottom:24px;">
                  <div style="display:inline-block;background:#1a5632;color:white;font-weight:bold;font-size:14px;padding:8px 12px;border-radius:8px;">SG</div>
                </div>
                <h1 style="color:#1a5632;font-size:18px;text-align:center;">Bem-vindo, ${htmlSafeName}!</h1>
                <div style="background:white;border:1px solid #e5e7eb;border-radius:12px;padding:24px;margin:24px 0;">
                  <p style="color:#444;font-size:14px;line-height:1.5;">
                    Você foi cadastrado no sistema <strong>Gestão de Estoque SGGD</strong> — Secretaria de Gestão e Governo Digital.
                  </p>
                  <p style="color:#444;font-size:14px;line-height:1.5;margin-top:12px;">
                    <strong>Senha temporária:</strong>
                  </p>
                  <div style="text-align:center;margin:16px 0;">
                    <span style="display:inline-block;background:#fff7ed;border:2px solid #C8A84E;border-radius:8px;padding:12px 24px;font-size:20px;font-weight:bold;letter-spacing:3px;color:#8B6914;font-family:monospace;">
                      ${htmlSafeTemporaryPassword}
                    </span>
                  </div>
                  <p style="color:#888;font-size:12px;text-align:center;">
                    Ao fazer login pela primeira vez, você será obrigado a criar uma nova senha pessoal.
                  </p>
                </div>
                <div style="text-align:center;margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;">
                  <p style="color:#bbb;font-size:10px;">
                    Prefeitura Municipal de Capivari — SP<br>
                    Secretaria de Gestão e Governo Digital
                  </p>
                </div>
              </div>
            </body>
            </html>
          `,
          text: `Bem-vindo ao Gestão de Estoque SGGD!\n\nOlá ${safeName},\n\nVocê foi cadastrado no sistema Gestão de Estoque SGGD.\n\nSenha temporária: ${args.temporaryPassword}\n\nAo fazer login pela primeira vez, você será obrigado a criar uma nova senha pessoal.\n\nPrefeitura Municipal de Capivari — SP`,
        }),
      });

      if (!response.ok) {
        throw new Error(`provider-status-${response.status}`);
      }

      await ctx.runMutation(internal.email.recordFirstAccessEmailAuditInternal, {
        adminUserId: adminId,
        targetUserId: target.userId,
        delivered: true,
      });
      return { sent: true };
    } catch (error) {
      const reason =
        error instanceof Error && /^provider-status-\d+$/.test(error.message)
          ? `falha no provedor (${error.message.slice("provider-status-".length)})`
          : "falha no envio";
      await ctx.runMutation(internal.email.recordFirstAccessEmailAuditInternal, {
        adminUserId: adminId,
        targetUserId: target.userId,
        delivered: false,
        reason,
      });
      console.error("[Estoque SGGD] Falha no envio de acesso inicial.");
      throw new Error("Não foi possível enviar o e-mail de acesso inicial.");
    }
  },
});

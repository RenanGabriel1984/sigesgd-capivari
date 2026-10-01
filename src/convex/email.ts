import { v } from "convex/values";
import { action, internalAction, internalQuery, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { requirePermission } from "./rbac";

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
 *  - o código numérico de 6 dígitos continua sendo gerado e gravado em
 *    `passwordResets` (token, expiresAt 15 min, usedAt, attempts, userId);
 *  - a mutation agenda esta ação INTERNA passando apenas o `resetId`;
 *  - o código é lido AQUI, no servidor, direto da tabela `passwordResets`
 *    — nunca trafega em args públicos, não é retornado pela mutation e
 *    não é impresso em logs de produção;
 *  - se o registro já foi consumido (`usedAt`), expirou ou esgotou as
 *    tentativas, nada é enviado.
 */

const SEND_OTP_ENDPOINT = "https://auth.freebuff.app/send_otp";

/** Nome da variável de ambiente que guarda a chave do serviço de e-mail. */
export const EMAIL_API_KEY_ENV = "FREEBUFF_EMAIL_API_KEY";

/**
 * Lê a credencial do ambiente. Ausente/vazia ⇒ `null` (falha fechada).
 * O valor NUNCA é retornado, logado ou incluído em mensagens de erro.
 */
function readEmailApiKey(): string | null {
  const key = process.env[EMAIL_API_KEY_ENV];
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
    if (!user?.email) return null;
    // B-01: identidade anônima ou sem perfil válido nunca recebe recuperação.
    if ((user as { isAnonymous?: boolean }).isAnonymous === true) return null;
    if (!user.role) return null;

    return { email: user.email, code: reset.token };
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

    try {
      await sendOtpEmail(payload.email, payload.code);
      return { sent: true };
    } catch (error: any) {
      // NUNCA logar o código nem o corpo do erro (poderia conter dados sensíveis).
      console.error(
        "[Estoque SGGD] Falha no envio do e-mail de recuperação:",
        error?.response?.status ?? error?.code ?? error?.message ?? "erro-desconhecido",
      );
      return { sent: false, reason: "send-failed" };
    }
  },
});

/**
 * E-mail de primeiro acesso com senha temporária.
 *
 * Hardening B-06: antes isto era uma ACTION PÚBLICA sem autenticação que
 * aceitava destinatário e conteúdo ARBITRÁRIOS — um relay de e-mail aberto
 * usando a identidade do município, e que escrevia a senha temporária em
 * `console.log` quando o serviço não estava configurado.
 *
 * Agora:
 *  - é uma MUTATION protegida por `users.manage` (admin/secretary);
 *  - o destinatário (`to`) DEVE corresponder ao e-mail de um usuário SIGESGD
 *    existente e ativo — não há envio para destinatário arbitrário;
 *  - a senha temporária NUNCA é logada, nunca aparece em exceção, nunca é
 *    devolvida ao cliente e nunca é gravada em `auditLogs`;
 *  - a operação é auditada apenas com identificadores (usuário e e-mail).
 */
export const sendFirstAccessEmail = mutation({
  args: {
    to: v.string(),
    name: v.optional(v.string()),
    temporaryPassword: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId: adminId } = await requirePermission(ctx, "users.manage", {
      entity: "users",
    });

    const to = args.to.trim().toLowerCase();
    if (!to) throw new Error("E-mail do destinatário é obrigatório");

    // O destinatário precisa ser um usuário real do SIGESGD.
    const target = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", to))
      .first();
    if (!target) {
      throw new Error(
        "E-mail não pertence a nenhum usuário cadastrado. Crie o usuário antes de enviar o acesso inicial.",
      );
    }
    if (target.active === false) {
      throw new Error("Não é possível enviar acesso inicial para usuário inativo.");
    }
    if ((target as { isAnonymous?: boolean }).isAnonymous === true || !target.role) {
      throw new Error("Usuário sem perfil de acesso válido no SIGESGD.");
    }

    const apiKey = readEmailApiKey();
    const fromEmail =
      process.env.EMAIL_FROM || "Gestão de Estoque SGGD <noreply@capivari.sp.gov.br>";

    if (!apiKey) {
      // Sem credencial: nada é enviado e a senha temporária NÃO é logada.
      await ctx.db.insert("auditLogs", {
        userId: adminId,
        action: "create",
        entity: "passwords",
        entityId: target._id,
        details:
          `Envio de acesso inicial para "${target.name ?? to}" NÃO realizado: ` +
          `serviço de e-mail não configurado (${EMAIL_API_KEY_ENV}).`,
        timestamp: Date.now(),
      });
      throw new Error(
        `Serviço de e-mail não configurado (${EMAIL_API_KEY_ENV}). Configure a credencial antes de enviar acessos iniciais.`,
      );
    }

    const displayName = (args.name ?? target.name ?? "").toString();
    const safeName = displayName || target.name || "Servidor";

    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [to],
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
                <h1 style="color:#1a5632;font-size:18px;text-align:center;">Bem-vindo, ${safeName}!</h1>

                <div style="background:white;border:1px solid #e5e7eb;border-radius:12px;padding:24px;margin:24px 0;">
                  <p style="color:#444;font-size:14px;line-height:1.5;">
                    Você foi cadastrado no sistema <strong>Gestão de Estoque SGGD</strong> — Secretaria de Gestão e Governo Digital.
                  </p>
                  <p style="color:#444;font-size:14px;line-height:1.5;margin-top:12px;">
                    <strong>Senha temporária:</strong>
                  </p>
                  <div style="text-align:center;margin:16px 0;">
                    <span style="display:inline-block;background:#fff7ed;border:2px solid #C8A84E;border-radius:8px;padding:12px 24px;font-size:20px;font-weight:bold;letter-spacing:3px;color:#8B6914;font-family:monospace;">
                      ${args.temporaryPassword}
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
        // Somente status — nunca o corpo (pode conter conteúdo do fornecedor).
        console.error(`[Estoque SGGD] Envio de acesso inicial falhou: status ${response.status}`);
        throw new Error(`Falha no envio do e-mail de acesso inicial (status ${response.status}).`);
      }

      await ctx.db.insert("auditLogs", {
        userId: adminId,
        action: "create",
        entity: "passwords",
        entityId: target._id,
        details: `Acesso inicial enviado para "${target.name ?? to}" pelo administrador.`,
        timestamp: Date.now(),
      });

      return { sent: true };
    } catch (error: any) {
      // Sem credencial, corpo do fornecedor ou qualquer senha temporária.
      console.error(
        "[Estoque SGGD] Erro no envio do e-mail de acesso inicial:",
        error?.message ?? "erro-desconhecido",
      );
      throw new Error("Não foi possível enviar o e-mail de acesso inicial.");
    }
  },
});
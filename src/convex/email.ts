import { v } from "convex/values";
import { action, internalAction, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";

/**
 * Gestão de Estoque SGGD — Transporte de e-mail.
 *
 * Reutiliza EXATAMENTE o mesmo serviço de envio já funcional no projeto,
 * usado pelo provedor de OTP em `convex/auth/emailOtp.ts`:
 *   POST https://auth.freebuff.app/send_otp   (header x-api-key)
 *
 * Recuperação de senha (`passwords.requestPasswordReset`):
 *   - o código numérico de 6 dígitos continua sendo gerado e gravado em
 *     `passwordResets` (token, expiresAt 15 min, usedAt, userId);
 *   - a mutation agenda esta ação INTERNA passando apenas o `resetId`;
 *   - o código é lido AQUI, no servidor, direto da tabela `passwordResets`
 *     — nunca trafega em args públicos, não é retornado pela mutation e
 *     não é impresso em logs de produção;
 *   - se o registro já foi consumido (`usedAt`) ou expirou, nada é enviado.
 *
 * Este módulo NÃO depende de RESEND_API_KEY.
 */

const SEND_OTP_ENDPOINT = "https://auth.freebuff.app/send_otp";

/** Mesmo endpoint/payload/headers do transporte funcional de `auth/emailOtp.ts`.
 *  Usa fetch (nativo nas actions do Convex) em vez de axios — a chamada HTTP
 *  é idêntica (mesmo endpoint, mesmo corpo, mesmo header x-api-key).
 */
async function sendOtpEmail(to: string, otp: string): Promise<void> {
  const response = await fetch(SEND_OTP_ENDPOINT, {
    method: "POST",
    headers: {
      "x-api-key": "fb_email_2crN1hqIArZP2bEfvjp5Qik4",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to,
      otp,
      appName: process.env.VLY_APP_NAME || "a freebuff.com application",
    }),
  });
  if (!response.ok) {
    // Nunca incluir corpo/código no erro (evita vazar dados em logs).
    throw new Error(`send_otp_failed_${response.status}`);
  }
}

/**
 * Lê, no servidor, o e-mail do usuário e o código do reset indicado.
 * Retorna null se o registro não existir, já foi usado ou expirou —
 * nesses casos o e-mail NÃO é enviado (e nada vaza).
 */
export const getPasswordResetForEmailInternal = internalQuery({
  args: { resetId: v.id("passwordResets") },
  handler: async (ctx, args) => {
    const reset = await ctx.db.get(args.resetId);
    if (!reset) return null;
    if (reset.usedAt) return null;
    if (reset.expiresAt <= Date.now()) return null;

    const user = await ctx.db.get(reset.userId);
    if (!user?.email) return null;

    return { email: user.email, code: reset.token };
  },
});

/**
 * Ação interna agendada por `passwords.requestPasswordReset`.
 * Envia o código de recuperação pelo mesmo serviço do Freebuff usado
 * pelo OTP de autenticação. Nunca loga o código — apenas metadados de erro.
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
        error?.response?.status ?? error?.code ?? "erro-desconhecido",
      );
      return { sent: false, reason: "send-failed" };
    }
  },
});

/**
 * Send first-access welcome email with temporary password.
 * (Fluxo legado: permanece dependente de RESEND_API_KEY e não é usado
 * pelo fluxo de recuperação de senha.)
 */
export const sendFirstAccessEmail = action({
  args: {
    to: v.string(),
    name: v.string(),
    temporaryPassword: v.string(),
  },
  handler: async (ctx, args) => {
    const apiKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.EMAIL_FROM || "Gestão de Estoque SGGD <noreply@capivari.sp.gov.br>";

    if (!apiKey) {
      console.log(
        `[Estoque SGGD] First access for ${args.to}: temp password = ${args.temporaryPassword} ` +
        `(Email not sent — RESEND_API_KEY not configured)`
      );
      return { sent: false, reason: "Email service not configured" };
    }

    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [args.to],
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
                <h1 style="color:#1a5632;font-size:18px;text-align:center;">Bem-vindo, ${args.name}!</h1>

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
          text: `Bem-vindo ao Gestão de Estoque SGGD!\n\nOlá ${args.name},\n\nVocê foi cadastrado no sistema Gestão de Estoque SGGD.\n\nSenha temporária: ${args.temporaryPassword}\n\nAo fazer login pela primeira vez, você será obrigado a criar uma nova senha pessoal.\n\nPrefeitura Municipal de Capivari — SP`,
        }),
      });

      if (!response.ok) {
        const errorData = await response.text();
        console.error(`[Estoque SGGD] Welcome email failed: ${response.status} ${errorData}`);
        return { sent: false, reason: `Email API error: ${response.status}` };
      }

      const result = await response.json();
      return { sent: true, id: result.id };
    } catch (error: any) {
      console.error(`[Estoque SGGD] Welcome email error:`, error.message);
      return { sent: false, reason: error.message };
    }
  },
});

import { action } from "./_generated/server";
import { v } from "convex/values";

/**
 * Send a password reset email via Resend API.
 *
 * Required environment variables (set in Convex Dashboard → Settings → Environment Variables):
 *   RESEND_API_KEY   — Resend API key (https://resend.com)
 *   EMAIL_FROM       — Sender email (must be verified in Resend, e.g. "noreply@capivari.sp.gov.br")
 *
 * If the variables are not configured, the email is skipped (no error thrown).
 * The code is still logged server-side for development/debugging.
 */
export const sendPasswordResetEmail = action({
  args: {
    to: v.string(),
    code: v.string(),
  },
  handler: async (ctx, args) => {
    const apiKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.EMAIL_FROM || "SIGESGD <noreply@capivari.sp.gov.br>";

    if (!apiKey) {
      console.log(
        `[SIGESGD] Password reset code for ${args.to}: ${args.code} ` +
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
          subject: "Recuperação de Senha — SIGESGD Capivari",
          html: `
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
            </head>
            <body style="margin:0;padding:0;background-color:#f8faf9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
              <div style="max-width:480px;margin:0 auto;padding:32px 16px;">
                <div style="text-align:center;margin-bottom:24px;">
                  <div style="display:inline-block;background:#1a5632;color:white;font-weight:bold;font-size:14px;padding:8px 12px;border-radius:8px;">SG</div>
                </div>
                <h1 style="color:#1a5632;font-size:18px;text-align:center;margin-bottom:8px;">SIGESGD Capivari</h1>
                <p style="color:#666;font-size:13px;text-align:center;margin-bottom:24px;">Sistema Integrado de Gestão</p>

                <div style="background:white;border:1px solid #e5e7eb;border-radius:12px;padding:24px;margin-bottom:24px;">
                  <h2 style="color:#1a5632;font-size:16px;margin-bottom:12px;">Recuperação de Senha</h2>
                  <p style="color:#444;font-size:14px;line-height:1.5;margin-bottom:16px;">
                    Você solicitou a recuperação da sua senha. Utilize o código abaixo para redefinir:
                  </p>
                  <div style="text-align:center;margin:20px 0;">
                    <span style="display:inline-block;background:#f0f7f2;border:2px solid #1a5632;border-radius:8px;padding:12px 24px;font-size:28px;font-weight:bold;letter-spacing:6px;color:#1a5632;font-family:monospace;">
                      ${args.code}
                    </span>
                  </div>
                  <p style="color:#888;font-size:12px;text-align:center;margin-top:16px;">
                    Este código expira em <strong>15 minutos</strong> e pode ser utilizado apenas uma vez.
                  </p>
                </div>

                <p style="color:#999;font-size:11px;text-align:center;line-height:1.5;">
                  Se você não solicitou esta recuperação, ignore este e-mail.<br>
                  Nunca compartilhe este código com terceiros.
                </p>

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
          text: `SIGESGD Capivari — Recuperação de Senha\n\nSeu código de recuperação: ${args.code}\n\nEste código expira em 15 minutos e pode ser utilizado apenas uma vez.\n\nSe você não solicitou esta recuperação, ignore este e-mail.\n\nPrefeitura Municipal de Capivari — SP`,
        }),
      });

      if (!response.ok) {
        const errorData = await response.text();
        console.error(`[SIGESGD] Email send failed: ${response.status} ${errorData}`);
        return { sent: false, reason: `Email API error: ${response.status}` };
      }

      const result = await response.json();
      return { sent: true, id: result.id };
    } catch (error: any) {
      console.error(`[SIGESGD] Email send error:`, error.message);
      return { sent: false, reason: error.message };
    }
  },
});

/**
 * Send first-access welcome email with temporary password.
 */
export const sendFirstAccessEmail = action({
  args: {
    to: v.string(),
    name: v.string(),
    temporaryPassword: v.string(),
  },
  handler: async (ctx, args) => {
    const apiKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.EMAIL_FROM || "SIGESGD <noreply@capivari.sp.gov.br>";

    if (!apiKey) {
      console.log(
        `[SIGESGD] First access for ${args.to}: temp password = ${args.temporaryPassword} ` +
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
          subject: "Bem-vindo ao SIGESGD Capivari — Acesso Inicial",
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
                    Você foi cadastrado no <strong>SIGESGD Capivari</strong> — Sistema Integrado de Gestão da Secretaria de Gestão e Governo Digital.
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
          text: `Bem-vindo ao SIGESGD Capivari!\n\nOlá ${args.name},\n\nVocê foi cadastrado no SIGESGD Capivari.\n\nSenha temporária: ${args.temporaryPassword}\n\nAo fazer login pela primeira vez, você será obrigado a criar uma nova senha pessoal.\n\nPrefeitura Municipal de Capivari — SP`,
        }),
      });

      if (!response.ok) {
        const errorData = await response.text();
        console.error(`[SIGESGD] Welcome email failed: ${response.status} ${errorData}`);
        return { sent: false, reason: `Email API error: ${response.status}` };
      }

      const result = await response.json();
      return { sent: true, id: result.id };
    } catch (error: any) {
      console.error(`[SIGESGD] Welcome email error:`, error.message);
      return { sent: false, reason: error.message };
    }
  },
});

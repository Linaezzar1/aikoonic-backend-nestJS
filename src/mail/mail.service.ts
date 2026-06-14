import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  private get frontendUrl(): string {
    // FRONTEND_URL may accidentally hold a comma-separated list — take the first.
    const raw = process.env.FRONTEND_URL ?? 'https://aikoonic.codes';
    return raw.split(',')[0].trim().replace(/\/$/, '');
  }

  private buildHtml(content: string): string {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; padding: 20px; border-radius: 8px;">
        <h2 style="color: #01696f; margin-bottom: 20px; text-transform: uppercase; font-weight: 800;">
          AIKOONIC CRM
        </h2>
        <p style="font-size: 16px; color: #374151; line-height: 1.6; margin-bottom: 30px;">
          ${content}
        </p>
        <hr style="border: 0; border-top: 1px solid #f3f4f6; margin-bottom: 20px;" />
        <p style="font-size: 12px; color: #9ca3af;">
          Envoyé automatiquement par AIKOONIC Workflows
        </p>
      </div>
    `;
  }

  /**
   * Pro, brand-styled email confirming a new account. Uses table layout +
   * inline styles (the only reliable way to render consistently across email
   * clients). The logo is referenced by absolute URL on the public frontend.
   */
  private buildVerificationHtml(verifyUrl: string, firstName?: string | null): string {
    const greeting = firstName ? `Bonjour ${firstName},` : 'Bonjour,';
    const logoUrl = `${this.frontendUrl}/logo.png`;
    return `
<!doctype html>
<html lang="fr">
  <body style="margin:0;padding:0;background:#f4f1fb;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1fb;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 10px 40px rgba(45,27,158,0.12);">
            <!-- Header band -->
            <tr>
              <td style="background:linear-gradient(135deg,#7c3aed,#c026d3);padding:28px 32px;text-align:center;">
                <img src="${logoUrl}" alt="AI-KOONIC" height="34" style="height:34px;width:auto;filter:brightness(0) invert(1);" />
              </td>
            </tr>
            <!-- Body -->
            <tr>
              <td style="padding:36px 36px 8px;">
                <h1 style="margin:0 0 14px;font-family:Arial,sans-serif;font-size:22px;font-weight:800;color:#160d35;">
                  Confirmez votre adresse email
                </h1>
                <p style="margin:0 0 10px;font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#4b5563;">
                  ${greeting}
                </p>
                <p style="margin:0 0 26px;font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#4b5563;">
                  Bienvenue sur <strong>AI-KOONIC</strong> ! Il ne reste qu'une étape :
                  confirmez votre email pour activer votre compte et accéder à votre
                  équipe marketing IA.
                </p>
              </td>
            </tr>
            <!-- CTA -->
            <tr>
              <td align="center" style="padding:0 36px 30px;">
                <a href="${verifyUrl}"
                   style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#c026d3);color:#ffffff;text-decoration:none;font-family:Arial,sans-serif;font-size:15px;font-weight:700;padding:14px 34px;border-radius:999px;box-shadow:0 6px 18px rgba(124,58,237,0.4);">
                  Confirmer mon email
                </a>
              </td>
            </tr>
            <!-- Fallback link -->
            <tr>
              <td style="padding:0 36px 28px;">
                <p style="margin:0 0 6px;font-family:Arial,sans-serif;font-size:12px;color:#9ca3af;">
                  Le bouton ne fonctionne pas ? Copiez ce lien dans votre navigateur :
                </p>
                <p style="margin:0;font-family:Arial,sans-serif;font-size:12px;word-break:break-all;">
                  <a href="${verifyUrl}" style="color:#7c3aed;">${verifyUrl}</a>
                </p>
              </td>
            </tr>
            <!-- Footer -->
            <tr>
              <td style="background:#faf7ff;padding:20px 36px;border-top:1px solid #efe9fb;">
                <p style="margin:0;font-family:Arial,sans-serif;font-size:11.5px;line-height:1.6;color:#9ca3af;">
                  Ce lien expire dans 24 heures. Si vous n'êtes pas à l'origine de
                  cette inscription, ignorez simplement cet email.
                </p>
                <p style="margin:8px 0 0;font-family:Arial,sans-serif;font-size:11.5px;color:#c4b5fd;">
                  © ${new Date().getFullYear()} AI-KOONIC · Yperyon Agency, Tunis
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
  }

  async sendVerificationEmail(to: string, verifyUrl: string, firstName?: string | null): Promise<void> {
    await this.dispatch(to, 'Confirmez votre email — AI-KOONIC', this.buildVerificationHtml(verifyUrl, firstName));
  }

  async sendWorkflowEmail(to: string, subject: string, content: string): Promise<void> {
    await this.dispatch(to, subject, this.buildHtml(content));
  }

  /** Low-level send: Resend (HTTPS 443) first, Gmail SMTP fallback. */
  private async dispatch(to: string, subject: string, html: string): Promise<void> {
    // ── Primary: Resend API (HTTPS port 443 — never blocked by VPS firewalls) ──
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: process.env.RESEND_FROM ?? 'AIKOONIC <noreply@aikoonic.codes>',
          reply_to: process.env.GMAIL_USER,
          to: [to],
          subject,
          html,
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Resend API error ${res.status}: ${err}`);
      }

      this.logger.log(`✅ Email dispatched via Resend to ${to}`);
      return;
    }

    // ── Fallback: Gmail SMTP port 587 (STARTTLS) ──────────────────────────────
    const gmailUser = process.env.GMAIL_USER;
    const gmailPass = process.env.GMAIL_APP_PASSWORD;

    if (!gmailUser || !gmailPass) {
      throw new Error('No email transport configured (set RESEND_API_KEY or GMAIL_USER+GMAIL_APP_PASSWORD)');
    }

    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false, // STARTTLS
      auth: { user: gmailUser, pass: gmailPass },
    });

    await transporter.sendMail({
      from: `"AIKOONIC" <${gmailUser}>`,
      to,
      subject,
      html,
    });

    this.logger.log(`✅ Email dispatched via Gmail SMTP to ${to}`);
  }
}

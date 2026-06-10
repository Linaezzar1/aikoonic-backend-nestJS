import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

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

  async sendWorkflowEmail(to: string, subject: string, content: string): Promise<void> {
    const html = this.buildHtml(content);

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
          from: process.env.RESEND_FROM ?? 'AIKOONIC CRM <noreply@aikoonic.codes>',
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
      from: `"AIKOONIC CRM" <${gmailUser}>`,
      to,
      subject,
      html,
    });

    this.logger.log(`✅ Email dispatched via Gmail SMTP to ${to}`);
  }
}

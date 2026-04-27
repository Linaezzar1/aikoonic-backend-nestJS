import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private transporter: nodemailer.Transporter;
  private readonly logger = new Logger(MailService.name);

  constructor() {
    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });
  }

  async sendWorkflowEmail(to: string, subject: string, content: string): Promise<void> {
    try {
      const htmlContent = `
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

      await this.transporter.sendMail({
        from: `"AIKOONIC CRM" <${process.env.GMAIL_USER}>`,
        to,
        subject,
        html: htmlContent,
      });

      this.logger.log(`✅ Email successfully dispatched to ${to}`);
    } catch (error) {
      this.logger.error(`❌ Failed to send email to ${to}: ${error.message}`, error.stack);
    }
  }
}

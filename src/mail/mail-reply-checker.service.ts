import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ImapFlow } from 'imapflow';
import { PrismaService } from '../prisma/prisma.service';
import { WorkflowEngineService } from '../modules/workflows/workflow-engine.service';
import { NotificationsService } from '../modules/notifications/notifications.service';

const REPLY_TAG = 'a_repondu';

@Injectable()
export class MailReplyCheckerService {
  private readonly logger = new Logger(MailReplyCheckerService.name);
  private checking = false;
  private readonly processedMessageIds = new Set<string>();
  // For Gmail API: remember the last history ID seen
  private gmailHistoryId: string | undefined;
  private lastCheckedAt = new Date(Date.now() - 24 * 60 * 60 * 1000);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workflowEngine: WorkflowEngineService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron('*/5 * * * *')
  async checkReplies() {
    if (this.checking) return;
    this.checking = true;

    try {
      // ── Primary: Gmail API via HTTPS (never blocked by firewalls) ────────────
      if (
        process.env.GMAIL_CLIENT_ID &&
        process.env.GMAIL_CLIENT_SECRET &&
        process.env.GMAIL_REFRESH_TOKEN
      ) {
        await this.checkViaGmailApi();
        return;
      }

      // ── Fallback: IMAP ───────────────────────────────────────────────────────
      if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
        await this.checkViaImap();
        return;
      }

      this.logger.warn('No email credentials configured — skipping reply check');
    } finally {
      this.checking = false;
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Gmail REST API (HTTPS — works even when SMTP/IMAP ports are blocked)
  // ────────────────────────────────────────────────────────────────────────────
  private async getGmailAccessToken(): Promise<string> {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.GMAIL_CLIENT_ID,
        client_secret: process.env.GMAIL_CLIENT_SECRET,
        refresh_token: process.env.GMAIL_REFRESH_TOKEN,
        grant_type: 'refresh_token',
      }),
    });
    if (!res.ok) throw new Error(`OAuth2 token error: ${await res.text()}`);
    const data = await res.json() as { access_token: string };
    return data.access_token;
  }

  private async checkViaGmailApi() {
    this.logger.log('Gmail API check started…');
    try {
      const token = await this.getGmailAccessToken();
      const headers = { Authorization: `Bearer ${token}` };

      // Search emails from last 24h, excluding our own sent messages
      const afterSec = Math.floor(this.lastCheckedAt.getTime() / 1000);
      const query = encodeURIComponent(`after:${afterSec} -from:me in:inbox`);

      const listRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=50`,
        { headers },
      );
      if (!listRes.ok) throw new Error(`Gmail list error: ${await listRes.text()}`);

      const listData = await listRes.json() as { messages?: { id: string }[] };
      const messages = listData.messages ?? [];
      this.lastCheckedAt = new Date();

      for (const msgRef of messages) {
        if (this.processedMessageIds.has(msgRef.id)) continue;
        this.processedMessageIds.add(msgRef.id);

        const msgRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgRef.id}?format=metadata&metadataHeaders=From`,
          { headers },
        );
        if (!msgRes.ok) continue;

        const msg = await msgRes.json() as {
          payload?: { headers?: { name: string; value: string }[] };
        };
        const fromHeader =
          msg.payload?.headers?.find((h) => h.name === 'From')?.value ?? '';

        // Extract email from "Name <email>" format
        const match = fromHeader.match(/<(.+)>/) ?? [null, fromHeader];
        const fromEmail = (match[1] ?? fromHeader).toLowerCase().trim();
        if (!fromEmail) continue;

        const ownEmail = process.env.GMAIL_USER?.toLowerCase();
        if (fromEmail === ownEmail) continue;

        this.logger.log(`Reply detected via Gmail API from ${fromEmail}`);
        await this.processReply(fromEmail);
      }

      this.logger.log(`Gmail API check done — ${messages.length} message(s) scanned`);
    } catch (err: unknown) {
      this.logger.error(`Gmail API check failed: ${(err as Error).message}`);
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // IMAP fallback
  // ────────────────────────────────────────────────────────────────────────────
  private async checkViaImap() {
    this.logger.log('IMAP check started…');

    const client = new ImapFlow({
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      auth: {
        user: process.env.GMAIL_USER!,
        pass: process.env.GMAIL_APP_PASSWORD!.replace(/\s/g, ''),
      },
      logger: false,
    });

    try {
      await client.connect();
      const lock = await client.getMailboxLock('INBOX');

      try {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        for await (const msg of client.fetch({ since }, { envelope: true, uid: true })) {
          const messageId = msg.envelope?.messageId ?? String(msg.uid);
          if (this.processedMessageIds.has(messageId)) continue;

          const fromEmail = msg.envelope?.from?.[0]?.address?.toLowerCase();
          if (!fromEmail) continue;
          if (fromEmail === process.env.GMAIL_USER?.toLowerCase()) {
            this.processedMessageIds.add(messageId);
            continue;
          }

          await this.processReply(fromEmail);
          this.processedMessageIds.add(messageId);
        }
      } finally {
        lock.release();
      }

      await client.logout();
      this.logger.log('IMAP check done');
    } catch (error: unknown) {
      const err = error as Error & { responseCode?: string; serverResponse?: string };
      // Log the detailed error so we can diagnose auth vs connectivity issues
      this.logger.error(
        `IMAP check failed: ${err.message}` +
          (err.responseCode ? ` [code: ${err.responseCode}]` : '') +
          (err.serverResponse ? ` [server: ${err.serverResponse}]` : ''),
      );
      try { await client.logout(); } catch { /**/ }
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Common: tag the lead and resume waiting executions
  // ────────────────────────────────────────────────────────────────────────────
  private async processReply(fromEmail: string) {
    const leads = await this.prisma.lead.findMany({
      where: { email: fromEmail },
      include: { tags: true },
    });

    for (const lead of leads) {
      if (lead.tags.some((t) => t.label === REPLY_TAG)) continue;

      const tag = await this.prisma.tag.upsert({
        where: { label_tenantId: { label: REPLY_TAG, tenantId: lead.tenantId } },
        create: { label: REPLY_TAG, tenantId: lead.tenantId, color: '#10B981' },
        update: {},
      });
      await this.prisma.lead.update({
        where: { id: lead.id },
        data: { tags: { connect: { id: tag.id } } },
      });

      this.logger.log(
        `Lead "${lead.firstName ?? lead.email}" tagged "${REPLY_TAG}" (replied from ${fromEmail})`,
      );

      const leadName = [lead.firstName, lead.lastName].filter(Boolean).join(' ') || lead.email;
      await this.notifications
        .notifyTenantOwner(
          lead.tenantId,
          'lead_replied',
          'Un lead a répondu',
          `${leadName} a répondu à votre email.`,
        )
        .catch(() => null); // Notification failure must never block the workflow resume

      const waitingExecutions = await this.prisma.workflowExecution.findMany({
        where: { leadId: lead.id, status: 'waiting' },
      });
      for (const exec of waitingExecutions) {
        this.logger.log(`Interrupting wait → resuming execution ${exec.id}`);
        await this.workflowEngine.resumeExecution(exec.id);
      }

      await this.workflowEngine.triggerWorkflows('tag_added', REPLY_TAG, lead.id, lead.tenantId);
    }
  }
}

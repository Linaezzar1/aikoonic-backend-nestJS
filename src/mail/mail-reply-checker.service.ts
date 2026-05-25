import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ImapFlow } from 'imapflow';
import { PrismaService } from '../prisma/prisma.service';
import { WorkflowEngineService } from '../modules/workflows/workflow-engine.service';

const REPLY_TAG = 'a_repondu';

@Injectable()
export class MailReplyCheckerService {
  private readonly logger = new Logger(MailReplyCheckerService.name);
  private checking = false;
  // Tracks message-IDs already processed so we don't react twice
  // (cleared on restart — acceptable for our use case)
  private readonly processedMessageIds = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly workflowEngine: WorkflowEngineService,
  ) {}

  @Cron('*/5 * * * *')
  async checkReplies() {
    if (this.checking) return;
    if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
      this.logger.warn('GMAIL credentials not set — skipping IMAP check');
      return;
    }

    this.checking = true;
    this.logger.log('IMAP check started…');

    const client = new ImapFlow({
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD.replace(/\s/g, ''),
      },
      logger: false,
    });

    try {
      await client.connect();
      const lock = await client.getMailboxLock('INBOX');

      try {
        // Check ALL emails from the last 24 hours (seen or unseen)
        // We track processed message-IDs ourselves to avoid double-processing
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

        for await (const msg of client.fetch(
          { since },
          { envelope: true, uid: true },
        )) {
          const messageId = msg.envelope?.messageId ?? String(msg.uid);
          if (this.processedMessageIds.has(messageId)) continue;

          const fromEmail = msg.envelope?.from?.[0]?.address?.toLowerCase();
          if (!fromEmail) continue;

          // Skip our own outgoing emails
          if (fromEmail === process.env.GMAIL_USER?.toLowerCase()) {
            this.processedMessageIds.add(messageId);
            continue;
          }

          this.logger.log(`Found email from ${fromEmail} (uid ${msg.uid})`);
          await this.processReply(fromEmail);
          this.processedMessageIds.add(messageId);
        }
      } finally {
        lock.release();
      }

      await client.logout();
      this.logger.log('IMAP check done');
    } catch (error: unknown) {
      this.logger.error(`IMAP check failed: ${(error as Error).message}`);
      try { await client.logout(); } catch { /**/ }
    } finally {
      this.checking = false;
    }
  }

  private async processReply(fromEmail: string) {
    const leads = await this.prisma.lead.findMany({
      where: { email: fromEmail },
      include: { tags: true },
    });

    for (const lead of leads) {
      const alreadyTagged = lead.tags.some(t => t.label === REPLY_TAG);
      if (alreadyTagged) continue;

      // 1. Add tag FIRST so the condition sees it when execution resumes
      const tag = await this.prisma.tag.upsert({
        where: { label_tenantId: { label: REPLY_TAG, tenantId: lead.tenantId } },
        create: { label: REPLY_TAG, tenantId: lead.tenantId, color: '#10B981' },
        update: {},
      });
      await this.prisma.lead.update({
        where: { id: lead.id },
        data: { tags: { connect: { id: tag.id } } },
      });

      this.logger.log(`Reply detected from ${fromEmail} → lead "${lead.firstName ?? lead.email}" tagged "${REPLY_TAG}"`);

      // 2. Resume waiting executions — tag is already in DB, condition will see OUI
      const waitingExecutions = await this.prisma.workflowExecution.findMany({
        where: { leadId: lead.id, status: 'waiting' },
      });
      for (const exec of waitingExecutions) {
        this.logger.log(`Interrupting wait on execution ${exec.id} → tag already added`);
        await this.workflowEngine.resumeExecution(exec.id);
      }

      // 3. Trigger dedicated "on reply" workflows (tag_added event)
      await this.workflowEngine.triggerWorkflows('tag_added', REPLY_TAG, lead.id, lead.tenantId);
    }
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkflowStepDto } from './dto/create-workflow.dto';
import { LeadStatus } from '@prisma/client';
import { MailService } from '../../mail/mail.service';

@Injectable()
export class WorkflowEngineService {
  private readonly logger = new Logger(WorkflowEngineService.name);

  constructor(
    private prisma: PrismaService,
    private mailService: MailService,
  ) {}

  async triggerWorkflows(
    event: string,
    eventValue: string,
    leadId: string,
    tenantId: string,
  ) {
    // Match workflows that either:
    // 1. Have an exact triggerValue (e.g. tag "VIP") — specific trigger
    // 2. Have no triggerValue — uses condition nodes to filter at runtime
    const activeWorkflows = await this.prisma.workflow.findMany({
      where: {
        tenantId,
        isActive: true,
        trigger: event,
        OR: [
          { triggerValue: eventValue },
          { triggerValue: null },
          { triggerValue: '' },
        ],
      },
    });

    for (const workflow of activeWorkflows) {
      this.logger.log(`Triggering workflow "${workflow.name}" for lead ${leadId} (event: ${eventValue})`);

      const execution = await this.prisma.workflowExecution.create({
        data: {
          workflowId: workflow.id,
          leadId,
          eventValue,   // store what triggered this (e.g. the tag name)
          status: 'running',
          currentStep: 0,
        },
      });

      this.executeStep(execution.id).catch((e) =>
        this.logger.error(`Error executing workflow ${execution.id}`, e),
      );
    }
  }

  async executeStep(executionId: string) {
    const execution = await this.prisma.workflowExecution.findUnique({
      where: { id: executionId },
      include: { workflow: true, lead: true },
    });

    if (!execution || execution.status !== 'running') return;

    const steps = execution.workflow.steps as unknown as WorkflowStepDto[];

    if (!steps || steps.length === 0 || execution.currentStep >= steps.length) {
      await this.prisma.workflowExecution.update({
        where: { id: execution.id },
        data: { status: 'completed', completedAt: new Date() },
      });
      return;
    }

    const step = steps[execution.currentStep];

    try {
      // ── Skip visual graph metadata ─────────────────────────────────────────
      if (step.type === '__graph__') {
        await this.advance(execution.id, execution.currentStep);
        return;
      }

      // ── Condition check ────────────────────────────────────────────────────
      if (step.type === 'condition') {
        const conditionMet = (execution.eventValue ?? '') === step.value;
        this.logger.log(
          `Condition "${step.value}" vs event "${execution.eventValue}" → ${conditionMet ? 'OUI' : 'NON'}`,
        );
        if (conditionMet) {
          // Continue to next step (OUI branch actions)
          await this.advance(execution.id, execution.currentStep);
        } else {
          // NON branch — stop execution
          await this.prisma.workflowExecution.update({
            where: { id: execution.id },
            data: { status: 'completed', completedAt: new Date() },
          });
        }
        return;
      }

      // ── Send email ─────────────────────────────────────────────────────────
      if (step.type === 'send_email') {
        const lead = await this.prisma.lead.findUnique({ where: { id: execution.leadId } });
        if (lead?.email) {
          const subject = `Message automatique - AIKOONIC CRM`;
          const body = step.value.replace(/\{\{prenom\}\}/g, lead.firstName ?? 'Client');
          try {
            await this.mailService.sendWorkflowEmail(lead.email, subject, body);
            this.logger.log(`✅ Email envoyé à ${lead.email}`);
          } catch (e: unknown) {
            this.logger.error(`❌ Email échec vers ${lead.email}: ${(e as Error).message}`);
          }
        } else {
          this.logger.warn(`⚠️ Lead ${execution.leadId} sans email, skip`);
        }
        await this.advance(execution.id, execution.currentStep);
        return;
      }

      // ── Change status ──────────────────────────────────────────────────────
      if (step.type === 'change_status') {
        await this.prisma.lead.update({
          where: { id: execution.leadId },
          data: { status: step.value as LeadStatus },
        });
        await this.advance(execution.id, execution.currentStep);
        return;
      }

      // ── Wait ───────────────────────────────────────────────────────────────
      if (step.type === 'wait') {
        this.logger.log(`Workflow ${execution.id} en attente`);
        return;
      }

      // Unknown step type — skip
      await this.advance(execution.id, execution.currentStep);

    } catch (error: unknown) {
      this.logger.error(
        `Erreur step ${execution.currentStep} pour execution ${execution.id}`,
        (error as Error).stack,
      );
      await this.prisma.workflowExecution.update({
        where: { id: execution.id },
        data: { status: 'failed' },
      });
    }
  }

  private async advance(executionId: string, currentStep: number) {
    await this.prisma.workflowExecution.update({
      where: { id: executionId },
      data: { currentStep: currentStep + 1 },
    });
    setImmediate(() => this.executeStep(executionId).catch(() => {}));
  }
}

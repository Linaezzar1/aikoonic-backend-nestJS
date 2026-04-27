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
    const activeWorkflows = await this.prisma.workflow.findMany({
      where: {
        tenantId,
        isActive: true,
        trigger: event,
        triggerValue: eventValue,
      },
    });

    for (const workflow of activeWorkflows) {
      this.logger.log(`Triggering workflow ${workflow.id} for lead ${leadId}`);
      
      const execution = await this.prisma.workflowExecution.create({
        data: {
          workflowId: workflow.id,
          leadId,
          status: 'running',
          currentStep: 0,
        },
      });

      // Execute next step immediately asynchronously
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

    if (!execution || execution.status !== 'running') {
      return;
    }

    const workflow = execution.workflow;
    const steps = workflow.steps as unknown as WorkflowStepDto[];

    if (!steps || steps.length === 0 || execution.currentStep >= steps.length) {
      await this.prisma.workflowExecution.update({
        where: { id: execution.id },
        data: { status: 'completed', completedAt: new Date() },
      });
      return;
    }

    const currentStepConfig = steps[execution.currentStep];

    try {
      if (currentStepConfig.type === 'change_status') {
        const newStatus = currentStepConfig.value as LeadStatus;
        await this.prisma.lead.update({
          where: { id: execution.leadId },
          data: { status: newStatus },
        });
      } else if (currentStepConfig.type === 'send_email') {
        const lead = await this.prisma.lead.findUnique({ where: { id: execution.leadId } });
        if (lead && lead.email) {
          try {
            await this.mailService.sendWorkflowEmail(
              lead.email,
              'Message automatique - AIKOONIC CRM',
              currentStepConfig.value
            );
            this.logger.log(`✅ Email envoyé à ${lead.email}`);
          } catch (e) {
            this.logger.error(`❌ Échec de l'envoi de l'email pour le workflow vers ${lead.email}: ${e.message}`);
          }
        } else {
          this.logger.warn(`⚠️ Lead ${execution.leadId} sans email, skip`);
        }
      } else if (currentStepConfig.type === 'wait') {
        // Wait operation: usually you'd schedule it in a task queue (Redis, BullMQ)
        // Here we just leave it 'running' and let a cron job pick it up later theoretically
        this.logger.log(`Workflow ${execution.id} is waiting...`);
        return;
      }

      // If it's not a wait step, increment step and recurse
      if (currentStepConfig.type !== 'wait') {
        await this.prisma.workflowExecution.update({
          where: { id: execution.id },
          data: { currentStep: execution.currentStep + 1 },
        });

        // Recurse to run next step
        setImmediate(() => {
          this.executeStep(execution.id).catch((e) =>
            this.logger.error(`Error going to next step ${execution.id}`, e.stack),
          );
        });
      }
    } catch (error) {
      this.logger.error(
        `Failed to execute step ${execution.currentStep} for execution ${execution.id}`,
        error.stack,
      );
      await this.prisma.workflowExecution.update({
        where: { id: execution.id },
        data: { status: 'failed' },
      });
    }
  }
}

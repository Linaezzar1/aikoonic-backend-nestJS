import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkflowEngineService } from './workflow-engine.service';

@Injectable()
export class WorkflowSchedulerService {
  private readonly logger = new Logger(WorkflowSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: WorkflowEngineService,
  ) {}

  // Runs every minute — supports minute-level wait steps for testing
  @Cron('* * * * *')
  async resumeWaitingExecutions() {
    const now = new Date();
    const due = await this.prisma.workflowExecution.findMany({
      where: { status: 'waiting', resumeAt: { lte: now } } as any,
    });
    for (const exec of due) {
      this.logger.log(`Resuming waiting execution ${exec.id}`);
      await this.engine.resumeExecution(exec.id);
    }
  }

  // Runs every hour — checks scheduled workflows whose date has passed
  @Cron(CronExpression.EVERY_HOUR)
  async checkScheduledWorkflows() {
    const now = new Date();

    const due = await this.prisma.workflow.findMany({
      where: {
        trigger: 'scheduled',
        isActive: true,
      },
    });

    for (const wf of due) {
      if (!wf.triggerValue) continue;

      const scheduledAt = new Date(wf.triggerValue);
      if (isNaN(scheduledAt.getTime()) || scheduledAt > now) continue;

      this.logger.log(`Scheduled workflow "${wf.name}" is due — triggering for all leads`);

      // Get all leads in the tenant
      const leads = await this.prisma.lead.findMany({
        where: { tenantId: wf.tenantId },
        select: { id: true },
      });

      // Fire for every lead
      for (const lead of leads) {
        await this.engine.triggerWorkflows('scheduled', wf.triggerValue, lead.id, wf.tenantId);
      }

      // Deactivate after execution so it doesn't repeat
      await this.prisma.workflow.update({
        where: { id: wf.id },
        data: { isActive: false },
      });

      this.logger.log(`Workflow "${wf.name}" executed for ${leads.length} leads and deactivated`);
    }
  }
}

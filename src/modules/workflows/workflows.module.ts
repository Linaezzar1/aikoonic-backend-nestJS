import { Module } from '@nestjs/common';
import { WorkflowsService } from './workflows.service';
import { WorkflowsController } from './workflows.controller';
import { WorkflowEngineService } from './workflow-engine.service';
import { WorkflowSchedulerService } from './workflow-scheduler.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { MailModule } from '../../mail/mail.module';

@Module({
  imports: [PrismaModule, MailModule],
  controllers: [WorkflowsController],
  providers: [WorkflowsService, WorkflowEngineService, WorkflowSchedulerService],
  exports: [WorkflowsService, WorkflowEngineService],
})
export class WorkflowsModule {}

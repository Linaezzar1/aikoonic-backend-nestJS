import { Module } from '@nestjs/common';
import { WorkflowsService } from './workflows.service';
import { WorkflowsController } from './workflows.controller';
import { WorkflowEngineService } from './workflow-engine.service';
import { WorkflowSchedulerService } from './workflow-scheduler.service';
import { WorkflowAiService } from './workflow-ai.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { MailModule } from '../../mail/mail.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PremiumGuard } from '../../common/guards/premium.guard';

@Module({
  imports: [PrismaModule, MailModule, NotificationsModule],
  controllers: [WorkflowsController],
  providers: [WorkflowsService, WorkflowEngineService, WorkflowSchedulerService, WorkflowAiService, PremiumGuard],
  exports: [WorkflowsService, WorkflowEngineService],
})
export class WorkflowsModule {}

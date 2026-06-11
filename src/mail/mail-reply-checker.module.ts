import { Module } from '@nestjs/common';
import { MailReplyCheckerService } from './mail-reply-checker.service';
import { PrismaModule } from '../prisma/prisma.module';
import { WorkflowsModule } from '../modules/workflows/workflows.module';
import { NotificationsModule } from '../modules/notifications/notifications.module';

@Module({
  imports: [PrismaModule, WorkflowsModule, NotificationsModule],
  providers: [MailReplyCheckerService],
})
export class MailReplyCheckerModule {}

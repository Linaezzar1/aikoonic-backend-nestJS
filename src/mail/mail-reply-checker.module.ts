import { Module } from '@nestjs/common';
import { MailReplyCheckerService } from './mail-reply-checker.service';
import { PrismaModule } from '../prisma/prisma.module';
import { WorkflowsModule } from '../modules/workflows/workflows.module';

@Module({
  imports: [PrismaModule, WorkflowsModule],
  providers: [MailReplyCheckerService],
})
export class MailReplyCheckerModule {}

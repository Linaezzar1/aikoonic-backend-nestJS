import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { CrmModule } from './modules/crm/crm.module';
import { WorkflowsModule } from './modules/workflows/workflows.module';
import { MailModule } from './mail/mail.module';
import { MailReplyCheckerModule } from './mail/mail-reply-checker.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    PrismaModule,
    AuthModule,
    UsersModule,
    CrmModule,
    WorkflowsModule,
    MailModule,
    MailReplyCheckerModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

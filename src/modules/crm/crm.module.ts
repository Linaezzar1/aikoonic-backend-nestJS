import { Module } from '@nestjs/common';
import { CrmController } from './crm.controller';
import { TagsController } from './tags.controller';
import { CrmService } from './crm.service';
import { CsvParserService } from './import/csv-parser.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { WorkflowsModule } from '../workflows/workflows.module';

@Module({
  imports: [PrismaModule, WorkflowsModule],
  controllers: [CrmController, TagsController],
  providers: [CrmService, CsvParserService]
})
export class CrmModule {}

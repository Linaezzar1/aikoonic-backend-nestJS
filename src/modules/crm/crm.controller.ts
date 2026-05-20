import {
  Body, Controller, Delete, Get, Param, Patch, Post,
  Query, BadRequestException, ForbiddenException,
  UseGuards, UseInterceptors, UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PremiumGuard } from '../../common/guards/premium.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CrmService } from './crm.service';
import { CsvParserService } from './import/csv-parser.service';
import { QuotaService } from './quota.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { FilterLeadsDto } from './dto/filter-leads.dto';

@UseGuards(JwtAuthGuard, PremiumGuard)
@Controller('leads')
export class CrmController {
  constructor(
    private readonly crmService: CrmService,
    private readonly csvParserService: CsvParserService,
    private readonly quotaService: QuotaService,
  ) {}

  private resolveTenantId(user: { tenantId?: string | null }): string {
    if (!user.tenantId) {
      throw new ForbiddenException('Onboarding not completed. Please create your company profile first.');
    }
    return user.tenantId;
  }

  @Post('import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async importLeads(
    @CurrentUser() user: { tenantId?: string | null },
    @UploadedFile() file: Express.Multer.File,
  ) {
    const tid = this.resolveTenantId(user);
    await this.quotaService.checkAndLog(tid, 'lead_import');
    if (!file) throw new BadRequestException('No file uploaded');

    const isCsv = file.mimetype === 'text/csv' || file.originalname.endsWith('.csv');
    const isExcel =
      file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.mimetype === 'application/vnd.ms-excel' ||
      file.originalname.match(/\.xlsx?$/);

    let parseResult: { leads: CreateLeadDto[]; errors: string[] };
    if (isCsv) {
      parseResult = await this.csvParserService.parseCSV(file.buffer);
    } else if (isExcel) {
      parseResult = await this.csvParserService.parseExcel(file.buffer);
    } else {
      throw new BadRequestException('Invalid file type. Only CSV and Excel files are allowed.');
    }

    const importResult = await this.crmService.importLeads(tid, parseResult.leads);
    importResult.errors = [...parseResult.errors, ...importResult.errors];
    return importResult;
  }

  @Post()
  async createLead(
    @CurrentUser() user: { tenantId?: string | null },
    @Body() createLeadDto: CreateLeadDto,
  ) {
    const tid = this.resolveTenantId(user);
    await this.quotaService.checkAndLog(tid, 'lead_create');
    return this.crmService.createLead(tid, createLeadDto);
  }

  @Get()
  async findAllLeads(
    @CurrentUser() user: { tenantId?: string | null },
    @Query() filterLeadsDto: FilterLeadsDto,
  ) {
    return this.crmService.findAllLeads(this.resolveTenantId(user), filterLeadsDto);
  }

  @Get(':id')
  async findLeadById(
    @CurrentUser() user: { tenantId?: string | null },
    @Param('id') id: string,
  ) {
    return this.crmService.findLeadById(this.resolveTenantId(user), id);
  }

  @Patch(':id')
  async updateLead(
    @CurrentUser() user: { tenantId?: string | null },
    @Param('id') id: string,
    @Body() updateLeadDto: UpdateLeadDto,
  ) {
    return this.crmService.updateLead(this.resolveTenantId(user), id, updateLeadDto);
  }

  @Delete(':id')
  async deleteLead(
    @CurrentUser() user: { tenantId?: string | null },
    @Param('id') id: string,
  ) {
    return this.crmService.deleteLead(this.resolveTenantId(user), id);
  }

  @Post(':id/tags')
  async assignTagsToLead(
    @CurrentUser() user: { tenantId?: string | null },
    @Param('id') id: string,
    @Body() body: { tagIds: string[] },
  ) {
    return this.crmService.assignTagsToLead(this.resolveTenantId(user), id, body.tagIds);
  }

  @Delete(':id/tags/:tagId')
  async removeTagFromLead(
    @CurrentUser() user: { tenantId?: string | null },
    @Param('id') id: string,
    @Param('tagId') tagId: string,
  ) {
    return this.crmService.removeTagFromLead(this.resolveTenantId(user), id, tagId);
  }
}

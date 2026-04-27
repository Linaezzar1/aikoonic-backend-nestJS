import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Query, BadRequestException, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CrmService } from './crm.service';
import { CsvParserService } from './import/csv-parser.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { FilterLeadsDto } from './dto/filter-leads.dto';

@Controller('leads')
export class CrmController {
  constructor(
    private readonly crmService: CrmService,
    private readonly csvParserService: CsvParserService,
  ) {}

  private extractTenantId(tenantId: string | undefined): string {
    if (!tenantId) {
      throw new BadRequestException('x-tenant-id header is required');
    }
    return tenantId;
  }

  @Post('import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } })) // 5MB limit
  async importLeads(
    @Headers('x-tenant-id') tenantId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const tid = this.extractTenantId(tenantId);
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

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

    // Call service to do insertion
    const importResult = await this.crmService.importLeads(tid, parseResult.leads);

    // Merge parsing errors with insertion errors
    importResult.errors = [...parseResult.errors, ...importResult.errors];

    return importResult;
  }

  @Post()
  async createLead(
    @Headers('x-tenant-id') tenantId: string,
    @Body() createLeadDto: CreateLeadDto,
  ) {
    const tid = this.extractTenantId(tenantId);
    return this.crmService.createLead(tid, createLeadDto);
  }

  @Get()
  async findAllLeads(
    @Headers('x-tenant-id') tenantId: string,
    @Query() filterLeadsDto: FilterLeadsDto,
  ) {
    const tid = this.extractTenantId(tenantId);
    return this.crmService.findAllLeads(tid, filterLeadsDto);
  }

  @Get(':id')
  async findLeadById(
    @Headers('x-tenant-id') tenantId: string,
    @Param('id') id: string,
  ) {
    const tid = this.extractTenantId(tenantId);
    return this.crmService.findLeadById(tid, id);
  }

  @Patch(':id')
  async updateLead(
    @Headers('x-tenant-id') tenantId: string,
    @Param('id') id: string,
    @Body() updateLeadDto: UpdateLeadDto,
  ) {
    const tid = this.extractTenantId(tenantId);
    return this.crmService.updateLead(tid, id, updateLeadDto);
  }

  @Delete(':id')
  async deleteLead(
    @Headers('x-tenant-id') tenantId: string,
    @Param('id') id: string,
  ) {
    const tid = this.extractTenantId(tenantId);
    return this.crmService.deleteLead(tid, id);
  }

  @Post(':id/tags')
  async assignTagsToLead(
    @Headers('x-tenant-id') tenantId: string,
    @Param('id') id: string,
    @Body() body: { tagIds: string[] },
  ) {
    const tid = this.extractTenantId(tenantId);
    return this.crmService.assignTagsToLead(tid, id, body.tagIds);
  }

  @Delete(':id/tags/:tagId')
  async removeTagFromLead(
    @Headers('x-tenant-id') tenantId: string,
    @Param('id') id: string,
    @Param('tagId') tagId: string,
  ) {
    const tid = this.extractTenantId(tenantId);
    return this.crmService.removeTagFromLead(tid, id, tagId);
  }
}


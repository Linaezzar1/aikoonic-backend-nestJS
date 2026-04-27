import { Body, Controller, Delete, Get, Headers, Param, Post, BadRequestException } from '@nestjs/common';
import { CrmService } from './crm.service';
import { CreateTagDto } from './dto/create-tag.dto';

@Controller('tags')
export class TagsController {
  constructor(private readonly crmService: CrmService) {}

  private extractTenantId(tenantId: string | undefined): string {
    if (!tenantId) {
      throw new BadRequestException('x-tenant-id header is required');
    }
    return tenantId;
  }

  @Post()
  async createTag(
    @Headers('x-tenant-id') tenantId: string,
    @Body() createTagDto: CreateTagDto,
  ) {
    const tid = this.extractTenantId(tenantId);
    return this.crmService.createTag(tid, createTagDto);
  }

  @Get()
  async findAllTags(@Headers('x-tenant-id') tenantId: string) {
    const tid = this.extractTenantId(tenantId);
    return this.crmService.findAllTags(tid);
  }

  @Delete(':id')
  async deleteTag(
    @Headers('x-tenant-id') tenantId: string,
    @Param('id') id: string,
  ) {
    const tid = this.extractTenantId(tenantId);
    return this.crmService.deleteTag(tid, id);
  }
}

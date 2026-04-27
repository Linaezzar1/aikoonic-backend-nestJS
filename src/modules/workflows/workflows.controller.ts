import { Controller, Get, Post, Body, Patch, Param, Delete, Headers, BadRequestException } from '@nestjs/common';
import { WorkflowsService } from './workflows.service';
import { CreateWorkflowDto } from './dto/create-workflow.dto';
import { UpdateWorkflowDto } from './dto/update-workflow.dto';

@Controller('workflows')
export class WorkflowsController {
  constructor(private readonly workflowsService: WorkflowsService) {}

  private extractTenantId(tenantId: string | undefined): string {
    if (!tenantId) {
      throw new BadRequestException('x-tenant-id header is required');
    }
    return tenantId;
  }

  @Post()
  create(
    @Headers('x-tenant-id') tenantId: string,
    @Body() dto: CreateWorkflowDto,
  ) {
    const tid = this.extractTenantId(tenantId);
    return this.workflowsService.create(tid, dto);
  }

  @Get()
  findAll(@Headers('x-tenant-id') tenantId: string) {
    const tid = this.extractTenantId(tenantId);
    return this.workflowsService.findAll(tid);
  }

  @Get(':id')
  findOne(
    @Headers('x-tenant-id') tenantId: string,
    @Param('id') id: string,
  ) {
    const tid = this.extractTenantId(tenantId);
    return this.workflowsService.findOne(tid, id);
  }

  @Patch(':id')
  update(
    @Headers('x-tenant-id') tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateWorkflowDto,
  ) {
    const tid = this.extractTenantId(tenantId);
    return this.workflowsService.update(tid, id, dto);
  }

  @Delete(':id')
  remove(
    @Headers('x-tenant-id') tenantId: string,
    @Param('id') id: string,
  ) {
    const tid = this.extractTenantId(tenantId);
    return this.workflowsService.remove(tid, id);
  }
}

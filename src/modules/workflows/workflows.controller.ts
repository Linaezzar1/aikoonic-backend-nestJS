import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, ForbiddenException } from '@nestjs/common';
import { IsString, IsNotEmpty } from 'class-validator';
import { WorkflowsService } from './workflows.service';
import { WorkflowAiService } from './workflow-ai.service';
import { CreateWorkflowDto } from './dto/create-workflow.dto';
import { UpdateWorkflowDto } from './dto/update-workflow.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PremiumGuard } from '../../common/guards/premium.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

class GenerateWorkflowDto {
  @IsString() @IsNotEmpty()
  description!: string;
}

@UseGuards(JwtAuthGuard, PremiumGuard)
@Controller('workflows')
export class WorkflowsController {
  constructor(
    private readonly workflowsService: WorkflowsService,
    private readonly workflowAiService: WorkflowAiService,
  ) {}

  private resolveTenantId(user: { tenantId?: string | null }): string {
    if (!user.tenantId) {
      throw new ForbiddenException('Onboarding not completed. Please create your company profile first.');
    }
    return user.tenantId;
  }

  @Post('generate')
  generateWithAi(@Body() dto: GenerateWorkflowDto) {
    return this.workflowAiService.generateFromDescription(dto.description);
  }

  @Post()
  create(
    @CurrentUser() user: { tenantId?: string | null },
    @Body() dto: CreateWorkflowDto,
  ) {
    return this.workflowsService.create(this.resolveTenantId(user), dto);
  }

  @Get()
  findAll(@CurrentUser() user: { tenantId?: string | null }) {
    return this.workflowsService.findAll(this.resolveTenantId(user));
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: { tenantId?: string | null },
    @Param('id') id: string,
  ) {
    return this.workflowsService.findOne(this.resolveTenantId(user), id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: { tenantId?: string | null },
    @Param('id') id: string,
    @Body() dto: UpdateWorkflowDto,
  ) {
    return this.workflowsService.update(this.resolveTenantId(user), id, dto);
  }

  @Delete(':id')
  remove(
    @CurrentUser() user: { tenantId?: string | null },
    @Param('id') id: string,
  ) {
    return this.workflowsService.remove(this.resolveTenantId(user), id);
  }
}

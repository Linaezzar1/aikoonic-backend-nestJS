import { Body, Controller, Delete, Get, Param, Post, ForbiddenException, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CrmService } from './crm.service';
import { CreateTagDto } from './dto/create-tag.dto';

@UseGuards(JwtAuthGuard)
@Controller('tags')
export class TagsController {
  constructor(private readonly crmService: CrmService) {}

  private resolveTenantId(user: { tenantId?: string | null }): string {
    if (!user.tenantId) {
      throw new ForbiddenException('Onboarding not completed. Please create your company profile first.');
    }
    return user.tenantId;
  }

  @Post()
  async createTag(
    @CurrentUser() user: { tenantId?: string | null },
    @Body() createTagDto: CreateTagDto,
  ) {
    return this.crmService.createTag(this.resolveTenantId(user), createTagDto);
  }

  @Get()
  async findAllTags(@CurrentUser() user: { tenantId?: string | null }) {
    return this.crmService.findAllTags(this.resolveTenantId(user));
  }

  @Delete(':id')
  async deleteTag(
    @CurrentUser() user: { tenantId?: string | null },
    @Param('id') id: string,
  ) {
    return this.crmService.deleteTag(this.resolveTenantId(user), id);
  }
}

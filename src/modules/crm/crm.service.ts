import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { FilterLeadsDto } from './dto/filter-leads.dto';
import { CreateTagDto } from './dto/create-tag.dto';
import { ImportResultDto } from './dto/import-leads.dto';
import { Prisma, LeadSource, LeadStatus } from '@prisma/client';
import { WorkflowEngineService } from '../workflows/workflow-engine.service';

@Injectable()
export class CrmService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflowEngine: WorkflowEngineService,
  ) {}

  async importLeads(
    tenantId: string,
    leadsData: CreateLeadDto[],
  ): Promise<ImportResultDto> {
    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    await Promise.allSettled(
      leadsData.map(async (leadData, index) => {
        const existingLead = await this.prisma.lead.findUnique({
          where: { email_tenantId: { email: leadData.email, tenantId } },
        });

        if (existingLead) {
          skipped++;
        } else {
          try {
            const { tagIds, ...data } = leadData;
            await this.prisma.lead.create({
              data: {
                ...data,
                tenantId,
                source: LeadSource.CSV_IMPORT,
                status: LeadStatus.NOUVEAU,
              },
            });
            imported++;
          } catch (e: any) {
            errors.push(`Row ${index + 2}: Error saving lead - ${e.message}`);
          }
        }
      }),
    );

    return { imported, skipped, errors };
  }

  async createLead(tenantId: string, dto: CreateLeadDto) {
    const { tagIds, ...leadData } = dto;

    // Check if a Lead with this email already exists for the tenant
    const existingLead = await this.prisma.lead.findUnique({
      where: {
        email_tenantId: { email: leadData.email, tenantId },
      },
    });

    if (existingLead) {
      throw new ConflictException(
        `A lead with the email ${leadData.email} already exists.`,
      );
    }

    const lead = await this.prisma.lead.create({
      data: {
        ...leadData,
        tenantId,
        tags:
          tagIds && tagIds.length > 0
            ? {
                connect: tagIds.map((id) => ({ id })),
              }
            : undefined,
      },
      include: {
        tags: true,
      },
    });

    this.workflowEngine.triggerWorkflows('contact_created', lead.email, lead.id, tenantId);

    return lead;
  }

  async findAllLeads(tenantId: string, filters: FilterLeadsDto) {
    const where: Prisma.LeadWhereInput = { tenantId };

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.tagId) {
      where.tags = {
        some: { id: filters.tagId },
      };
    }

    if (filters.search) {
      where.OR = [
        { firstName: { contains: filters.search, mode: 'insensitive' } },
        { lastName: { contains: filters.search, mode: 'insensitive' } },
        { email: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.lead.findMany({
      where,
      include: {
        tags: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findLeadById(tenantId: string, id: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id, tenantId },
      include: {
        tags: true,
        executions: true,
      },
    });

    if (!lead) {
      throw new NotFoundException(
        `Lead with ID ${id} not found in this tenant`,
      );
    }

    return lead;
  }

  async updateLead(tenantId: string, id: string, dto: UpdateLeadDto) {
    const existingLead = await this.findLeadById(tenantId, id); // Ensure it exists and belongs to tenant

    const { tagIds, ...updateData } = dto;
    const updateInput: Prisma.LeadUpdateInput = { ...updateData };

    if (tagIds) {
      updateInput.tags = {
        set: tagIds.map((tId) => ({ id: tId })),
      };
    }

    const updatedLead = await this.prisma.lead.update({
      where: { id },
      data: updateInput,
      include: { tags: true },
    });

    // Trigger workflow if status changed
    if (dto.status && existingLead.status !== dto.status) {
      this.workflowEngine.triggerWorkflows(
        'status_changed',
        dto.status,
        id,
        tenantId,
      );
    }

    // Trigger workflow if new tags were added
    if (dto.tagIds) {
      const addedTags = updatedLead.tags.filter(
        (newTag) =>
          !existingLead.tags.some((oldTag) => oldTag.id === newTag.id),
      );
      for (const tag of addedTags) {
        this.workflowEngine.triggerWorkflows(
          'tag_added',
          tag.label,
          id,
          tenantId,
        );
      }
    }

    return updatedLead;
  }

  async deleteLead(tenantId: string, id: string) {
    await this.findLeadById(tenantId, id); // Ensure it exists and belongs to tenant

    return this.prisma.lead.delete({
      where: { id },
    });
  }

  async createTag(tenantId: string, dto: CreateTagDto) {
    const existing = await this.prisma.tag.findUnique({
      where: {
        label_tenantId: { label: dto.label, tenantId },
      },
    });
    if (existing) {
      throw new ConflictException(
        `Tag with label '${dto.label}' already exists for this tenant`,
      );
    }
    return this.prisma.tag.create({
      data: {
        ...dto,
        tenantId,
      },
    });
  }

  async findAllTags(tenantId: string) {
    return this.prisma.tag.findMany({
      where: { tenantId },
      orderBy: { label: 'asc' },
    });
  }

  async deleteTag(tenantId: string, id: string) {
    const tag = await this.prisma.tag.findFirst({
      where: { id, tenantId },
    });
    if (!tag) {
      throw new NotFoundException(`Tag with ID ${id} not found in this tenant`);
    }
    return this.prisma.tag.delete({
      where: { id },
    });
  }

  async assignTagsToLead(tenantId: string, leadId: string, tagIds: string[]) {
    const lead = await this.findLeadById(tenantId, leadId);

    // Verify all tags belong to the tenant
    const tags = await this.prisma.tag.findMany({
      where: {
        id: { in: tagIds },
        tenantId,
      },
    });

    if (tags.length !== tagIds.length) {
      throw new NotFoundException(
        'One or more tags not found or do not belong to the tenant',
      );
    }

    const updatedLead = await this.prisma.lead.update({
      where: { id: leadId },
      data: {
        tags: {
          set: tagIds.map((id) => ({ id })),
        },
      },
      include: { tags: true },
    });

    for (const tag of tags) {
      const hadTag = lead.tags.some((t) => t.id === tag.id);
      if (!hadTag) {
        this.workflowEngine.triggerWorkflows(
          'tag_added',
          tag.label,
          leadId,
          tenantId,
        );
      }
    }

    return updatedLead;
  }

  async removeTagFromLead(tenantId: string, leadId: string, tagId: string) {
    const lead = await this.findLeadById(tenantId, leadId);
    const removedTag = lead.tags.find((t) => t.id === tagId);

    const updatedLead = await this.prisma.lead.update({
      where: { id: leadId },
      data: {
        tags: {
          disconnect: { id: tagId },
        },
      },
      include: { tags: true },
    });

    if (removedTag) {
      this.workflowEngine.triggerWorkflows('tag_removed', removedTag.label, leadId, tenantId);
    }

    return updatedLead;
  }
}

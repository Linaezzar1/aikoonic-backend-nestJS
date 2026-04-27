import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateWorkflowDto } from './dto/create-workflow.dto';
import { UpdateWorkflowDto } from './dto/update-workflow.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class WorkflowsService {
  constructor(private prisma: PrismaService) {}

  async create(tenantId: string, dto: CreateWorkflowDto) {
    return this.prisma.workflow.create({
      data: {
        name: dto.name,
        trigger: dto.trigger,
        triggerValue: dto.triggerValue,
        steps: dto.steps as unknown as Prisma.InputJsonValue,
        isActive: dto.isActive ?? true,
        tenantId,
      },
    });
  }

  async findAll(tenantId: string) {
    return this.prisma.workflow.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { executions: true },
        },
      },
    });
  }

  async findOne(tenantId: string, id: string) {
    const workflow = await this.prisma.workflow.findFirst({
      where: { id, tenantId },
      include: {
        executions: {
          include: { lead: true },
          orderBy: { startedAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!workflow) {
      throw new NotFoundException(`Workflow with ID ${id} not found`);
    }

    return workflow;
  }

  async update(tenantId: string, id: string, dto: UpdateWorkflowDto) {
    await this.findOne(tenantId, id); // Ensure it exists and belongs to tenant

    return this.prisma.workflow.update({
      where: { id },
      data: {
        name: dto.name,
        trigger: dto.trigger,
        triggerValue: dto.triggerValue,
        steps: dto.steps ? (dto.steps as unknown as Prisma.InputJsonValue) : undefined,
        isActive: dto.isActive,
      },
    });
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);

    return this.prisma.workflow.delete({
      where: { id },
    });
  }
}

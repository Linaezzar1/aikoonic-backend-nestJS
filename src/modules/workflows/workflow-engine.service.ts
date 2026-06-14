import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LeadStatus } from '@prisma/client';
import { MailService } from '../../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';

interface GraphNode {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
}

interface WorkflowGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

@Injectable()
export class WorkflowEngineService {
  private readonly logger = new Logger(WorkflowEngineService.name);

  // Hard ceiling on nodes executed per run. A ReactFlow graph can contain a
  // cycle (an edge back to an earlier node), which would otherwise recurse
  // forever via setImmediate — sending emails in a loop and draining quotas.
  private static readonly MAX_STEPS = 50;

  constructor(
    private prisma: PrismaService,
    private mailService: MailService,
    private notifications: NotificationsService,
  ) {}

  async triggerWorkflows(event: string, eventValue: string, leadId: string, tenantId: string) {
    // Events like tag_added / tag_removed / status_changed carry a meaningful
    // value (the tag label or status). A workflow with no triggerValue set must
    // NOT act as a wildcard for these events — that would cascade every such
    // workflow on every tag change and risk infinite loops between workflows.
    // Only broadcast-style events (contact_created, scheduled) may fire
    // workflows whose triggerValue is empty/null.
    const broadcastEvents = new Set(['contact_created', 'scheduled']);
    const triggerValueFilter = broadcastEvents.has(event)
      ? [{ triggerValue: eventValue }, { triggerValue: null }, { triggerValue: '' }]
      : [{ triggerValue: eventValue }];

    const activeWorkflows = await this.prisma.workflow.findMany({
      where: {
        tenantId,
        isActive: true,
        trigger: event,
        OR: triggerValueFilter,
      },
    });

    for (const workflow of activeWorkflows) {
      this.logger.log(`Triggering "${workflow.name}" for lead ${leadId} (event: ${eventValue})`);
      const execution = await this.prisma.workflowExecution.create({
        data: {
          workflowId: workflow.id,
          leadId,
          eventValue,
          status: 'running',
          currentStep: 0,
          currentNodeId: null,
        } as any,
      });
      this.executeFromNode(execution.id, null).catch((e) =>
        this.logger.error(`Execution error ${execution.id}`, e),
      );
    }
  }

  // Resume a waiting execution (called by scheduler after wait period elapses)
  async resumeExecution(executionId: string) {
    // Atomic claim: only the first concurrent caller gets count=1 — prevents
    // double-execution when scheduler and IMAP checker fire at the same time.
    const claimed = await this.prisma.workflowExecution.updateMany({
      where: { id: executionId, status: 'waiting' },
      data: { status: 'running' } as any,
    });
    if (claimed.count === 0) return; // Already running or completed

    const execution = await this.prisma.workflowExecution.findUnique({
      where: { id: executionId },
    });
    if (!execution) return;

    const nodeId = (execution as any).currentNodeId as string | null;
    await this.executeFromNode(executionId, nodeId);
  }

  private async executeFromNode(executionId: string, fromNodeId: string | null) {
    const execution = await this.prisma.workflowExecution.findUnique({
      where: { id: executionId },
      include: { workflow: true, lead: true },
    });
    if (!execution || execution.status !== 'running') return;

    const graph = this.extractGraph(execution.workflow.steps as unknown as any[]);
    if (!graph) {
      await this.complete(executionId);
      return;
    }

    // Find next node to execute
    const nextNode = fromNodeId === null
      ? this.findTriggerSuccessor(graph)  // Start: first node after trigger
      : this.findNextNode(graph, fromNodeId, null); // Continue after last executed node

    if (!nextNode || nextNode.type === 'end') {
      await this.complete(executionId);
      return;
    }

    await this.executeNode(executionId, nextNode, graph, execution.lead, execution.eventValue ?? '');
  }

  private async executeNode(
    executionId: string,
    node: GraphNode,
    graph: WorkflowGraph,
    lead: any,
    eventValue: string,
  ) {
    this.logger.log(`Executing node ${node.id} (${node.type}/${node.data.stepType ?? node.data.triggerType ?? ''}) for execution ${executionId}`);

    // Save current node + count this step atomically. The returned counter is
    // our loop guard: a cyclic graph would keep re-entering executeNode, so we
    // abort the run once it exceeds MAX_STEPS instead of looping forever.
    const updated = await this.prisma.workflowExecution.update({
      where: { id: executionId },
      data: { currentNodeId: node.id, currentStep: { increment: 1 } } as any,
    });

    if (((updated as any).currentStep ?? 0) > WorkflowEngineService.MAX_STEPS) {
      this.logger.error(
        `Execution ${executionId} exceeded ${WorkflowEngineService.MAX_STEPS} steps — aborting (probable cycle in workflow "${(lead && lead.tenantId) ?? ''}")`,
      );
      await this.prisma.workflowExecution.update({
        where: { id: executionId },
        data: { status: 'failed' },
      });
      await this.notifications
        .notifyTenantOwner(
          lead.tenantId,
          'workflow_failed',
          'Workflow arrêté',
          `Un workflow a été arrêté après ${WorkflowEngineService.MAX_STEPS} étapes (boucle probable dans le graphe).`,
        )
        .catch(() => null);
      return;
    }

    try {
      const stepType = (node.data.stepType as string) ?? node.type;

      // ── Condition nodes ────────────────────────────────────────────────────
      if (node.type === 'condition') {
        const conditionMet = await this.evaluateCondition(node, lead, eventValue);
        this.logger.log(`Condition "${stepType}" → ${conditionMet ? 'OUI' : 'NON'}`);

        const handle = conditionMet ? 'yes' : 'no';
        const nextNode = this.findNextNode(graph, node.id, handle);

        if (!nextNode || nextNode.type === 'end') {
          await this.complete(executionId);
        } else {
          setImmediate(() =>
            this.executeNode(executionId, nextNode, graph, lead, eventValue).catch(() => {}),
          );
        }
        return;
      }

      // ── send_email ─────────────────────────────────────────────────────────
      if (stepType === 'send_email') {
        if (lead?.email) {
          const rawValue = (node.data.value as string) ?? '';
          const rawSubject = (node.data.subject as string) || 'Message automatique — AIKOONIC';
          const firstName = lead.firstName ?? 'Client';
          const body    = rawValue.replace(/\{\{prenom\}\}/gi, firstName);
          const subject = rawSubject.replace(/\{\{prenom\}\}/gi, firstName);
          await this.mailService.sendWorkflowEmail(lead.email, subject, body);
        }
        await this.advanceToNext(executionId, node.id, graph, lead, eventValue);
        return;
      }

      // ── wait ──────────────────────────────────────────────────────────────
      if (stepType === 'wait') {
        const qty = Number((node.data.delayDays as number) ?? (node.data.value as string) ?? 1) || 1;
        const unit = (node.data.delayUnit as string) ?? 'jours';
        const msPerUnit: Record<string, number> = {
          minutes: 60 * 1000,
          heures: 60 * 60 * 1000,
          jours: 24 * 60 * 60 * 1000,
        };
        const ms = qty * (msPerUnit[unit] ?? msPerUnit.jours);
        const resumeAt = new Date(Date.now() + ms);
        await this.prisma.workflowExecution.update({
          where: { id: executionId },
          data: { status: 'waiting', resumeAt } as any,
        });
        this.logger.log(`Execution ${executionId} waiting ${qty} ${unit} until ${resumeAt.toISOString()}`);
        // currentNodeId is already saved — scheduler will resume from here
        return;
      }

      // ── change_status ─────────────────────────────────────────────────────
      if (stepType === 'change_status') {
        await this.prisma.lead.update({
          where: { id: lead.id },
          data: { status: (node.data.value as string) as LeadStatus },
        });
        await this.advanceToNext(executionId, node.id, graph, lead, eventValue);
        return;
      }

      // ── add_tag ───────────────────────────────────────────────────────────
      if (stepType === 'add_tag') {
        const tag = await this.prisma.tag.upsert({
          where: { label_tenantId: { label: node.data.value as string, tenantId: lead.tenantId } },
          create: { label: node.data.value as string, tenantId: lead.tenantId },
          update: {},
        });
        await this.prisma.lead.update({
          where: { id: lead.id },
          data: { tags: { connect: { id: tag.id } } },
        });
        await this.advanceToNext(executionId, node.id, graph, lead, eventValue);
        return;
      }

      // ── remove_tag ────────────────────────────────────────────────────────
      if (stepType === 'remove_tag') {
        const tag = await this.prisma.tag.findUnique({
          where: { label_tenantId: { label: node.data.value as string, tenantId: lead.tenantId } },
        });
        if (tag) {
          await this.prisma.lead.update({
            where: { id: lead.id },
            data: { tags: { disconnect: { id: tag.id } } },
          });
        }
        await this.advanceToNext(executionId, node.id, graph, lead, eventValue);
        return;
      }

      // ── create_note ───────────────────────────────────────────────────────
      if (stepType === 'create_note') {
        const timestamp = new Date().toISOString().slice(0, 10);
        const note = `[${timestamp}] ${node.data.value as string}`;
        const currentLead = await this.prisma.lead.findUnique({ where: { id: lead.id } });
        await this.prisma.lead.update({
          where: { id: lead.id },
          data: { notes: currentLead?.notes ? `${currentLead.notes}\n${note}` : note },
        });
        await this.advanceToNext(executionId, node.id, graph, lead, eventValue);
        return;
      }

      // Unknown — skip
      await this.advanceToNext(executionId, node.id, graph, lead, eventValue);

    } catch (error: unknown) {
      this.logger.error(`Error on node ${node.id}`, (error as Error).stack);
      await this.prisma.workflowExecution.update({
        where: { id: executionId },
        data: { status: 'failed' },
      });
      const leadName =
        [lead?.firstName, lead?.lastName].filter(Boolean).join(' ') || lead?.email || 'un lead';
      await this.notifications
        .notifyTenantOwner(
          lead.tenantId,
          'workflow_failed',
          'Workflow échoué',
          `Le workflow a échoué pour ${leadName} : ${(error as Error).message}`,
        )
        .catch(() => null); // Never mask the original failure
    }
  }

  private async evaluateCondition(node: GraphNode, lead: any, eventValue: string): Promise<boolean> {
    const stepType = node.data.stepType as string;
    const value = (node.data.value as string) ?? '';

    if (stepType === 'check_tag') {
      const freshLead = await this.prisma.lead.findUnique({
        where: { id: lead.id },
        include: { tags: true },
      });
      return freshLead?.tags?.some(t => t.label === value) ?? false;
    }
    if (stepType === 'check_status') {
      const freshLead = await this.prisma.lead.findUnique({ where: { id: lead.id } });
      return (freshLead?.status ?? '') === value;
    }
    if (stepType === 'check_field') {
      try {
        const { field, operator, value: cmpVal } = JSON.parse(value) as { field: string; operator: string; value: string };
        const freshLead = await this.prisma.lead.findUnique({ where: { id: lead.id } });
        const fieldVal = String((freshLead as any)?.[field] ?? '').toLowerCase();
        const cv = cmpVal.toLowerCase();
        if (operator === 'eq')           return fieldVal === cv;
        if (operator === 'neq')          return fieldVal !== cv;
        if (operator === 'contains')     return fieldVal.includes(cv);
        if (operator === 'not_contains') return !fieldVal.includes(cv);
        if (operator === 'starts_with')  return fieldVal.startsWith(cv);
        if (operator === 'is_empty')     return fieldVal === '';
        if (operator === 'is_not_empty') return fieldVal !== '';
      } catch { /**/ }
      return false;
    }
    return false;
  }

  private async advanceToNext(
    executionId: string,
    currentNodeId: string,
    graph: WorkflowGraph,
    lead: any,
    eventValue: string,
  ) {
    const next = this.findNextNode(graph, currentNodeId, null);
    if (!next || next.type === 'end') {
      await this.complete(executionId);
    } else {
      const execution = await this.prisma.workflowExecution.findUnique({ where: { id: executionId } });
      if (execution?.status !== 'running') return;
      setImmediate(() =>
        this.executeNode(executionId, next, graph, lead, eventValue).catch(() => {}),
      );
    }
  }

  private findNextNode(graph: WorkflowGraph, sourceNodeId: string, handle: string | null): GraphNode | null {
    // Follow edge from sourceNodeId with matching sourceHandle (or any handle if handle is null)
    const edge = graph.edges.find(
      (e) => e.source === sourceNodeId && (handle === null ? e.sourceHandle !== 'no' : e.sourceHandle === handle),
    ) ?? graph.edges.find((e) => e.source === sourceNodeId);

    if (!edge) return null;
    return graph.nodes.find((n) => n.id === edge.target) ?? null;
  }

  private findTriggerSuccessor(graph: WorkflowGraph): GraphNode | null {
    const trigger = graph.nodes.find((n) => n.type === 'trigger');
    if (!trigger) return null;
    return this.findNextNode(graph, trigger.id, null);
  }

  private extractGraph(steps: any[]): WorkflowGraph | null {
    const graphStep = steps?.find((s) => s.type === '__graph__');
    if (!graphStep?.value) return null;
    try {
      const parsed = JSON.parse(graphStep.value) as WorkflowGraph;
      if (parsed.nodes?.length) return parsed;
    } catch { /**/ }
    return null;
  }

  private async complete(executionId: string) {
    await this.prisma.workflowExecution.update({
      where: { id: executionId },
      data: { status: 'completed', completedAt: new Date() },
    });
    this.logger.log(`Execution ${executionId} completed`);
  }

  // Called by old linear code path (backward compat) — can be removed later
  async executeStep(executionId: string) {
    const execution = await this.prisma.workflowExecution.findUnique({
      where: { id: executionId },
      include: { workflow: true },
    });
    if (!execution) return;
    const graph = this.extractGraph(execution.workflow.steps as unknown as any[]);
    if (graph) {
      await this.prisma.workflowExecution.update({
        where: { id: executionId },
        data: { status: 'running' } as any,
      });
      await this.executeFromNode(executionId, null);
    }
  }
}

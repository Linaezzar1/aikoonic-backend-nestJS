import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class QuotaService {
  constructor(private prisma: PrismaService) {}

  /**
   * Check the monthly quota for `featureKey` scoped to the given tenant,
   * then log one usage entry. Throws 403 if the plan limit is reached.
   *
   * No-ops silently when the tenant has no linked company or no active
   * subscription (so unlinked tenants can still operate during onboarding).
   */
  async checkAndLog(tenantId: string, featureKey: string): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { companyId: true },
    });
    if (!tenant?.companyId) return;

    const companyId = tenant.companyId;

    const sub = await this.prisma.subscriptions.findFirst({
      where: { company_id: companyId, status: 'active' },
      include: { plan: true },
      orderBy: { created_at: 'desc' },
    });
    if (!sub) return;

    const featureConfig = (sub.plan.features as Record<string, { monthly?: number | null }>)[featureKey];
    const limit: number | null | undefined = featureConfig?.monthly;
    // null  = unlimited (Premium "sans limites") — skip quota check entirely
    // undefined = feature not tracked on this plan — also skip
    if (limit == null) return;

    // Period anchored to the subscription start day (anniversary billing), NOT
    // the calendar 1st. This matches subscriptions.service.ts and the FastAPI
    // backend so all three systems agree on period boundaries.
    const periodStart = this.currentPeriodStart(sub.started_at);

    const used = await this.prisma.usage_logs.count({
      where: {
        company_id: companyId,
        feature_key: featureKey,
        used_at: { gte: periodStart },
      },
    });

    if (used >= limit) {
      throw new ForbiddenException(
        `Monthly limit reached for '${featureKey}' (${used}/${limit}). Upgrade your plan to continue.`,
      );
    }

    await this.prisma.usage_logs.create({
      data: {
        id: crypto.randomUUID(),
        company_id: companyId,
        feature_key: featureKey,
        period_start: periodStart,
      },
    });
  }

  private currentPeriodStart(anchor: Date): Date {
    const now = new Date();
    const day = anchor.getUTCDate();
    const clamp = (year: number, month: number) => {
      const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      return new Date(Date.UTC(year, month, Math.min(day, lastDay)));
    };
    let start = clamp(now.getUTCFullYear(), now.getUTCMonth());
    if (start > now) start = clamp(now.getUTCFullYear(), now.getUTCMonth() - 1);
    return start;
  }
}

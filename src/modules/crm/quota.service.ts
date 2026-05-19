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

    const featureConfig = (sub.plan.features as Record<string, { monthly?: number }>)[featureKey];
    const limit: number | undefined = featureConfig?.monthly;
    if (limit === undefined) return; // feature not quota-tracked on this plan

    const periodStart = new Date();
    periodStart.setUTCDate(1);
    periodStart.setUTCHours(0, 0, 0, 0);

    const used = await this.prisma.usage_logs.count({
      where: {
        company_id: companyId,
        feature_key: featureKey,
        period_start: { gte: periodStart },
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
}

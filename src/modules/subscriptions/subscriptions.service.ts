  import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../core/redis/redis.service';

@Injectable()
export class SubscriptionsService {
  private stripe: Stripe | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
  ) {
    const key = this.config.get<string>('STRIPE_SECRET_KEY');
    if (key) {
      this.stripe = new Stripe(key, { apiVersion: '2025-02-24.acacia' });
    }
  }

  // ── Plans ────────────────────────────────────────────────────────────────────

  async listPlans() {
    return this.prisma.plans.findMany({
      where: { is_active: true },
      orderBy: { price_monthly_cents: 'asc' },
    });
  }

  // ── Subscription read ─────────────────────────────────────────────────────────

  async getMySubscription(userId: string) {
    const company = await this.prisma.companies.findFirst({
      where: { user_id: userId },
    });
    if (!company) return null;

    const sub = await this.prisma.subscriptions.findFirst({
      where: { company_id: company.id, status: 'active' },
      include: { plan: true },
      orderBy: { created_at: 'desc' },
    });
    return sub;
  }

  // ── Select freemium plan (no Stripe) ─────────────────────────────────────────

  async selectPlan(userId: string, planSlug: string) {
    const company = await this._requireCompany(userId);
    const plan = await this._requirePlan(planSlug);

    if (plan.price_monthly_cents > 0) {
      throw new BadRequestException(
        'Paid plans require Stripe Checkout. Use POST /subscriptions/checkout.',
      );
    }

    await this.prisma.subscriptions.updateMany({
      where: { company_id: company.id, status: 'active' },
      data: { status: 'cancelled' },
    });

    const sub = await this.prisma.subscriptions.create({
      data: {
        id: crypto.randomUUID(),
        company_id: company.id,
        plan_id: plan.id,
        status: 'active',
        period_type: 'monthly',
      },
      include: { plan: true },
    });
    await this.redis.setQuota(company.id, plan.features as Record<string, any>);
    return sub;
  }

  // ── Stripe Checkout ───────────────────────────────────────────────────────────

  async createCheckoutSession(
    userId: string,
    planSlug: string,
    successUrl?: string,
    cancelUrl?: string,
  ) {
    this._requireStripe();
    const frontendUrl = this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';
    const company = await this._requireCompany(userId);
    const plan = await this._requirePlan(planSlug);

    if (plan.price_monthly_cents === 0) {
      throw new BadRequestException('Freemium plan is free — use POST /subscriptions/select.');
    }

    const priceId = this.config.get<string>('STRIPE_PREMIUM_PRICE_ID');
    if (!priceId) {
      throw new ServiceUnavailableException('Stripe price ID not configured.');
    }

    // Retrieve or create Stripe customer
    const existingSub = await this.prisma.subscriptions.findFirst({
      where: { company_id: company.id, status: 'active' },
      orderBy: { started_at: 'desc' },
    });
    let stripeCustomerId: string | null = existingSub?.stripe_customer_id ?? null;

    if (!stripeCustomerId) {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      const customer = await this.stripe!.customers.create({
        email: user?.email,
        name: company.company_name ?? undefined,
        metadata: { company_id: company.id },
      });
      stripeCustomerId = customer.id;
    }

    const session = await this.stripe!.checkout.sessions.create({
      customer: stripeCustomerId,
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: successUrl ?? `${frontendUrl}/select-plan/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl ?? `${frontendUrl}/select-plan`,
      metadata: {
        company_id: company.id,
        plan_slug: planSlug,
        stripe_customer_id: stripeCustomerId,
      },
    });

    return { checkout_url: session.url, session_id: session.id };
  }

  // ── Verify Checkout Session (fallback — webhook may not reach localhost) ──────

  async verifyCheckoutSession(sessionId: string) {
    this._requireStripe();
    let session: Stripe.Checkout.Session;
    try {
      session = await this.stripe!.checkout.sessions.retrieve(sessionId);
    } catch (err: any) {
      throw new BadRequestException(err.message);
    }

    if (session.payment_status !== 'paid') return { status: 'pending' };

    const companyId = session.metadata?.company_id;
    const planSlug = session.metadata?.plan_slug ?? 'premium';
    const stripeCustomerId = session.customer as string;
    const stripeSubscriptionId = session.subscription as string;

    if (!companyId) throw new BadRequestException('Missing company_id in session metadata.');

    const alreadyActive = await this.prisma.subscriptions.findFirst({
      where: {
        company_id: companyId,
        status: 'active',
        plan: { slug: planSlug },
      },
    });
    if (alreadyActive) return { status: 'active' };

    await this._activateSubscription(companyId, planSlug, stripeCustomerId, stripeSubscriptionId);
    return { status: 'active' };
  }

  // ── Stripe Customer Portal ────────────────────────────────────────────────────

  async createPortalSession(userId: string, returnUrl?: string) {
    this._requireStripe();
    const frontendUrl = this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';
    const company = await this._requireCompany(userId);

    const sub = await this.prisma.subscriptions.findFirst({
      where: { company_id: company.id, status: 'active' },
      orderBy: { started_at: 'desc' },
    });
    if (!sub?.stripe_customer_id) {
      throw new NotFoundException('No Stripe subscription found.');
    }

    const portalSession = await this.stripe!.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: returnUrl ?? `${frontendUrl}/select-plan`,
    });
    return { portal_url: portalSession.url };
  }

  // ── Usage tracking ────────────────────────────────────────────────────────────

  async trackUsage(userId: string, featureKey: string) {
    const company = await this._requireCompany(userId);
    const sub = await this.prisma.subscriptions.findFirst({
      where: { company_id: company.id, status: 'active' },
      include: { plan: true },
      orderBy: { created_at: 'desc' },
    });
    if (!sub) throw new ForbiddenException('No active subscription.');

    const periodStart = new Date(new Date().toISOString().slice(0, 7) + '-01');
    const features = (sub.plan.features as Record<string, any>) ?? {};
    const meta = features[featureKey];
    const limit: number | null = typeof meta === 'object' ? meta?.monthly ?? null : null;

    const used = await this.prisma.usage_logs.count({
      where: {
        company_id: company.id,
        feature_key: featureKey,
        period_start: periodStart,
      },
    });

    if (limit !== null && used >= limit) {
      return { allowed: false, used, limit };
    }

    return { allowed: true, used, limit };
  }

  async getUsageSummary(userId: string) {
    const company = await this._requireCompany(userId);
    const sub = await this.prisma.subscriptions.findFirst({
      where: { company_id: company.id, status: 'active' },
      include: { plan: true },
      orderBy: { created_at: 'desc' },
    });
    if (!sub) throw new NotFoundException('No active subscription.');

    const periodStart = new Date(new Date().toISOString().slice(0, 7) + '-01');
    const rows = await this.prisma.usage_logs.groupBy({
      by: ['feature_key'],
      where: { company_id: company.id, period_start: periodStart },
      _count: { id: true },
    });
    const usageMap: Record<string, number> = {};
    for (const r of rows) usageMap[r.feature_key] = r._count.id;

    const features = (sub.plan.features as Record<string, any>) ?? {};
    const usage = Object.entries(features).map(([key, meta]) => {
      const limit: number | null = typeof meta === 'object' ? meta?.monthly ?? null : null;
      const used = usageMap[key] ?? 0;
      return { feature_key: key, used, limit, percent: limit ? Math.round((used / limit) * 1000) / 10 : null };
    });

    return { plan: sub.plan, usage };
  }

  // ── Stripe Webhook ────────────────────────────────────────────────────────────

  async handleWebhook(rawBody: Buffer, sigHeader: string): Promise<{ status: string; type: string }> {
    this._requireStripe();
    const webhookSecret = this.config.get<string>('STRIPE_WEBHOOK_SECRET') ?? '';
    let event: Stripe.Event;

    try {
      if (webhookSecret) {
        event = this.stripe!.webhooks.constructEvent(rawBody, sigHeader, webhookSecret);
      } else {
        event = JSON.parse(rawBody.toString()) as Stripe.Event;
      }
    } catch (err: any) {
      throw new BadRequestException(`Invalid Stripe payload: ${err.message}`);
    }

    const { id: stripeEventId, type: eventType, livemode } = event;

    const existing = await this.prisma.webhook_events.findUnique({
      where: { stripe_event_id: stripeEventId },
    });
    if (existing) return { status: 'already_processed', type: eventType };

    let status = 'ignored';
    let errorMessage: string | null = null;

    try {
      const obj = (event.data as any).object;
      if (eventType === 'checkout.session.completed') status = await this._onCheckoutCompleted(obj);
      else if (eventType === 'invoice.payment_succeeded') status = await this._onInvoicePaid(obj);
      else if (eventType === 'invoice.payment_failed') status = await this._onInvoiceFailed(obj);
      else if (eventType === 'customer.subscription.updated') status = await this._onSubUpdated(obj);
      else if (eventType === 'customer.subscription.deleted') status = await this._onSubDeleted(obj);
      else if (eventType === 'customer.subscription.paused') status = await this._onSubPaused(obj);
      else if (eventType === 'customer.subscription.resumed') status = await this._onSubResumed(obj);
    } catch (err: any) {
      status = 'error';
      errorMessage = err.message;
    }

    try {
      await this.prisma.webhook_events.create({
        data: {
          id: crypto.randomUUID(),
          stripe_event_id: stripeEventId,
          event_type: eventType,
          status,
          error_message: errorMessage,
          livemode: Boolean(livemode),
          raw_payload: JSON.parse(rawBody.toString()),
        },
      });
    } catch {}

    if (status === 'error') throw new InternalServerErrorException(errorMessage ?? 'Webhook processing failed');
    return { status, type: eventType };
  }

  // ── Admin ─────────────────────────────────────────────────────────────────────

  async adminListPlans() {
    const plans = await this.prisma.plans.findMany({ orderBy: { price_monthly_cents: 'asc' } });
    const counts = await this.prisma.subscriptions.groupBy({
      by: ['plan_id'],
      where: { status: 'active' },
      _count: { id: true },
    });
    const countMap = Object.fromEntries(counts.map((c) => [c.plan_id, c._count.id]));
    return plans.map((p) => ({ ...p, subscriber_count: countMap[p.id] ?? 0 }));
  }

  async adminPatchPlan(planId: string, body: {
    name?: string;
    price_monthly_cents?: number;
    features?: Record<string, any>;
    is_active?: boolean;
  }) {
    const plan = await this.prisma.plans.findUnique({ where: { id: planId } });
    if (!plan) throw new NotFoundException('Plan not found');
    const updated = await this.prisma.plans.update({ where: { id: planId }, data: body });
    // Refresh Redis quota for all active subscribers of this plan
    if (body.features) {
      const subs = await this.prisma.subscriptions.findMany({
        where: { plan_id: planId, status: 'active' },
      });
      await Promise.all(subs.map((s) => this.redis.setQuota(s.company_id, body.features!)));
    }
    const count = await this.prisma.subscriptions.count({ where: { plan_id: planId, status: 'active' } });
    return { ...updated, subscriber_count: count };
  }

  async adminListSubscriptions(params: { status?: string; skip?: number; limit?: number }) {
    const where = params.status ? { status: params.status } : {};
    const rows = await this.prisma.subscriptions.findMany({
      where,
      include: { plan: true },
      orderBy: { started_at: 'desc' },
      skip: params.skip ?? 0,
      take: params.limit ?? 50,
    });
    const companyIds = [...new Set(rows.map((r) => r.company_id))];
    const companies = await this.prisma.companies.findMany({
      where: { id: { in: companyIds } },
      select: { id: true, company_name: true },
    });
    const companyMap = Object.fromEntries(companies.map((c) => [c.id, c.company_name]));
    return rows.map((s) => ({
      id: s.id,
      company_id: s.company_id,
      company_name: companyMap[s.company_id] ?? null,
      plan_name: s.plan.name,
      plan_slug: s.plan.slug,
      status: s.status,
      period_type: s.period_type,
      started_at: s.started_at.toISOString(),
      ends_at: s.ends_at?.toISOString() ?? null,
      stripe_customer_id: s.stripe_customer_id,
      stripe_subscription_id: s.stripe_subscription_id,
    }));
  }

  async adminAssignPlan(companyId: string, planSlug: string) {
    const company = await this.prisma.companies.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Company not found');
    const plan = await this._requirePlan(planSlug);
    await this.prisma.subscriptions.updateMany({
      where: { company_id: companyId, status: 'active' },
      data: { status: 'cancelled', ends_at: new Date() },
    });
    const sub = await this.prisma.subscriptions.create({
      data: {
        id: crypto.randomUUID(),
        company_id: companyId,
        plan_id: plan.id,
        status: 'active',
        period_type: 'monthly',
      },
    });
    await this.redis.setQuota(companyId, plan.features as Record<string, any>);
    return { ok: true, plan: plan.slug, subscription_id: sub.id };
  }

  async adminListWebhookEvents(params: {
    event_type?: string;
    status?: string;
    skip?: number;
    limit?: number;
  }) {
    const where: any = {};
    if (params.event_type) where.event_type = params.event_type;
    if (params.status) where.status = params.status;
    return this.prisma.webhook_events.findMany({
      where,
      orderBy: { processed_at: 'desc' },
      skip: params.skip ?? 0,
      take: params.limit ?? 100,
    });
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  private _requireStripe() {
    if (!this.stripe) throw new ServiceUnavailableException('Stripe not configured on server.');
  }

  private async _requireCompany(userId: string) {
    const company = await this.prisma.companies.findFirst({ where: { user_id: userId } });
    if (!company) throw new NotFoundException('Company not found for this user.');
    return company;
  }

  private async _requirePlan(slug: string) {
    const plan = await this.prisma.plans.findFirst({ where: { slug, is_active: true } });
    if (!plan) throw new NotFoundException(`Plan '${slug}' not found.`);
    return plan;
  }

  private async _activateSubscription(
    companyId: string,
    planSlug: string,
    stripeCustomerId: string,
    stripeSubscriptionId: string,
  ) {
    const plan = await this._requirePlan(planSlug);
    await this.prisma.subscriptions.updateMany({
      where: { company_id: companyId, status: 'active' },
      data: { status: 'cancelled', ends_at: new Date() },
    });
    await this.prisma.subscriptions.create({
      data: {
        id: crypto.randomUUID(),
        company_id: companyId,
        plan_id: plan.id,
        status: 'active',
        period_type: 'monthly',
        stripe_customer_id: stripeCustomerId,
        stripe_subscription_id: stripeSubscriptionId,
      },
    });
    // Invalidate FastAPI quota cache immediately — new plan features take effect now
    await this.redis.setQuota(companyId, plan.features as Record<string, any>);
  }

  private async _onCheckoutCompleted(session: any): Promise<string> {
    const companyId = session.metadata?.company_id;
    if (!companyId) return 'ignored';
    await this._activateSubscription(
      companyId,
      session.metadata?.plan_slug ?? 'premium',
      session.customer,
      session.subscription,
    );
    return 'processed';
  }

  private async _onInvoicePaid(invoice: any): Promise<string> {
    const subId = invoice.subscription;
    if (!subId) return 'ignored';
    const sub = await this.prisma.subscriptions.findFirst({ where: { stripe_subscription_id: subId } });
    if (!sub) return 'ignored';
    const periodEnd = invoice.period_end;
    await this.prisma.subscriptions.update({
      where: { id: sub.id },
      data: {
        status: 'active',
        ends_at: periodEnd ? new Date(periodEnd * 1000) : undefined,
      },
    });
    return 'processed';
  }

  private async _onInvoiceFailed(invoice: any): Promise<string> {
    const subId = invoice.subscription;
    if (!subId) return 'ignored';
    const sub = await this.prisma.subscriptions.findFirst({ where: { stripe_subscription_id: subId } });
    if (!sub) return 'ignored';
    await this.prisma.subscriptions.update({ where: { id: sub.id }, data: { status: 'past_due' } });
    return 'processed';
  }

  private async _onSubUpdated(stripeSub: any): Promise<string> {
    const sub = await this.prisma.subscriptions.findFirst({ where: { stripe_subscription_id: stripeSub.id } });
    if (!sub) return 'ignored';
    const statusMap: Record<string, string> = {
      active: 'active', past_due: 'past_due', canceled: 'cancelled', unpaid: 'past_due',
      paused: 'paused', incomplete: 'pending', incomplete_expired: 'cancelled', trialing: 'active',
    };
    const updates: any = { status: statusMap[stripeSub.status] ?? stripeSub.status };
    if (stripeSub.current_period_end) updates.ends_at = new Date(stripeSub.current_period_end * 1000);

    try {
      const priceId = stripeSub.items?.data?.[0]?.price?.id;
      if (priceId) {
        const plan = await this.prisma.plans.findFirst({ where: { stripe_price_id: priceId, is_active: true } });
        if (plan && plan.id !== sub.plan_id) updates.plan_id = plan.id;
      }
    } catch {}

    await this.prisma.subscriptions.update({ where: { id: sub.id }, data: updates });
    return 'processed';
  }

  private async _onSubDeleted(stripeSub: any): Promise<string> {
    const sub = await this.prisma.subscriptions.findFirst({ where: { stripe_subscription_id: stripeSub.id } });
    if (!sub) return 'ignored';
    await this.prisma.subscriptions.update({ where: { id: sub.id }, data: { status: 'cancelled', ends_at: new Date() } });
    // Clear quota cache — FastAPI will fall back to DB (no active subscription → 403)
    await this.redis.deleteQuota(sub.company_id);
    return 'processed';
  }

  private async _onSubPaused(stripeSub: any): Promise<string> {
    const sub = await this.prisma.subscriptions.findFirst({ where: { stripe_subscription_id: stripeSub.id } });
    if (!sub) return 'ignored';
    await this.prisma.subscriptions.update({ where: { id: sub.id }, data: { status: 'paused' } });
    await this.redis.deleteQuota(sub.company_id);
    return 'processed';
  }

  private async _onSubResumed(stripeSub: any): Promise<string> {
    const sub = await this.prisma.subscriptions.findFirst({ where: { stripe_subscription_id: stripeSub.id } });
    if (!sub) return 'ignored';
    const updates: any = { status: 'active' };
    if (stripeSub.current_period_end) updates.ends_at = new Date(stripeSub.current_period_end * 1000);
    await this.prisma.subscriptions.update({ where: { id: sub.id }, data: updates });
    return 'processed';
  }
}

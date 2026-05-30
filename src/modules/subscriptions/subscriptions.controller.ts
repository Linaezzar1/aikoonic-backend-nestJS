import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  RawBodyRequest,
  Headers,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SubscriptionsService } from './subscriptions.service';
import { SelectPlanDto, CheckoutDto, PortalDto, TrackUsageDto } from './dto/subscription.dto';

@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly service: SubscriptionsService) {}

  // ── Public ───────────────────────────────────────────────────────────────────

  @Get('plans')
  listPlans() {
    return this.service.listPlans();
  }

  /** Stripe webhook — must receive raw body for signature verification */
  @Post('webhook')
  async stripeWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') sig: string,
  ) {
    return this.service.handleWebhook(req.rawBody!, sig);
  }

  // ── Authenticated ─────────────────────────────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Get('my')
  getMySubscription(@CurrentUser() user: any) {
    return this.service.getMySubscription(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('select')
  selectPlan(@CurrentUser() user: any, @Body() dto: SelectPlanDto) {
    return this.service.selectPlan(user.id, dto.plan_slug);
  }

  @UseGuards(JwtAuthGuard)
  @Post('checkout')
  createCheckout(@CurrentUser() user: any, @Body() dto: CheckoutDto) {
    return this.service.createCheckoutSession(user.id, dto.plan_slug, dto.success_url, dto.cancel_url);
  }

  @UseGuards(JwtAuthGuard)
  @Get('verify-session')
  verifySession(@Query('session_id') sessionId: string) {
    return this.service.verifyCheckoutSession(sessionId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('portal')
  createPortal(@CurrentUser() user: any, @Body() dto: PortalDto) {
    return this.service.createPortalSession(user.id, dto.return_url);
  }

  @UseGuards(JwtAuthGuard)
  @Get('usage')
  getUsage(@CurrentUser() user: any) {
    return this.service.getUsageSummary(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('usage/track')
  trackUsage(@CurrentUser() user: any, @Body() dto: TrackUsageDto) {
    return this.service.trackUsage(user.id, dto.feature_key);
  }

  // ── Admin ─────────────────────────────────────────────────────────────────────

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('admin/plans')
  adminListPlans() {
    return this.service.adminListPlans();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Patch('admin/plans/:id')
  adminPatchPlan(@Param('id') id: string, @Body() body: any) {
    return this.service.adminPatchPlan(id, body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('admin/subscriptions')
  adminListSubscriptions(
    @Query('status') status?: string,
    @Query('skip') skip?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.adminListSubscriptions({
      status,
      skip: skip ? parseInt(skip) : undefined,
      limit: limit ? parseInt(limit) : undefined,
    });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('admin/companies/:id/plan')
  adminAssignPlan(@Param('id') companyId: string, @Body() body: { plan_slug: string }) {
    return this.service.adminAssignPlan(companyId, body.plan_slug);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('admin/webhook-events')
  adminListWebhookEvents(
    @Query('event_type') event_type?: string,
    @Query('status') status?: string,
    @Query('skip') skip?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.adminListWebhookEvents({
      event_type,
      status,
      skip: skip ? parseInt(skip) : undefined,
      limit: limit ? parseInt(limit) : undefined,
    });
  }
}

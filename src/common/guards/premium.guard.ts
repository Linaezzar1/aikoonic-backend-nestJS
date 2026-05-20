import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * PremiumGuard — blocks requests from users who do not have an active
 * Premium subscription.
 *
 * Must be used AFTER JwtAuthGuard so that `request.user` is populated.
 *
 * Flow:
 *   JWT user → tenant → company → active subscription → plan.slug === "premium"
 *
 * Silently allows requests when the tenant has no linked company yet
 * (onboarding not completed) so new users are not blocked during setup.
 */
@Injectable()
export class PremiumGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const user = req.user as { id?: string; tenantId?: string | null } | undefined;

    if (!user?.tenantId) {
      // No tenant → onboarding incomplete; block with a clear message
      throw new ForbiddenException(
        'Veuillez compléter votre profil avant d\'accéder à cette fonctionnalité.',
      );
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: user.tenantId },
      select: { companyId: true },
    });

    if (!tenant?.companyId) {
      // Tenant exists but has no company yet — still onboarding
      throw new ForbiddenException(
        'Votre profil d\'entreprise est en cours de création. Réessayez dans quelques instants.',
      );
    }

    const sub = await this.prisma.subscriptions.findFirst({
      where: { company_id: tenant.companyId, status: 'active' },
      include: { plan: { select: { slug: true } } },
      orderBy: { created_at: 'desc' },
    });

    if (sub?.plan?.slug !== 'premium') {
      throw new ForbiddenException(
        'Cette fonctionnalité est réservée au plan Premium. ' +
        'Passez au Pro sur /select-plan pour y accéder.',
      );
    }

    return true;
  }
}

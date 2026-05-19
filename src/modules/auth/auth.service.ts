import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: string;
  firstName: string | null;
  lastName: string | null;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  user: AuthenticatedUser & { tenantId: string };
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private config: ConfigService,
  ) {}

  async register(dto: RegisterDto): Promise<IssuedTokens> {
    const email = dto.email.trim().toLowerCase();
    const exists = await this.prisma.user.findUnique({ where: { email } });
    if (exists) throw new ConflictException('Email already in use');

    const hashed = await bcrypt.hash(dto.password, 12);
    const user = await this.prisma.user.create({
      data: {
        email,
        password: hashed,
        firstName: dto.firstName?.trim() || null,
        lastName: dto.lastName?.trim() || null,
      },
    });

    return this._issueTokens(user);
  }

  async login(dto: LoginDto): Promise<IssuedTokens> {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Constant-time-ish branch: always run bcrypt.compare even on missing user
    // so an attacker cannot infer account existence from response timing.
    const hashToCompare = user?.password ?? '$2b$12$invaliddummyhashvaluefordefenceonly00000000000000';
    const valid = await bcrypt.compare(dto.password, hashToCompare);
    if (!user || !user.isActive || !valid) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this._issueTokens(user);
  }

  async refresh(token: string): Promise<IssuedTokens> {
    const stored = await this.prisma.refreshToken.findUnique({ where: { token } });
    if (!stored || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.prisma.user.findUnique({ where: { id: stored.userId } });
    if (!user || !user.isActive) throw new UnauthorizedException('User not found');

    // Rotate atomically: delete old, then issue new. If issue fails, the old
    // token is already gone — the user will re-login. This is by design (no
    // dangling refresh tokens).
    await this.prisma.refreshToken.delete({ where: { id: stored.id } }).catch(() => null);
    return this._issueTokens(user);
  }

  async logout(token: string): Promise<{ message: string }> {
    await this.prisma.refreshToken.deleteMany({ where: { token } }).catch(() => null);
    return { message: 'Logged out' };
  }

  async getMe(userId: string): Promise<AuthenticatedUser & { tenantId: string | null }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) throw new UnauthorizedException('User not found');
    const tenant = await this._findTenant(userId);
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      firstName: user.firstName,
      lastName: user.lastName,
      tenantId: tenant?.id ?? null,
    };
  }

  // ── Profile mutations ─────────────────────────────────────────────────────

  async updateProfile(
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<AuthenticatedUser & { tenantId: string | null }> {
    // Treat empty strings as "clear the field". Trim whitespace.
    const firstName = dto.firstName == null ? undefined : dto.firstName.trim() || null;
    const lastName = dto.lastName == null ? undefined : dto.lastName.trim() || null;

    const data: { firstName?: string | null; lastName?: string | null } = {};
    if (firstName !== undefined) data.firstName = firstName;
    if (lastName !== undefined) data.lastName = lastName;

    if (Object.keys(data).length === 0) {
      // Nothing to change — just return current state instead of a no-op write.
      return this.getMe(userId);
    }

    await this.prisma.user.update({ where: { id: userId }, data });
    return this.getMe(userId);
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) throw new UnauthorizedException('User not found');

    const valid = await bcrypt.compare(dto.currentPassword, user.password);
    if (!valid) {
      throw new BadRequestException('Mot de passe actuel incorrect');
    }
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException(
        'Le nouveau mot de passe doit être différent de l\'ancien',
      );
    }

    const hashed = await bcrypt.hash(dto.newPassword, 12);
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashed },
    });

    // Security: invalidate every existing refresh token for this user.
    // The current session's token will be re-issued by the caller (controller
    // calls `_issueTokens` again so the cookie stays fresh on the active device).
    await this.prisma.refreshToken.deleteMany({ where: { userId } });
  }

  /** Re-issue tokens for a user — used after password change. */
  async reissueForUser(userId: string): Promise<IssuedTokens> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) throw new UnauthorizedException('User not found');
    return this._issueTokens(user);
  }

  // ── Tenant resolution ─────────────────────────────────────────────────────
  // Every authenticated user gets exactly one Tenant, identified by user_id.
  // If the user has completed onboarding (created a FastAPI company), the
  // Tenant also links to that company. Otherwise the Tenant is "personal".

  private async _findTenant(userId: string) {
    return this.prisma.tenant.findUnique({ where: { userId } });
  }

  private async _resolveOrCreateTenant(userId: string): Promise<string> {
    // Fast path: tenant already exists for this user.
    const existing = await this.prisma.tenant.findUnique({ where: { userId } });
    if (existing) {
      // If user has since completed onboarding, link the company.
      if (!existing.companyId) {
        const company = await this.prisma.companies.findFirst({
          where: { user_id: userId },
          select: { id: true, company_name: true },
        });
        if (company) {
          await this.prisma.tenant
            .update({
              where: { id: existing.id },
              data: {
                companyId: company.id,
                name: company.company_name ?? existing.name,
              },
            })
            .catch(() => null); // Ignore race / unique violations
        }
      }
      return existing.id;
    }

    // Create new tenant. Look up the company first to pre-link if available.
    const company = await this.prisma.companies.findFirst({
      where: { user_id: userId },
      select: { id: true, company_name: true },
    });

    // Race-safe: use upsert keyed by userId so concurrent creates collapse to one row.
    const tenant = await this.prisma.tenant.upsert({
      where: { userId },
      create: {
        userId,
        companyId: company?.id ?? null,
        name: company?.company_name ?? 'My Organization',
      },
      update: {}, // No-op if another request created it first
    });
    return tenant.id;
  }

  private async _issueTokens(user: {
    id: string;
    email: string;
    role: string;
    firstName: string | null;
    lastName: string | null;
  }): Promise<IssuedTokens> {
    const tenantId = await this._resolveOrCreateTenant(user.id);

    // JWT payload stays lean: only id + email + role + tenantId + type.
    // firstName/lastName change frequently, so callers should hit /auth/me
    // to fetch the freshest copy rather than reading them off the token.
    const base = { sub: user.id, email: user.email, role: user.role, tenantId };
    const jwtSecret = this.config.get<string>('JWT_SECRET');
    const accessExpiresIn = this.config.get<string>('JWT_EXPIRES_IN') || '900';
    const refreshExpiresInSec = parseInt(
      this.config.get<string>('JWT_REFRESH_EXPIRES_IN') || '604800',
      10,
    );

    const accessToken = this.jwtService.sign(
      { ...base, type: 'access' },
      { secret: jwtSecret, expiresIn: accessExpiresIn as any },
    );

    const refreshToken = this.jwtService.sign(
      { ...base, type: 'refresh' },
      { secret: jwtSecret, expiresIn: refreshExpiresInSec as any },
    );

    const expiresAt = new Date(Date.now() + refreshExpiresInSec * 1000);
    // Idempotent: if the same token is somehow issued twice (same iat), update
    // the expiry instead of crashing with a unique constraint violation.
    await this.prisma.refreshToken.upsert({
      where: { token: refreshToken },
      create: { token: refreshToken, userId: user.id, expiresAt },
      update: { expiresAt },
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        firstName: user.firstName,
        lastName: user.lastName,
        tenantId,
      },
    };
  }
}

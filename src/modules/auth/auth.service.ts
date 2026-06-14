import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../../mail/mail.service';
import * as bcrypt from 'bcryptjs';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

// Converts "7d" → 604800, "15m" → 900, "1h" → 3600, or plain "604800" → 604800.
function parseExpiresInSec(value: string): number {
  const match = value.match(/^(\d+)([smhd]?)$/);
  if (!match) return 604800;
  const n = parseInt(match[1], 10);
  const unit = match[2];
  if (unit === 'm') return n * 60;
  if (unit === 'h') return n * 3600;
  if (unit === 'd') return n * 86400;
  return n; // plain seconds or no unit
}

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
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private config: ConfigService,
    private mail: MailService,
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

    // Fire-and-forget: a failed email must never block account creation.
    void this.sendVerificationEmail(user);

    return this._issueTokens(user);
  }

  // ── Email verification ──────────────────────────────────────────────────────

  /** Sign a short-lived (24 h) verification token and email the confirm link. */
  private async sendVerificationEmail(user: {
    id: string;
    email: string;
    firstName: string | null;
  }): Promise<void> {
    try {
      const token = this.jwtService.sign(
        { sub: user.id, email: user.email, type: 'email_verify' },
        { secret: this.config.get<string>('JWT_SECRET'), expiresIn: '1d' },
      );
      // Externally-reachable backend base (incl. the /api2 prefix). On this
      // server NestJS is served at api.aikoonic.codes/api2 (no api2.* subdomain).
      const base = this.config.get<string>('PUBLIC_API_URL') ?? 'https://api.aikoonic.codes/api2';
      const verifyUrl = `${base}/auth/verify-email?token=${encodeURIComponent(token)}`;
      await this.mail.sendVerificationEmail(user.email, verifyUrl, user.firstName);
    } catch (e) {
      this.logger.error(`Failed to send verification email to ${user.email}`, e as Error);
    }
  }

  /** Validate a verification token and flag the user's email as verified. */
  async verifyEmail(token: string): Promise<void> {
    if (!token) throw new BadRequestException('Lien de vérification invalide.');
    let payload: { sub?: string; type?: string };
    try {
      payload = this.jwtService.verify(token, { secret: this.config.get<string>('JWT_SECRET') });
    } catch {
      throw new BadRequestException('Lien de vérification invalide ou expiré.');
    }
    if (payload.type !== 'email_verify' || !payload.sub) {
      throw new BadRequestException('Lien de vérification invalide.');
    }
    await this.prisma.user
      .update({ where: { id: payload.sub }, data: { emailVerified: true } })
      .catch(() => {
        throw new BadRequestException('Compte introuvable.');
      });
  }

  /** Re-send the verification email (e.g. user lost the first one). */
  async resendVerification(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');
    if (user.emailVerified) return;
    await this.sendVerificationEmail(user);
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

    // No rotation on refresh — we use a sliding-expiration policy.
    //
    // Rationale: token rotation is the textbook approach but causes false
    // logouts under three common scenarios:
    //   1. Page reload while React StrictMode cancels the in-flight request
    //      via AbortController → cookie is destroyed before client sees the
    //      response, next reload finds an unknown token → 401.
    //   2. Multiple tabs open: any tab that wakes up tries to refresh; the
    //      second tab finds the token already rotated → 401.
    //   3. Two requests in parallel hitting a 401 (e.g. dashboard + sidebar
    //      widgets) → race between both refresh calls.
    //
    // Trade-off: a refresh token can be replayed for the rest of its TTL
    // (~7 days). For an MVP this is acceptable. Tighten by adding a
    // per-token usage counter, IP / UA fingerprint, or device pairing later.
    return this._issueTokensReusingRefresh(user, stored.token);
  }

  /**
   * Re-issue access + refresh tokens but keep the EXISTING refresh token row
   * in DB (just extend its expiry). Avoids the rotation race described in
   * `refresh()`.
   */
  private async _issueTokensReusingRefresh(
    user: { id: string; email: string; role: string; firstName: string | null; lastName: string | null },
    existingRefreshToken: string,
  ): Promise<IssuedTokens> {
    const tenantId = await this._resolveOrCreateTenant(user.id);
    const jwtSecret = this.config.get<string>('JWT_SECRET');
    const accessExpiresIn = this.config.get<string>('JWT_EXPIRES_IN') || '900';
    const refreshExpiresInSec = parseExpiresInSec(
      this.config.get<string>('JWT_REFRESH_EXPIRES_IN') || '604800',
    );

    const accessToken = this.jwtService.sign(
      { sub: user.id, email: user.email, role: user.role, tenantId, type: 'access' },
      { secret: jwtSecret, expiresIn: accessExpiresIn as any },
    );

    // Sliding window: bump the existing refresh token's expiry forward.
    const expiresAt = new Date(Date.now() + refreshExpiresInSec * 1000);
    await this.prisma.refreshToken.update({
      where: { token: existingRefreshToken },
      data: { expiresAt },
    });

    return {
      accessToken,
      refreshToken: existingRefreshToken,
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
    const refreshExpiresInSec = parseExpiresInSec(
      this.config.get<string>('JWT_REFRESH_EXPIRES_IN') || '604800',
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

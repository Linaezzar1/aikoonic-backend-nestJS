import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

const RT_COOKIE = 'aikoonic_rt';
const RT_MAX_AGE_MS = 7 * 24 * 3600 * 1000;

function setRefreshCookie(res: Response, token: string) {
  res.cookie(RT_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: RT_MAX_AGE_MS,
  });
}

function clearRefreshCookie(res: Response) {
  res.clearCookie(RT_COOKIE, { path: '/' });
}

@Controller('auth')
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const data = await this.authService.register(dto);
    setRefreshCookie(res, data.refreshToken);
    return { accessToken: data.accessToken, user: data.user };
  }

  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const data = await this.authService.login(dto);
    setRefreshCookie(res, data.refreshToken);
    return { accessToken: data.accessToken, user: data.user };
  }

  @Post('refresh')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[RT_COOKIE] as string | undefined;
    if (!token) {
      clearRefreshCookie(res);
      throw new UnauthorizedException('No refresh token');
    }
    try {
      const data = await this.authService.refresh(token);
      setRefreshCookie(res, data.refreshToken);
      return { accessToken: data.accessToken, user: data.user };
    } catch (e) {
      // Token rotation already deleted the old token. Cookie is now stale → clear it.
      clearRefreshCookie(res);
      throw e;
    }
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[RT_COOKIE] as string | undefined;
    if (token) await this.authService.logout(token);
    clearRefreshCookie(res);
    return { message: 'Logged out' };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() user: { id: string }) {
    return this.authService.getMe(user.id);
  }

  /** Edit the authenticated user's first/last name. */
  @Patch('me')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async updateProfile(
    @CurrentUser() user: { id: string },
    @Body() dto: UpdateProfileDto,
  ) {
    return this.authService.updateProfile(user.id, dto);
  }

  /**
   * Change the authenticated user's password.
   *
   * Side-effects:
   *   - bcrypt-verifies the current password before accepting the change
   *   - invalidates ALL existing refresh tokens for this user (other devices
   *     get logged out)
   *   - re-issues a fresh refresh cookie for the current device so the user
   *     stays logged in without an extra round-trip
   */
  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async changePassword(
    @CurrentUser() user: { id: string },
    @Body() dto: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.changePassword(user.id, dto);
    const tokens = await this.authService.reissueForUser(user.id);
    setRefreshCookie(res, tokens.refreshToken);
    return { accessToken: tokens.accessToken, user: tokens.user };
  }
}

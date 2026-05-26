import {
  Controller,
  Get,
  Patch,
  Param,
  UseGuards,
  Sse,
  Query,
} from '@nestjs/common';
import { Observable, interval, from } from 'rxjs';
import { switchMap, map } from 'rxjs/operators';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';

interface AuthUser {
  id: string;
  email: string;
  role: string;
}

@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  getAll(@CurrentUser() user: AuthUser) {
    return this.notificationsService.getAll(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('read-all')
  markAllAsRead(@CurrentUser() user: AuthUser) {
    return this.notificationsService.markAllAsRead(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/read')
  markAsRead(@Param('id') id: string) {
    return this.notificationsService.markAsRead(id);
  }

  /**
   * SSE stream — EventSource can't set Authorization headers, so we accept
   * the JWT as a ?token= query param and verify it manually.
   * Sends the current unread list every 5 seconds.
   */
  @Sse('stream')
  stream(@Query('token') token: string): Observable<MessageEvent> {
    let userId: string;
    try {
      const payload = this.jwtService.verify<{ sub: string }>(token, {
        secret: this.config.get<string>('JWT_SECRET'),
      });
      userId = payload.sub;
    } catch {
      return new Observable((subscriber) => {
        subscriber.error(new Error('Unauthorized'));
      });
    }

    return interval(5000).pipe(
      switchMap(() => from(this.notificationsService.getUnread(userId))),
      map((notifications) => ({ data: JSON.stringify(notifications) } as MessageEvent)),
    );
  }
}

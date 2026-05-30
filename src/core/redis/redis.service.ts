import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: Redis;
  private readonly logger = new Logger(RedisService.name);

  constructor(private config: ConfigService) {}

  onModuleInit() {
    const url = this.config.get<string>('REDIS_URL') ?? 'redis://localhost:6379/0';
    this.client = new Redis(url, { lazyConnect: false });
    this.client.on('error', (err) => this.logger.error('Redis error', err));
  }

  async onModuleDestroy() {
    await this.client.quit();
  }

  /** Write quota features for a company. NestJS calls this on every plan change. */
  async setQuota(companyId: string, features: Record<string, any>): Promise<void> {
    await this.client.set(`quota:${companyId}`, JSON.stringify(features), 'EX', 3600);
  }

  /** Remove quota cache (e.g. subscription cancelled). FastAPI will fall back to DB. */
  async deleteQuota(companyId: string): Promise<void> {
    await this.client.del(`quota:${companyId}`);
  }

  /** Flag a user as banned — FastAPI reads this before every AI operation. */
  async setBanned(userId: string): Promise<void> {
    await this.client.set(`banned:${userId}`, '1');
  }

  /** Remove ban flag when user is re-activated. */
  async deleteBanned(userId: string): Promise<void> {
    await this.client.del(`banned:${userId}`);
  }
}

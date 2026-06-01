import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(configService: ConfigService) {
    const connectionString = configService.get<string>('DATABASE_URL') || process.env.DATABASE_URL;
    const pool = new Pool({ connectionString });
    // CRM tables live in the "crm" schema; auth/notification tables live in "public".
    // Setting search_path so Prisma can find both without @@schema annotations.
    pool.on('connect', (client: PoolClient) => {
      client.query('SET search_path TO crm, "$user", public');
    });
    const adapter = new PrismaPg(pool);
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

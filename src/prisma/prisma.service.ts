import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { Pool, types } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

// pg auto-parses JSON (114) and JSONB (3802) into JavaScript objects before
// Prisma's query engine sees the result. Prisma then calls JSON.parse() on an
// already-parsed value, which fails. Returning the raw string lets Prisma
// handle deserialization itself.
types.setTypeParser(114, (val: string) => val);
types.setTypeParser(3802, (val: string) => val);

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(configService: ConfigService) {
    const connectionString = configService.get<string>('DATABASE_URL') || process.env.DATABASE_URL;
    const pool = new Pool({ connectionString });
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

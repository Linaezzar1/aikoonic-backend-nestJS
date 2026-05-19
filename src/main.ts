import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';

/**
 * CORS allowed origins.
 *
 * Reads `FRONTEND_ORIGINS` env var (comma-separated, no trailing slash).
 * Falls back to a default list covering local dev + production domains.
 * The wildcard regex matches any *.aikoonic.codes subdomain for preview deploys.
 */
function buildCorsOrigin(): (string | RegExp)[] {
  const envOrigins = (process.env.FRONTEND_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const defaults = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:3001',
    'https://aikoonic.codes',
    'https://www.aikoonic.codes',
  ];
  const list = envOrigins.length > 0 ? envOrigins : defaults;
  return [...list, /^https:\/\/[a-z0-9-]+\.aikoonic\.codes$/];
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(cookieParser());

  app.setGlobalPrefix('api2');
  app.enableCors({
    origin: buildCorsOrigin(),
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();

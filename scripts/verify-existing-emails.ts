/**
 * One-time backfill — mark every EXISTING account's email as verified.
 *
 * Run this ONCE right after deploying the email-verification feature, so users
 * who signed up before it existed are not treated as unverified.
 *
 * New accounts created afterwards keep `email_verified = false` (the schema
 * default) and must confirm via the email link.
 *
 * Usage (from aikoonic-backend-nestJS/):
 *   npx ts-node scripts/verify-existing-emails.ts
 *   # or: npm run verify:emails
 *
 * Pure-SQL equivalent (if you prefer psql):
 *   UPDATE users SET email_verified = true WHERE email_verified = false;
 */
import { PrismaClient } from '@prisma/client';

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const pending = await prisma.user.count({ where: { emailVerified: false } });
    if (pending === 0) {
      console.log('✅ Aucun compte non vérifié — rien à faire.');
      return;
    }
    const result = await prisma.user.updateMany({
      where: { emailVerified: false },
      data: { emailVerified: true },
    });
    console.log(`✅ ${result.count} compte(s) existant(s) marqué(s) comme vérifiés.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('❌ Échec du backfill de vérification email:', err);
  process.exit(1);
});

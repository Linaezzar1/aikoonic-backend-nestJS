/**
 * Seed an ADMIN user.
 *
 * Usage (inside the running container):
 *   docker compose exec nestjs_backend node scripts/seed-admin.js <email> <password>
 *
 * Or via env vars:
 *   docker compose exec -e ADMIN_EMAIL=a@b.c -e ADMIN_PASSWORD=secret nestjs_backend node scripts/seed-admin.js
 *
 * Idempotent: if the user already exists it is promoted to ADMIN (and the
 * password is updated if one was provided).
 */
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

async function main() {
  const email = (process.argv[2] || process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.argv[3] || process.env.ADMIN_PASSWORD || '';

  if (!email || !password) {
    console.error('Usage: node scripts/seed-admin.js <email> <password>');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const hashed = await bcrypt.hash(password, 12);
    const existing = await prisma.user.findUnique({ where: { email } });

    if (existing) {
      await prisma.user.update({
        where: { email },
        data: { role: 'ADMIN', password: hashed, isActive: true, emailVerified: true },
      });
      console.log(`✅ Existing user ${email} promoted to ADMIN (password updated).`);
    } else {
      await prisma.user.create({
        data: {
          email,
          password: hashed,
          role: 'ADMIN',
          isActive: true,
          emailVerified: true,
          firstName: 'Admin',
          lastName: null,
        },
      });
      console.log(`✅ ADMIN user ${email} created.`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('❌ Seed failed:', e.message);
  process.exit(1);
});

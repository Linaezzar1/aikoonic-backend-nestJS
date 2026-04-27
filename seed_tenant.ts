import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { id: "tenant-001" },
    update: {},
    create: { id: "tenant-001", name: "Default Tenant" }
  })
  console.log("Tenant ready", tenant)
}
main().catch(e => console.error(e)).finally(() => prisma.$disconnect())

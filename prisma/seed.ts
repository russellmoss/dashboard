import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('Savvy1234!', 10);

  // Create admin user
  await prisma.user.upsert({
    where: { email: 'russell.moss@savvywealth.com' },
    update: {},
    create: {
      email: 'russell.moss@savvywealth.com',
      name: 'Russell Moss',
      passwordHash,
      role: 'admin',
    },
  });

  console.log('Seed completed: Admin user created');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

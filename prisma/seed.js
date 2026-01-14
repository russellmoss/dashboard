// Simple JavaScript seed script to avoid TypeScript/Prisma 7 issues
// IMPORTANT: Load environment variables BEFORE importing PrismaClient
// Prisma 7 reads DATABASE_URL at module load time
require('dotenv').config();

// Ensure DATABASE_URL is set (Prisma 7 requires it)
const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required. Please set DATABASE_URL, POSTGRES_URL, or POSTGRES_PRISMA_URL in your .env file.');
}
process.env.DATABASE_URL = databaseUrl;

// Now import PrismaClient (it will read DATABASE_URL from process.env)
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

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

  // Create test users for SGA Hub
  // Eleni Stefanopoulos - SGA
  await prisma.user.upsert({
    where: { email: 'eleni@savvywealth.com' },
    update: {},
    create: {
      email: 'eleni@savvywealth.com',
      name: 'Eleni Stefanopoulos',
      passwordHash,
      role: 'sga',
    },
  });

  // Perry Kalmeta - SGA
  await prisma.user.upsert({
    where: { email: 'perry.kalmeta@savvywealth.com' },
    update: {},
    create: {
      email: 'perry.kalmeta@savvywealth.com',
      name: 'Perry Kalmeta',
      passwordHash,
      role: 'sga',
    },
  });

  // Russell Armitage - Admin
  await prisma.user.upsert({
    where: { email: 'russell.armitage@savvywealth.com' },
    update: {},
    create: {
      email: 'russell.armitage@savvywealth.com',
      name: 'Russell Armitage',
      passwordHash,
      role: 'admin',
    },
  });

  // David - Manager
  await prisma.user.upsert({
    where: { email: 'david@savvywealth.com' },
    update: {},
    create: {
      email: 'david@savvywealth.com',
      name: 'David',
      passwordHash,
      role: 'manager',
    },
  });

  console.log('Seed completed: Admin user and test users created');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

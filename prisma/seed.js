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
  const adminPasswordHash = await bcrypt.hash('Savvy1234!', 10);
  const sgaPasswordHash = await bcrypt.hash('SavvyNY10001!', 10);

  // Create admin user
  await prisma.user.upsert({
    where: { email: 'russell.moss@savvywealth.com' },
    update: {},
    create: {
      email: 'russell.moss@savvywealth.com',
      name: 'Russell Moss',
      passwordHash: adminPasswordHash,
      role: 'admin',
      isActive: true,
    },
  });

  // Russell Armitage - Admin (already exists, keep as is)
  await prisma.user.upsert({
    where: { email: 'russell.armitage@savvywealth.com' },
    update: {},
    create: {
      email: 'russell.armitage@savvywealth.com',
      name: 'Russell Armitage',
      passwordHash: adminPasswordHash,
      role: 'admin',
      isActive: true,
    },
  });

  // David - Manager
  await prisma.user.upsert({
    where: { email: 'david@savvywealth.com' },
    update: {},
    create: {
      email: 'david@savvywealth.com',
      name: 'David',
      passwordHash: adminPasswordHash,
      role: 'manager',
      isActive: true,
    },
  });

  // SGA Users - All use password "SavvyNY10001!"
  // Eleni Stefanopoulos - SGA (already exists, update password)
  await prisma.user.upsert({
    where: { email: 'eleni@savvywealth.com' },
    update: {
      passwordHash: sgaPasswordHash,
      isActive: true,
    },
    create: {
      email: 'eleni@savvywealth.com',
      name: 'Eleni Stefanopoulos',
      passwordHash: sgaPasswordHash,
      role: 'sga',
      isActive: true,
    },
  });

  // Perry Kalmeta - SGA (already exists, update password)
  await prisma.user.upsert({
    where: { email: 'perry.kalmeta@savvywealth.com' },
    update: {
      passwordHash: sgaPasswordHash,
      isActive: true,
    },
    create: {
      email: 'perry.kalmeta@savvywealth.com',
      name: 'Perry Kalmeta',
      passwordHash: sgaPasswordHash,
      role: 'sga',
      isActive: true,
    },
  });

  // New SGA Users
  const sgaUsers = [
    { email: 'lauren.george@savvywealth.com', name: 'Lauren George' },
    { email: 'craig.suchodolski@savvywealth.com', name: 'Craig Suchodolski' },
    { email: 'jacqueline@savvywealth.com', name: 'Jacqueline Tully' },
    { email: 'ryan.crandall@savvywealth.com', name: 'Ryan Crandall' },
    { email: 'marisa.saucedo@savvywealth.com', name: 'Marisa Saucedo' },
    { email: 'chris.morgan@savvywealth.com', name: 'Chris Morgan' },
    { email: 'helen.kamens@savvywealth.com', name: 'Helen Kamens' },
    { email: 'amy.waller@savvywealth.com', name: 'Amy Waller' },
    { email: 'channing.guyer@savvywealth.com', name: 'Channing Guyer' },
    { email: 'brian.ohara@savvywealth.com', name: "Brian O'Hara" },
    { email: 'holly.huffman@savvywealth.com', name: 'Holly Huffman' },
    { email: 'jason.ainsworth@savvywealth.com', name: 'Jason Ainsworth' },
  ];

  for (const user of sgaUsers) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: {
        passwordHash: sgaPasswordHash,
        isActive: true,
      },
      create: {
        email: user.email,
        name: user.name,
        passwordHash: sgaPasswordHash,
        role: 'sga',
        isActive: true,
      },
    });
  }

  console.log('Seed completed: Admin users, manager, and SGA users created');
  console.log(`Total SGA users: ${sgaUsers.length + 2} (including Eleni and Perry)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

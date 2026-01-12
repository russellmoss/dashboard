// Direct SQL seed script using @vercel/postgres to bypass Prisma 7 issues
const { sql } = require('@vercel/postgres');
const bcrypt = require('bcryptjs');
require('dotenv').config();

async function main() {
  const passwordHash = await bcrypt.hash('Savvy1234!', 10);

  // Check if user already exists
  const existingUser = await sql`
    SELECT id FROM "User" WHERE email = 'russell.moss@savvywealth.com'
  `;

  if (existingUser.rows.length > 0) {
    console.log('Admin user already exists');
    return;
  }

  // Insert admin user
  await sql`
    INSERT INTO "User" (id, email, name, "passwordHash", role, "createdAt", "updatedAt")
    VALUES (
      gen_random_uuid()::text,
      'russell.moss@savvywealth.com',
      'Russell Moss',
      ${passwordHash},
      'admin',
      NOW(),
      NOW()
    )
  `;

  console.log('Seed completed: Admin user created');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

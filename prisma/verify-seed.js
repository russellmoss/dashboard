// Verify the seed was successful
const { sql } = require('@vercel/postgres');
require('dotenv').config();

async function main() {
  const result = await sql`
    SELECT email, name, role FROM "User" WHERE email = 'russell.moss@savvywealth.com'
  `;
  
  if (result.rows.length > 0) {
    console.log('✓ Admin user found:', result.rows[0]);
  } else {
    console.log('✗ Admin user not found');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

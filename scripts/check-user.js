// Check user and verify password hash
const { sql } = require('@vercel/postgres');
const bcrypt = require('bcryptjs');
require('dotenv').config();

async function main() {
  const email = 'russell.moss@savvywealth.com';
  const password = 'Savvy1234!';
  
  console.log('Checking user in database...');
  const result = await sql`
    SELECT id, email, name, role, "passwordHash" FROM "User" WHERE email = ${email.toLowerCase()}
  `;
  
  if (result.rows.length === 0) {
    console.log('❌ User not found in database');
    return;
  }
  
  const user = result.rows[0];
  console.log('✓ User found:', {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    passwordHashLength: user.passwordHash?.length || 0,
    passwordHashPrefix: user.passwordHash?.substring(0, 10) || 'N/A'
  });
  
  console.log('\nTesting password comparison...');
  const isValid = await bcrypt.compare(password, user.passwordHash);
  console.log('Password match:', isValid ? '✓ YES' : '✗ NO');
  
  // Also test with a fresh hash to see if the format is correct
  console.log('\nGenerating fresh hash for comparison...');
  const freshHash = await bcrypt.hash(password, 10);
  const freshMatch = await bcrypt.compare(password, freshHash);
  console.log('Fresh hash test:', freshMatch ? '✓ Works' : '✗ Failed');
  console.log('Fresh hash prefix:', freshHash.substring(0, 10));
  console.log('Stored hash prefix:', user.passwordHash.substring(0, 10));
}

main()
  .catch((e) => {
    console.error('Error:', e);
    process.exit(1);
  });

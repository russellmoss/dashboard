import * as dotenv from 'dotenv';
dotenv.config();

import prisma from '../../src/lib/prisma';

async function clearMappings() {
  const deleted = await prisma.gcAdvisorMapping.deleteMany({});
  console.log('Deleted', deleted.count, 'rows from GcAdvisorMapping');
  await prisma.$disconnect();
}

clearMappings().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

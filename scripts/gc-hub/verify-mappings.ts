import * as dotenv from 'dotenv';
dotenv.config();

import prisma from '../../src/lib/prisma';

async function verifyMappings() {
  // Add Cindy Alvarez & Janelle Van Meel joint account if not already mapped
  const jointAccount = 'Cindy Alvarez & Janelle Van Meel';
  const existingJoint = await prisma.gcAdvisorMapping.findUnique({
    where: { advisorNormalizedName: jointAccount }
  });
  if (!existingJoint) {
    await prisma.gcAdvisorMapping.create({
      data: {
        advisorNormalizedName: jointAccount,
        accountName: jointAccount,
        anonymousAdvisorId: 'Account 001',
        anonymousAccountName: 'Joint Account A',
        isExcluded: false,
      }
    });
    console.log('Added mapping for joint account: Cindy Alvarez & Janelle Van Meel\n');
  }

  // Check billing data for previously-missing advisors
  console.log('=== Billing Data Verification ===\n');
  const checkAdvisors = ['Jacob LaRue', 'Kenneth Bobadilla', 'Frank Remund', 'Michael Most'];
  for (const name of checkAdvisors) {
    const mapping = await prisma.gcAdvisorMapping.findUnique({
      where: { advisorNormalizedName: name },
      select: {
        advisorNormalizedName: true,
        orionRepresentativeId: true,
        billingFrequency: true,
        billingStyle: true,
        billingType: true,
        glTreatment: true
      }
    });
    if (mapping) {
      console.log(`${name}:`);
      console.log(`  Orion ID: ${mapping.orionRepresentativeId || '(none)'}`);
      console.log(`  Frequency: ${mapping.billingFrequency || 'NULL'}`);
      console.log(`  Style: ${mapping.billingStyle || 'NULL'}`);
      console.log(`  Type: ${mapping.billingType || 'NULL'}`);
      console.log(`  GL: ${mapping.glTreatment || 'NULL'}\n`);
    } else {
      console.log(`${name}: NOT FOUND\n`);
    }
  }

  // Check if Dan Brady or Daniel Brady exist in period data
  const danBradyVariants = await prisma.gcAdvisorPeriodData.findMany({
    where: {
      advisorNormalizedName: { contains: 'Brady' }
    },
    select: { advisorNormalizedName: true },
    take: 5
  });
  console.log('Brady variants in period data:', danBradyVariants.map(x => x.advisorNormalizedName));

  // Check if Dan Brady mapping exists
  const danBradyMapping = await prisma.gcAdvisorMapping.findFirst({
    where: {
      advisorNormalizedName: { contains: 'Brady' }
    },
    select: { advisorNormalizedName: true, orionRepresentativeId: true }
  });
  console.log('Brady in mapping:', danBradyMapping);

  const toCheck = ['Frank Remund', 'Dan Brady', 'Daniel Brady', 'Michael Most', 'Erich Yost', 'Maya Joelson'];

  console.log('\nChecking previously-missing advisors:\n');

  for (const name of toCheck) {
    const mapping = await prisma.gcAdvisorMapping.findUnique({
      where: { advisorNormalizedName: name },
      select: {
        advisorNormalizedName: true,
        orionRepresentativeId: true,
        anonymousAdvisorId: true
      }
    });

    if (mapping) {
      console.log(`✅ ${name}: Orion ID ${mapping.orionRepresentativeId || '(none)'}, ${mapping.anonymousAdvisorId}`);
    } else {
      console.log(`❌ ${name}: NOT FOUND`);
    }
  }

  // Check total counts
  const totalMappings = await prisma.gcAdvisorMapping.count();

  // Get unique advisors from period data using raw query
  const uniqueAdvisors: { advisorNormalizedName: string }[] = await prisma.$queryRaw`
    SELECT DISTINCT "advisorNormalizedName" FROM "GcAdvisorPeriodData"
  `;

  console.log(`\nTotal mappings: ${totalMappings}`);
  console.log(`Unique advisors in period data: ${uniqueAdvisors.length}`);

  // Check coverage
  const unmapped = [];
  for (const pd of uniqueAdvisors) {
    const mapping = await prisma.gcAdvisorMapping.findUnique({
      where: { advisorNormalizedName: pd.advisorNormalizedName }
    });
    if (!mapping) {
      unmapped.push(pd.advisorNormalizedName);
    }
  }

  console.log(`Unmapped advisors (${unmapped.length}):`, unmapped.length ? unmapped : 'None!');

  // Billing coverage
  const allMappings = await prisma.gcAdvisorMapping.findMany({
    where: { isExcluded: false },
    select: { advisorNormalizedName: true, billingFrequency: true, orionRepresentativeId: true }
  });
  const withBilling = allMappings.filter(m => m.billingFrequency);
  const withoutBilling = allMappings.filter(m => !m.billingFrequency);

  console.log(`\n=== Billing Data Coverage ===`);
  console.log(`With billing frequency: ${withBilling.length}/${allMappings.length} (${Math.round(withBilling.length/allMappings.length*100)}%)`);
  if (withoutBilling.length > 0 && withoutBilling.length <= 15) {
    console.log(`Missing billing (${withoutBilling.length}):`);
    withoutBilling.forEach(a => console.log(`  - ${a.advisorNormalizedName} (Orion: ${a.orionRepresentativeId || 'none'})`));
  } else if (withoutBilling.length > 15) {
    console.log(`Missing billing: ${withoutBilling.length} advisors`);
  }

  await prisma.$disconnect();
}

verifyMappings().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

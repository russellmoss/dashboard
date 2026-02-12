// scripts/gc-hub/seed-advisor-mappings.ts
import * as dotenv from 'dotenv';
dotenv.config();

import prisma from '../../src/lib/prisma';
import { getValues } from '../../src/lib/sheets/gc-sheets-reader';
import { normalizeAdvisorName, shouldExcludeEntry } from '../../src/lib/gc-hub/data-utils';

const REVENUE_ESTIMATES_ID = process.env.GC_REVENUE_ESTIMATES_SHEET_ID!;

interface AdvisorRecord {
  canonicalName: string;
  orionId: string | null;
  accountName: string | null;
  billingFrequency: string | null;
  billingStyle: string | null;
  billingType: string | null;
  glTreatment: string | null;
  isExcluded: boolean;
  exclusionReason: string | null;
}

async function seedAdvisorMappings() {
  console.log('=== GC Hub: Seed Advisor Mappings ===\n');

  // 1. Read mapping tab
  console.log('Reading advisor<>orion rep id tab...');
  const mappingRows = await getValues(REVENUE_ESTIMATES_ID, 'advisor<>orion rep id!A1:E150');
  if (!mappingRows) throw new Error('No data from mapping tab');

  // 2. Read billing type tab
  console.log('Reading billing type tab...');
  const billingRows = await getValues(REVENUE_ESTIMATES_ID, 'Jan - Billing Type as of 260203!A1:H200');
  if (!billingRows) throw new Error('No data from billing type tab');

  // 3. Build billing lookup by Orion ID and name
  const billingByOrionId = new Map<string, {
    billingFrequency: string;
    billingStyle: string;
    billingType: string;
    glTreatment: string;
  }>();
  const billingByName = new Map<string, typeof billingByOrionId extends Map<any, infer V> ? V : never>();

  // Skip header row(s) — find header by looking for "Orion ID" or "Full Name"
  for (let i = 0; i < billingRows.length; i++) {
    const row = billingRows[i];
    if (!row || !row[0] || String(row[0]).toLowerCase().includes('orion')) continue; // skip header

    const orionId = String(row[0]).trim();
    const fullName = String(row[1] || '').trim();
    const billStyle = String(row[4] || '').trim().toLowerCase(); // Col E
    const billFreq = String(row[5] || '').trim().toLowerCase();  // Col F
    const billType = String(row[6] || '').trim();                 // Col G
    const glTreat = String(row[7] || '').trim();                  // Col H

    if (!orionId || orionId === '#N/A') continue;

    const entry = {
      billingFrequency: billFreq || null,
      billingStyle: billStyle || null,
      billingType: billType || null,
      glTreatment: glTreat || null,
    };

    billingByOrionId.set(orionId, entry as any);
    if (fullName) {
      billingByName.set(normalizeAdvisorName(fullName).toLowerCase(), entry as any);
    }
  }

  // 4. Build advisor records from mapping tab
  const advisors = new Map<string, AdvisorRecord>();

  for (let i = 1; i < mappingRows.length; i++) { // Skip header
    const row = mappingRows[i];
    if (!row || !row[1]) continue; // Skip empty rows

    const rawName = String(row[1]).trim();
    if (!rawName) continue;

    const canonicalName = normalizeAdvisorName(rawName);
    const orionId = row[2] ? String(row[2]).trim() : null;
    const accountName = row[0] ? String(row[0]).trim() : null;

    const isExcluded = shouldExcludeEntry(rawName);
    const exclusionReason = isExcluded ? 'Churned or excluded advisor' : null;

    // Look up billing info
    const billing =
      (orionId ? billingByOrionId.get(orionId) : null) ||
      billingByName.get(canonicalName.toLowerCase()) ||
      null;

    // Only add if not already present (first occurrence wins)
    if (!advisors.has(canonicalName)) {
      advisors.set(canonicalName, {
        canonicalName,
        orionId,
        accountName,
        billingFrequency: billing?.billingFrequency || null,
        billingStyle: billing?.billingStyle || null,
        billingType: billing?.billingType || null,
        glTreatment: billing?.glTreatment || null,
        isExcluded,
        exclusionReason,
      });
    }
  }

  // 5. Assign deterministic anonymous IDs (sorted alphabetically)
  const sortedAdvisors = [...advisors.values()]
    .filter(a => !a.isExcluded)
    .sort((a, b) => a.canonicalName.localeCompare(b.canonicalName));

  const anonymousIds = new Map<string, string>();
  sortedAdvisors.forEach((advisor, index) => {
    anonymousIds.set(advisor.canonicalName, `Advisor ${String(index + 1).padStart(3, '0')}`);
  });

  // Assign anonymous account names (sorted unique accounts)
  const uniqueAccounts = [...new Set(
    sortedAdvisors.map(a => a.accountName).filter(Boolean)
  )].sort() as string[];
  const anonymousAccounts = new Map<string, string>();
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  uniqueAccounts.forEach((account, index) => {
    const letter = index < 26 ? letters[index] : `${letters[Math.floor(index / 26) - 1]}${letters[index % 26]}`;
    anonymousAccounts.set(account, `Team ${letter}`);
  });

  // 6. Upsert into database
  console.log(`\nUpserting ${advisors.size} advisors into GcAdvisorMapping...`);
  let inserted = 0;
  let updated = 0;
  let excluded = 0;

  for (const advisor of advisors.values()) {
    if (advisor.isExcluded) {
      excluded++;
      // Still insert excluded advisors (with isExcluded flag) for reference
    }

    const anonId = anonymousIds.get(advisor.canonicalName) || `Excluded_${String(excluded).padStart(3, '0')}`;
    const anonAccount = advisor.accountName
      ? anonymousAccounts.get(advisor.accountName) || null
      : null;

    try {
      const existing = await prisma.gcAdvisorMapping.findUnique({
        where: { advisorNormalizedName: advisor.canonicalName },
      });

      if (existing) {
        await prisma.gcAdvisorMapping.update({
          where: { advisorNormalizedName: advisor.canonicalName },
          data: {
            orionRepresentativeId: advisor.orionId,
            accountName: advisor.accountName,
            anonymousAdvisorId: anonId,
            anonymousAccountName: anonAccount,
            billingFrequency: advisor.billingFrequency,
            billingStyle: advisor.billingStyle,
            billingType: advisor.billingType,
            glTreatment: advisor.glTreatment,
            isExcluded: advisor.isExcluded,
            exclusionReason: advisor.exclusionReason,
          },
        });
        updated++;
      } else {
        await prisma.gcAdvisorMapping.create({
          data: {
            advisorNormalizedName: advisor.canonicalName,
            orionRepresentativeId: advisor.orionId,
            accountName: advisor.accountName,
            anonymousAdvisorId: anonId,
            anonymousAccountName: anonAccount,
            billingFrequency: advisor.billingFrequency,
            billingStyle: advisor.billingStyle,
            billingType: advisor.billingType,
            glTreatment: advisor.glTreatment,
            isExcluded: advisor.isExcluded,
            exclusionReason: advisor.exclusionReason,
          },
        });
        inserted++;
      }
    } catch (err: any) {
      console.error(`Error upserting ${advisor.canonicalName}:`, err.message);
    }
  }

  console.log(`\n✅ Advisor Mapping Seed Complete`);
  console.log(`   Inserted: ${inserted}`);
  console.log(`   Updated: ${updated}`);
  console.log(`   Excluded: ${excluded}`);
  console.log(`   Total in mapping: ${advisors.size}`);

  await prisma.$disconnect();
}

seedAdvisorMappings().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

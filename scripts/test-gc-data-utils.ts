// scripts/test-gc-data-utils.ts
import {
  normalizeAdvisorName, parseCurrency, shouldExcludeEntry,
  periodToStartDate, getSubEntryParent, isBaroneTeamMember,
} from '../src/lib/gc-hub/data-utils';

let passed = 0;
let failed = 0;

function test(name: string, condition: boolean) {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}`);
    failed++;
  }
}

console.log('\n=== Name Normalization Tests ===');
test('Drew → Andrew Martino', normalizeAdvisorName('Drew Martino') === 'Andrew Martino');
test('Strip payout suffix', normalizeAdvisorName('Aaron Peloquin Payout Q3 2025') === 'Aaron Peloquin');
test('Strip Horizon prefix', normalizeAdvisorName('Horizon - Berkely Arrants') === 'Berkely Arrants');
test('Nick → Jon McLaughlin', normalizeAdvisorName('Nick McLaughlin') === 'Jon McLaughlin');
test('P6 → Perspective 6', normalizeAdvisorName('P6') === 'Perspective 6');
test('Strip 1099 suffix', normalizeAdvisorName('Josh Barone 1099') === 'Joshua Barone');
test('Dan Perrino → Daniel Perrino', normalizeAdvisorName('Dan Perrino') === 'Daniel Perrino');
test('Ken Boba → Kenneth Bobadilla', normalizeAdvisorName('Ken Boba') === 'Kenneth Bobadilla');
test('Bob Barone → Robert Barone', normalizeAdvisorName('Bob Barone') === 'Robert Barone');

console.log('\n=== Currency Parsing Tests ===');
test('Parenthesized negative', parseCurrency('($25,000.02)') === -25000.02);
test('#REF! → null', parseCurrency('#REF!') === null);
test('Number passthrough', parseCurrency(15449.43) === 15449.43);
test('Against draw → null', parseCurrency('against draw') === null);
test('n/a → null', parseCurrency('n/a') === null);
test('Standard currency $1,234.56', parseCurrency('$1,234.56') === 1234.56);
test('Empty → null', parseCurrency('') === null);
test('Zero passthrough', parseCurrency(0) === 0);
test('Negative number', parseCurrency(-500.25) === -500.25);
test('#N/A → null', parseCurrency('#N/A') === null);
test('#VALUE! → null', parseCurrency('#VALUE!') === null);

console.log('\n=== Exclusion Tests ===');
test('Churned advisor Nathan Wallace', shouldExcludeEntry('Nathan Wallace') === true);
test('Churned advisor Nate Wallace', shouldExcludeEntry('Nate Wallace') === true);
test('Churned advisor Kevin May', shouldExcludeEntry('Kevin May') === true);
test('Excluded entry NW Savvy Generated', shouldExcludeEntry('NW Savvy Generated') === true);
test('Excluded entry EK Existing Clients', shouldExcludeEntry('EK Existing Clients') === true);
test('Active advisor Eric Kirste', shouldExcludeEntry('Eric Kirste') === false);
test('Active advisor Andrew Martino', shouldExcludeEntry('Andrew Martino') === false);

console.log('\n=== Sub-Entry Roll-up Tests ===');
test('Frank Malpigli → Michael Most', getSubEntryParent('Frank Malpigli') === 'Michael Most');
test('Eric Kirste not a sub-entry', getSubEntryParent('Eric Kirste') === null);

console.log('\n=== Barone Team Tests ===');
test('Josh Barone is Barone member', isBaroneTeamMember('Josh Barone') === true);
test('Joshua Barone is Barone member', isBaroneTeamMember('Joshua Barone') === true);
test('Bob Barone is Barone member', isBaroneTeamMember('Bob Barone') === true);
test('Andrea Nolan is Barone member', isBaroneTeamMember('Andrea Nolan') === true);
test('Eugene Hoover is Barone member', isBaroneTeamMember('Eugene Hoover') === true);
test('Michael Lambrecht is Barone member', isBaroneTeamMember('Michael Lambrecht') === true);
test('Eric Kirste is NOT Barone', isBaroneTeamMember('Eric Kirste') === false);

console.log('\n=== Period Utility Tests ===');
const q4_2022 = periodToStartDate('Q4 2022');
test('Q4 2022 → Oct 2022', q4_2022.getFullYear() === 2022 && q4_2022.getMonth() === 9 && q4_2022.getDate() === 1);

const q1_2023 = periodToStartDate('Q1 2023');
test('Q1 2023 → Jan 2023', q1_2023.getFullYear() === 2023 && q1_2023.getMonth() === 0 && q1_2023.getDate() === 1);

const jan_2026 = periodToStartDate('Jan 2026');
test('Jan 2026 → 2026-01-01', jan_2026.getFullYear() === 2026 && jan_2026.getMonth() === 0 && jan_2026.getDate() === 1);

const feb_2026 = periodToStartDate('Feb 2026');
test('Feb 2026 → 2026-02-01', feb_2026.getFullYear() === 2026 && feb_2026.getMonth() === 1 && feb_2026.getDate() === 1);

console.log('\n========================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('========================================\n');

if (failed > 0) {
  process.exit(1);
}

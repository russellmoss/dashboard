import { ROLE_PERMISSIONS } from '../src/lib/permissions';

console.log('\n=== GC Hub Permission Verification ===\n');

const cp = ROLE_PERMISSIONS['capital_partner'];
console.log(`capital_partner role defined: ${cp ? '✅' : '❌'}`);
console.log(`  allowedPages: [${cp?.allowedPages}]`);
console.log(`  canExport: ${cp?.canExport}`);
console.log(`  canManageUsers: ${cp?.canManageUsers}`);

const admin = ROLE_PERMISSIONS['admin'];
console.log(`\nadmin has page 16: ${admin?.allowedPages.includes(16) ? '✅' : '❌'}`);

const revops = ROLE_PERMISSIONS['revops_admin'];
console.log(`revops_admin has page 16: ${revops?.allowedPages.includes(16) ? '✅' : '❌'}`);

const recruiter = ROLE_PERMISSIONS['recruiter'];
console.log(`recruiter does NOT have page 16: ${!recruiter?.allowedPages.includes(16) ? '✅' : '❌'}`);

const viewer = ROLE_PERMISSIONS['viewer'];
console.log(`viewer does NOT have page 16: ${!viewer?.allowedPages.includes(16) ? '✅' : '❌'}`);

console.log('\n');

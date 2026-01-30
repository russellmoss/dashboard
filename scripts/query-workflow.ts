import 'dotenv/config';

const WRIKE_TOKEN = process.env.WRIKE_ACCESS_TOKEN;

async function main() {
  // Try to get the specific workflow
  console.log('=== QUERYING WORKFLOW IEAGT6KAK4GPYD3U ===\n');
  const res = await fetch('https://www.wrike.com/api/v4/workflows/IEAGT6KAK4GPYD3U', {
    headers: { 'Authorization': `Bearer ${WRIKE_TOKEN}` }
  });
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));

  // Also list all workflows with full details
  console.log('\n\n=== ALL WORKFLOWS WITH DETAILS ===\n');
  const allRes = await fetch('https://www.wrike.com/api/v4/workflows', {
    headers: { 'Authorization': `Bearer ${WRIKE_TOKEN}` }
  });
  const allData = await allRes.json() as any;

  for (const wf of allData.data || []) {
    console.log(`\nWorkflow: "${wf.name}" (ID: ${wf.id})`);
    console.log(`Hidden: ${wf.hidden}, Standard: ${wf.standard}`);
    console.log('Statuses:');
    for (const s of wf.customStatuses || []) {
      console.log(`  [${s.group}] "${s.name}" - ID: ${s.id}`);
    }
  }
}

main().catch(console.error);

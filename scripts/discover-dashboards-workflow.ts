import 'dotenv/config';

const WRIKE_TOKEN = process.env.WRIKE_ACCESS_TOKEN;
const FOLDER_ID = 'MQAAAAEEBpOb'; // Dashboards folder

interface WrikeStatus {
  id: string;
  name: string;
  group: string;
  color: string;
}

interface WrikeWorkflow {
  id: string;
  name: string;
  customStatuses: WrikeStatus[];
}

async function discover() {
  // Get all workflows to find which one has Backlog, Planned/Prioritized, In Progress, Done
  console.log('=== SEARCHING FOR WORKFLOW WITH BACKLOG ===\n');
  const workflowRes = await fetch('https://www.wrike.com/api/v4/workflows', {
    headers: { 'Authorization': `Bearer ${WRIKE_TOKEN}` }
  });
  const workflowData = await workflowRes.json() as { data: WrikeWorkflow[] };

  for (const wf of workflowData.data || []) {
    const hasBacklog = wf.customStatuses?.some((s) =>
      s.name.toLowerCase().includes('backlog')
    );
    const hasPlanned = wf.customStatuses?.some((s) =>
      s.name.toLowerCase().includes('planned') || s.name.toLowerCase().includes('prioritized')
    );

    if (hasBacklog || hasPlanned) {
      console.log('*** FOUND MATCHING WORKFLOW ***');
      console.log(`Workflow: "${wf.name}"`);
      console.log(`ID: ${wf.id}`);
      console.log('\nStatuses:');
      for (const s of wf.customStatuses) {
        console.log(`  - "${s.name}" (ID: ${s.id}, group: ${s.group})`);
      }
      console.log('\n');
    }
  }

  // Also show all workflows for reference
  console.log('=== ALL WORKFLOWS ===\n');
  for (const wf of workflowData.data || []) {
    console.log(`Workflow: "${wf.name}" (ID: ${wf.id})`);
    for (const s of wf.customStatuses) {
      console.log(`  - "${s.name}" (ID: ${s.id})`);
    }
    console.log('');
  }
}

discover().catch(console.error);

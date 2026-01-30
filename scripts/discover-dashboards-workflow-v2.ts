import 'dotenv/config';

const WRIKE_TOKEN = process.env.WRIKE_ACCESS_TOKEN;
const DASHBOARDS_WORKFLOW_ID = 'IEAGT6KAK4GPYD3U';

async function discover() {
  console.log('=== DASHBOARDS PROJECT WORKFLOW ===\n');

  // Get all workflows
  const workflowRes = await fetch('https://www.wrike.com/api/v4/workflows', {
    headers: { 'Authorization': `Bearer ${WRIKE_TOKEN}` }
  });
  const workflowData = await workflowRes.json() as any;

  // Find the Dashboards workflow
  const dashboardsWorkflow = workflowData.data?.find((wf: any) => wf.id === DASHBOARDS_WORKFLOW_ID);

  if (!dashboardsWorkflow) {
    console.log('Workflow not found! Listing all workflows:\n');
    for (const wf of workflowData.data || []) {
      console.log(`Workflow: "${wf.name}" (ID: ${wf.id})`);
    }
    return;
  }

  console.log(`Workflow: "${dashboardsWorkflow.name}"`);
  console.log(`ID: ${dashboardsWorkflow.id}`);
  console.log(`Standard: ${dashboardsWorkflow.standard}`);
  console.log('\nStatuses:');

  // Group by status group for clarity
  const groups: Record<string, any[]> = {};
  for (const status of dashboardsWorkflow.customStatuses || []) {
    if (!groups[status.group]) groups[status.group] = [];
    groups[status.group].push(status);
  }

  for (const [group, statuses] of Object.entries(groups)) {
    console.log(`\n  [${group}]`);
    for (const s of statuses) {
      console.log(`    - "${s.name}" (ID: ${s.id})`);
    }
  }

  // Generate the config code
  console.log('\n\n=== CONFIGURATION CODE ===\n');
  console.log('// Paste this into src/types/wrike.ts\n');
  console.log('export const WRIKE_CONFIG = {');
  console.log("  FOLDER_ID: 'MQAAAAEEBpOb', // Dashboards project");
  console.log(`  WORKFLOW_ID: '${DASHBOARDS_WORKFLOW_ID}',`);
  console.log('');
  console.log('  STATUS_IDS: {');

  // Try to match statuses to our dashboard statuses
  const statusMap: Record<string, string> = {};
  for (const s of dashboardsWorkflow.customStatuses || []) {
    const nameLower = s.name.toLowerCase();
    if (nameLower.includes('backlog')) statusMap.SUBMITTED = s.id;
    else if (nameLower.includes('planned') || nameLower.includes('priorit')) statusMap.PLANNED = s.id;
    else if (nameLower.includes('progress')) statusMap.IN_PROGRESS = s.id;
    else if (nameLower.includes('done') || nameLower.includes('complete')) statusMap.DONE = s.id;
    else if (nameLower.includes('cancel') || nameLower.includes('archive')) statusMap.ARCHIVED = s.id;
  }

  for (const [key, id] of Object.entries(statusMap)) {
    const status = dashboardsWorkflow.customStatuses.find((s: any) => s.id === id);
    console.log(`    ${key}: '${id}', // ${status?.name}`);
  }

  console.log('  },');
  console.log('} as const;');
}

discover().catch(console.error);

import 'dotenv/config';

const WRIKE_TOKEN = process.env.WRIKE_ACCESS_TOKEN;
const FOLDER_ID = 'MQAAAAEEBpOb'; // Dashboards folder

async function discover() {
  console.log('=== DASHBOARDS FOLDER INFO ===\n');

  // Get folder details
  const folderRes = await fetch(`https://www.wrike.com/api/v4/folders/${FOLDER_ID}`, {
    headers: { 'Authorization': `Bearer ${WRIKE_TOKEN}` }
  });
  const folderData = await folderRes.json() as any;
  console.log('Folder data:', JSON.stringify(folderData.data?.[0], null, 2));

  // Get tasks in the folder
  console.log('\n=== TASKS IN DASHBOARDS FOLDER ===\n');
  const tasksRes = await fetch(`https://www.wrike.com/api/v4/folders/${FOLDER_ID}/tasks`, {
    headers: { 'Authorization': `Bearer ${WRIKE_TOKEN}` }
  });
  const tasksData = await tasksRes.json() as any;

  // Collect unique status IDs
  const statusIds = new Set<string>();
  for (const task of tasksData.data || []) {
    if (task.customStatusId) {
      statusIds.add(task.customStatusId);
    }
    console.log(`Task: "${task.title}"`);
    console.log(`  Status ID: ${task.customStatusId}`);
    console.log(`  Status: ${task.status}`);
  }

  console.log('\n=== UNIQUE STATUS IDs FOUND ===');
  console.log([...statusIds]);

  // Now look up what these statuses are called
  console.log('\n=== STATUS NAME LOOKUP ===');
  const workflowRes = await fetch('https://www.wrike.com/api/v4/workflows', {
    headers: { 'Authorization': `Bearer ${WRIKE_TOKEN}` }
  });
  const workflowData = await workflowRes.json() as any;

  for (const statusId of statusIds) {
    for (const wf of workflowData.data || []) {
      const status = wf.customStatuses?.find((s: any) => s.id === statusId);
      if (status) {
        console.log(`${statusId} = "${status.name}" (workflow: ${wf.name})`);
        break;
      }
    }
  }
}

discover().catch(console.error);

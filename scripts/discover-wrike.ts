/**
 * Wrike Discovery Script
 * Run with: npx ts-node scripts/discover-wrike.ts
 *
 * This script discovers your Wrike folder IDs, workflow IDs, and status IDs
 * so you can configure the integration correctly.
 */

import 'dotenv/config';

const WRIKE_TOKEN = process.env.WRIKE_ACCESS_TOKEN;

if (!WRIKE_TOKEN) {
  console.error('ERROR: WRIKE_ACCESS_TOKEN not set in environment');
  console.log('Add WRIKE_ACCESS_TOKEN to your .env.local file');
  process.exit(1);
}

async function wrikeRequest<T>(endpoint: string): Promise<T> {
  const url = `https://www.wrike.com/api/v4${endpoint}`;
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${WRIKE_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Wrike API error ${response.status}: ${text}`);
  }

  const data = await response.json() as { data: T };
  return data.data;
}

interface WrikeFolder {
  id: string;
  title: string;
  childIds?: string[];
  scope: string;
  project?: {
    authorId: string;
    ownerIds: string[];
    customStatusId?: string;
  };
}

interface WrikeWorkflow {
  id: string;
  name: string;
  standard: boolean;
  hidden: boolean;
  customStatuses: Array<{
    id: string;
    name: string;
    standardName: boolean;
    color: string;
    group: string;
  }>;
}

interface WrikeCustomField {
  id: string;
  title: string;
  type: string;
  settings?: {
    values?: string[];
  };
}

async function discoverWrike() {
  console.log('='.repeat(60));
  console.log('WRIKE DISCOVERY');
  console.log('='.repeat(60));
  console.log('');

  // 1. Get all folders/projects
  console.log('📁 FOLDERS & PROJECTS');
  console.log('-'.repeat(40));

  try {
    const folders = await wrikeRequest<WrikeFolder[]>('/folders');

    // Filter to show project folders
    const projects = folders.filter(f => f.project);

    if (projects.length > 0) {
      console.log('Projects found:');
      for (const folder of projects) {
        console.log(`  - "${folder.title}"`);
        console.log(`    ID: ${folder.id}`);
        console.log('');
      }
    }

    // Also show root-level folders that might contain projects
    const rootFolders = folders.filter(f => f.scope === 'WsFolder' && !f.project);
    if (rootFolders.length > 0) {
      console.log('Root folders:');
      for (const folder of rootFolders.slice(0, 10)) {
        console.log(`  - "${folder.title}" (ID: ${folder.id})`);
      }
      if (rootFolders.length > 10) {
        console.log(`  ... and ${rootFolders.length - 10} more`);
      }
      console.log('');
    }
  } catch (err) {
    console.error('Error fetching folders:', err);
  }

  // 2. Get workflows and statuses
  console.log('');
  console.log('🔄 WORKFLOWS & STATUSES');
  console.log('-'.repeat(40));

  try {
    const workflows = await wrikeRequest<WrikeWorkflow[]>('/workflows');

    for (const workflow of workflows) {
      console.log(`Workflow: "${workflow.name}"`);
      console.log(`  ID: ${workflow.id}`);
      console.log(`  Standard: ${workflow.standard}`);
      console.log('  Statuses:');

      // Group by status group
      const groups: Record<string, typeof workflow.customStatuses> = {};
      for (const status of workflow.customStatuses) {
        if (!groups[status.group]) groups[status.group] = [];
        groups[status.group].push(status);
      }

      for (const [group, statuses] of Object.entries(groups)) {
        console.log(`    [${group}]`);
        for (const status of statuses) {
          console.log(`      - "${status.name}" (ID: ${status.id})`);
        }
      }
      console.log('');
    }
  } catch (err) {
    console.error('Error fetching workflows:', err);
  }

  // 3. Get custom fields
  console.log('');
  console.log('📋 CUSTOM FIELDS');
  console.log('-'.repeat(40));

  try {
    const fields = await wrikeRequest<WrikeCustomField[]>('/customfields');

    for (const field of fields) {
      console.log(`Field: "${field.title}"`);
      console.log(`  ID: ${field.id}`);
      console.log(`  Type: ${field.type}`);
      if (field.settings?.values) {
        console.log(`  Values: ${field.settings.values.join(', ')}`);
      }
      console.log('');
    }
  } catch (err) {
    console.error('Error fetching custom fields:', err);
  }

  // Print configuration template
  console.log('');
  console.log('='.repeat(60));
  console.log('NEXT STEPS');
  console.log('='.repeat(60));
  console.log('');
  console.log('1. Find your Dashboard Requests folder/project ID above');
  console.log('2. Find the workflow with statuses matching:');
  console.log('   - Backlog (for SUBMITTED)');
  console.log('   - Planned/Prioritized (for PLANNED)');
  console.log('   - In Progress (for IN_PROGRESS)');
  console.log('   - Done/Completed (for DONE)');
  console.log('   - Cancelled/Archived (for ARCHIVED)');
  console.log('');
  console.log('3. Update src/types/wrike.ts with the correct IDs');
  console.log('4. Set WRIKE_FOLDER_ID in your .env.local file');
  console.log('');
}

discoverWrike().catch(console.error);

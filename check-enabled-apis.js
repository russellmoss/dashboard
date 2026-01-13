// check-enabled-apis.js
const { google } = require('googleapis');
const fs = require('fs');

async function checkEnabledAPIs() {
  console.log('🔍 Checking Enabled APIs...\n');
  
  try {
    const credentialsPath = 'C:\\Users\\russe\\automated_scraper\\config\\savvy-pirate-extension-a5c6a37460a2.json';
    const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
    
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    
    const serviceusage = google.serviceusage({ version: 'v1', auth });
    
    // List enabled services
    const response = await serviceusage.services.list({
      parent: `projects/${credentials.project_id}`,
      filter: 'state:ENABLED'
    });
    
    console.log('Enabled APIs:');
    response.data.services?.forEach(service => {
      if (service.config?.name?.includes('sheets') || service.config?.name?.includes('drive')) {
        console.log('✅', service.config.name);
      }
    });
    
  } catch (error) {
    // This might fail if service usage API isn't enabled
    console.log('Could not list APIs (this is okay)');
    console.log('Please manually check in the console');
  }
}

checkEnabledAPIs();
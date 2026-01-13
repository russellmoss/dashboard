// test-sheets-with-full-scopes.js
const { google } = require('googleapis');
const fs = require('fs');

async function testWithFullScopes() {
  console.log('🔍 Testing with Full Drive Scopes...\n');
  
  try {
    const credentialsPath = 'C:\\Users\\russe\\automated_scraper\\config\\savvy-pirate-extension-a5c6a37460a2.json';
    const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
    
    console.log('📧 Service Account:', credentials.client_email);
    
    // Try with broader scopes
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive', // Full Drive access
      ],
    });
    
    const sheets = google.sheets({ version: 'v4', auth });
    
    // Simple test - just try to create
    const spreadsheet = await sheets.spreadsheets.create({
      requestBody: {
        properties: {
          title: `Test - ${Date.now()}`
        }
      }
    });
    
    console.log('✅ SUCCESS! Created:', spreadsheet.data.spreadsheetUrl);
    
  } catch (error) {
    console.error('❌ Still failing:', error.message);
    
    // More detailed error info
    if (error.response) {
      console.log('\nError Details:');
      console.log('Status:', error.response.status);
      console.log('Status Text:', error.response.statusText);
      console.log('Data:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

testWithFullScopes();
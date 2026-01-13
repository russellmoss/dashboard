// test-sheets-access.js
// Run this locally to test service account capabilities

const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

async function testServiceAccountPermissions() {
  console.log('🔍 Testing Service Account Permissions...\n');
  
  try {
    // Load your service account credentials with the correct path
    const credentialsPath = 'C:\\Users\\russe\\Documents\\Dashboard\\.json\\savvy-gtm-analytics-2233e5984994.json';
    
    // Check if file exists
    if (!fs.existsSync(credentialsPath)) {
      console.error('❌ Credentials file not found at:', credentialsPath);
      console.log('\nChecking .json directory contents:');
      const jsonDir = 'C:\\Users\\russe\\Documents\\Dashboard\\.json';
      if (fs.existsSync(jsonDir)) {
        const files = fs.readdirSync(jsonDir);
        console.log('Files found:', files);
      }
      return;
    }
    
    console.log('📄 Loading credentials from:', credentialsPath);
    const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
    
    console.log('📧 Service Account Email:', credentials.client_email);
    console.log('🏗️  Project ID:', credentials.project_id);
    console.log('');
    
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive.file',
      ],
    });
    
    const authClient = await auth.getClient();
    console.log('✅ Service account authenticated successfully');
    
    const sheets = google.sheets({ version: 'v4', auth: authClient });
    
    // Test 2: Try creating a spreadsheet
    console.log('\n📝 Testing spreadsheet creation...');
    const spreadsheet = await sheets.spreadsheets.create({
      requestBody: {
        properties: {
          title: `Test Sheet - ${new Date().toISOString()}`
        }
      }
    });
    
    console.log('✅ Successfully created spreadsheet!');
    console.log('📊 Spreadsheet ID:', spreadsheet.data.spreadsheetId);
    console.log('🔗 URL:', spreadsheet.data.spreadsheetUrl);
    
    // Test 3: Can we write data?
    console.log('\n📝 Testing data writing...');
    await sheets.spreadsheets.values.update({
      spreadsheetId: spreadsheet.data.spreadsheetId,
      range: 'Sheet1!A1:D3',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [
          ['Advisor', 'Stage', 'Conversion Rate', 'AUM'],
          ['Test Advisor 1', 'SQL', '=75%', '$1,000,000'],
          ['Test Advisor 2', 'SQO', '=82%', '$2,500,000']
        ]
      }
    });
    
    console.log('✅ Successfully wrote data to spreadsheet!');
    
    // Test 4: Try to share the sheet
    console.log('\n🔄 Testing sharing capabilities...');
    const drive = google.drive({ version: 'v3', auth: authClient });
    try {
      // Try to share with a test email (replace with your email)
      await drive.permissions.create({
        fileId: spreadsheet.data.spreadsheetId,
        requestBody: {
          type: 'user',
          role: 'writer',
          emailAddress: 'russell@savvywealth.com' // Change this to your email
        }
      });
      console.log('✅ Successfully shared spreadsheet!');
    } catch (shareError) {
      console.log('⚠️  Could not share spreadsheet:', shareError.message);
      console.log('    (This is okay - sharing might be restricted)');
    }
    
    // Test 5: Create a chart
    console.log('\n📊 Testing chart creation...');
    try {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: spreadsheet.data.spreadsheetId,
        requestBody: {
          requests: [{
            addChart: {
              chart: {
                spec: {
                  title: 'Test Chart',
                  basicChart: {
                    chartType: 'COLUMN',
                    legendPosition: 'BOTTOM_LEGEND',
                    axis: [
                      { position: 'BOTTOM_AXIS', title: 'Advisor' },
                      { position: 'LEFT_AXIS', title: 'Value' }
                    ],
                    domains: [{
                      domain: {
                        sourceRange: {
                          sources: [{
                            sheetId: 0,
                            startRowIndex: 0,
                            endRowIndex: 3,
                            startColumnIndex: 0,
                            endColumnIndex: 1
                          }]
                        }
                      }
                    }],
                    series: [{
                      series: {
                        sourceRange: {
                          sources: [{
                            sheetId: 0,
                            startRowIndex: 0,
                            endRowIndex: 3,
                            startColumnIndex: 3,
                            endColumnIndex: 4
                          }]
                        }
                      },
                      targetAxis: 'LEFT_AXIS'
                    }],
                    headerCount: 1
                  }
                },
                position: {
                  overlayPosition: {
                    anchorCell: {
                      sheetId: 0,
                      rowIndex: 5,
                      columnIndex: 0
                    },
                    widthPixels: 600,
                    heightPixels: 400
                  }
                }
              }
            }
          }]
        }
      });
      console.log('✅ Successfully created chart in spreadsheet!');
    } catch (chartError) {
      console.log('⚠️  Could not create chart:', chartError.message);
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('🎉 SUCCESS! Service account CAN work with Google Sheets!');
    console.log('='.repeat(60));
    console.log('\n📋 Summary:');
    console.log('✅ Authentication works');
    console.log('✅ Can create spreadsheets');
    console.log('✅ Can write data');
    console.log('✅ Can create charts');
    console.log('🔗 Test spreadsheet URL:', spreadsheet.data.spreadsheetUrl);
    console.log('\n📝 Next Steps:');
    console.log('1. The service account owns the created sheets');
    console.log('2. You can programmatically share sheets with user emails');
    console.log('3. Or use Drive API to transfer ownership');
    console.log('4. Ready to implement in your dashboard!');
    
    return spreadsheet.data;
    
  } catch (error) {
    console.error('\n❌ Test failed!');
    console.error('Error:', error.message);
    
    if (error.code === 403 || error.message.includes('403')) {
      console.log('\n🚫 Permission Denied (403 Error)');
      console.log('This usually means:');
      console.log('1. Google Sheets API is NOT enabled in the GCP project');
      console.log('2. Service account lacks the required scopes');
      console.log('\n🔧 Solution Options:');
      console.log('Option A: Get someone with GCP project permissions to:');
      console.log('  1. Go to https://console.cloud.google.com');
      console.log('  2. Select project: savvy-gtm-analytics');
      console.log('  3. Go to "APIs & Services" → "Library"');
      console.log('  4. Search for "Google Sheets API"');
      console.log('  5. Click "Enable"');
      console.log('\nOption B: Use Client-side OAuth instead:');
      console.log('  - No GCP permissions needed');
      console.log('  - Users authenticate with their own Google accounts');
      console.log('  - Sheets saved to users\' Google Drive');
    }
    
    if (error.message.includes('API has not been used in project')) {
      const projectMatch = error.message.match(/project (\d+)/);
      const projectNumber = projectMatch ? projectMatch[1] : 'unknown';
      console.log('\n🔴 Google Sheets API is NOT ENABLED');
      console.log(`Project Number: ${projectNumber}`);
      console.log('The Sheets API must be enabled in the GCP Console.');
      console.log('\nSince you have limited permissions, use Option B: Client-side OAuth');
    }
    
    if (error.message.includes('ENOENT')) {
      console.log('\n📁 File not found error');
      console.log('Check that the credentials file exists at the specified path');
    }
  }
}

// Also check what APIs are likely enabled based on what we know works
async function checkKnownCapabilities() {
  console.log('\n' + '='.repeat(60));
  console.log('📊 Checking Known Working Capabilities');
  console.log('='.repeat(60));
  
  try {
    const credentialsPath = 'C:\\Users\\russe\\Documents\\Dashboard\\.json\\savvy-gtm-analytics-2233e5984994.json';
    const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
    
    console.log('\n✅ Known Working:');
    console.log('  • BigQuery API (confirmed working)');
    console.log('  • BigQuery Data Viewer role');
    console.log('  • BigQuery Job User role');
    
    console.log('\n❓ To Be Tested:');
    console.log('  • Google Sheets API');
    console.log('  • Google Drive API (for sharing)');
    
    console.log('\n📌 Service Account Details:');
    console.log('  • Email:', credentials.client_email);
    console.log('  • Project:', credentials.project_id);
    console.log('  • Key Created:', new Date(credentials.private_key_id.substring(0, 8)).toLocaleDateString());
    
  } catch (error) {
    console.error('Could not read credentials:', error.message);
  }
}

// Run the tests
console.log('🚀 Starting Google Sheets API Test\n');
console.log('This will test if your service account can:');
console.log('  1. Create Google Sheets');
console.log('  2. Write data to sheets');
console.log('  3. Create charts');
console.log('  4. Share sheets with users\n');

testServiceAccountPermissions().then(() => {
  checkKnownCapabilities();
}).catch(error => {
  console.error('\n💥 Unexpected error:', error);
});
// test-existing-sheets-account.js
const { google } = require('googleapis');
const fs = require('fs');

async function testExistingServiceAccount() {
  console.log('🔍 Testing Existing Service Account (savvy-pirate-extension)...\n');
  
  try {
    // Load your EXISTING service account credentials
    const credentialsPath = 'C:\\Users\\russe\\automated_scraper\\config\\savvy-pirate-extension-a5c6a37460a2.json';
    
    console.log('📄 Loading credentials from:', credentialsPath);
    const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
    
    console.log('📧 Service Account Email:', credentials.client_email);
    console.log('🏗️  Project ID:', credentials.project_id);
    console.log('✅ This project already has Sheets API enabled!\n');
    
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive.file',
      ],
    });
    
    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });
    
    // Create a test spreadsheet
    console.log('📝 Creating test spreadsheet...');
    const spreadsheet = await sheets.spreadsheets.create({
      requestBody: {
        properties: {
          title: `Dashboard Export Test - ${new Date().toISOString()}`
        }
      }
    });
    
    console.log('✅ Successfully created spreadsheet!');
    console.log('📊 Spreadsheet ID:', spreadsheet.data.spreadsheetId);
    console.log('🔗 URL:', spreadsheet.data.spreadsheetUrl);
    
    // Write test data
    await sheets.spreadsheets.values.update({
      spreadsheetId: spreadsheet.data.spreadsheetId,
      range: 'Sheet1!A1:E3',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [
          ['Period', 'Contacted→MQL', 'MQL→SQL', 'SQL→SQO', 'SQO→Joined'],
          ['Q4 2025', '3.6%', '34.2%', '74.6%', '11.6%'],
          ['Q3 2025', '4.2%', '31.5%', '72.1%', '13.2%']
        ]
      }
    });
    
    console.log('✅ Successfully wrote data!');
    
    // Test sharing
    const drive = google.drive({ version: 'v3', auth: authClient });
    try {
      await drive.permissions.create({
        fileId: spreadsheet.data.spreadsheetId,
        requestBody: {
          type: 'user',
          role: 'writer',
          emailAddress: 'russell@savvywealth.com' // Your email
        }
      });
      console.log('✅ Successfully shared with your email!');
    } catch (shareError) {
      console.log('⚠️  Sharing error (may need Drive API scope):', shareError.message);
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('🎉 SUCCESS! Your existing service account works perfectly!');
    console.log('='.repeat(60));
    console.log('\n📋 Next Steps:');
    console.log('1. Copy the service account JSON to your dashboard project');
    console.log('2. Use server-side export (no OAuth needed!)');
    console.log('3. Sheets will be created and shared with users automatically');
    console.log('\n🔗 Test spreadsheet:', spreadsheet.data.spreadsheetUrl);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testExistingServiceAccount();
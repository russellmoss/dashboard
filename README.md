# BigQuery Connection Test for Savvy Funnel Dashboard

This test harness verifies that you can connect to BigQuery and query `vw_funnel_master` before building the full dashboard.

---

## Prerequisites

- Node.js 18+ installed
- Access to GCP Console for `savvy-gtm-analytics` project
- Permission to create service accounts (or ask your GCP admin)

---

## Step-by-Step Setup

### Step 1: Create a Service Account in GCP

1. **Go to GCP Console**: https://console.cloud.google.com/

2. **Select your project**: Make sure `savvy-gtm-analytics` is selected in the project dropdown (top left)

3. **Navigate to Service Accounts**:
   - Click the hamburger menu (☰) → **IAM & Admin** → **Service Accounts**
   - Or go directly to: https://console.cloud.google.com/iam-admin/serviceaccounts?project=savvy-gtm-analytics

4. **Create a new service account**:
   - Click **+ CREATE SERVICE ACCOUNT** (top of page)
   - **Service account name**: `dashboard-bigquery-reader`
   - **Service account ID**: Will auto-fill to `dashboard-bigquery-reader`
   - **Description**: `Read-only access to BigQuery for funnel dashboard`
   - Click **CREATE AND CONTINUE**

5. **Grant permissions** (this is the important part!):
   - Click **Select a role** dropdown
   - Search for `BigQuery Data Viewer` and select it
   - Click **+ ADD ANOTHER ROLE**
   - Search for `BigQuery Job User` and select it
   - Click **CONTINUE**
   
   > **Why both roles?**
   > - `BigQuery Data Viewer`: Lets you read data from tables/views
   > - `BigQuery Job User`: Lets you run queries (required!)

6. **Skip the optional step** (grant users access) - just click **DONE**

---

### Step 2: Download the Service Account Key

1. **Find your new service account** in the list and click on it

2. **Go to Keys tab**: Click the **KEYS** tab at the top

3. **Create a new key**:
   - Click **ADD KEY** → **Create new key**
   - Select **JSON** format
   - Click **CREATE**

4. **A JSON file will download** - this is your credentials file!
   - It will be named something like: `savvy-gtm-analytics-abc123.json`
   - ⚠️ **Keep this file secure** - it grants access to your data

5. **Move the file** to this project folder and rename it:
   ```bash
   mv ~/Downloads/savvy-gtm-analytics-*.json ./service-account-key.json
   ```

---

### Step 3: Configure Environment Variables

1. **Copy the example env file**:
   ```bash
   cp .env.example .env
   ```

2. **Verify the .env file** looks like this:
   ```
   GOOGLE_APPLICATION_CREDENTIALS=./service-account-key.json
   GCP_PROJECT_ID=savvy-gtm-analytics
   BQ_DATASET=Tableau_Views
   BQ_VIEW=vw_funnel_master
   ```

3. **Make sure the path is correct** - if you named your key file differently, update the path

---

### Step 4: Install Dependencies

```bash
npm install
```

This installs:
- `@google-cloud/bigquery` - Google's official BigQuery client
- `dotenv` - Loads your .env file

---

### Step 5: Run the Connection Test

```bash
npm test
```

**Expected output** (if everything is working):

```
============================================================
🔌 BIGQUERY CONNECTION TEST
============================================================

Step 1: Checking credentials...
✅ Credentials file found: ./service-account-key.json

Step 2: Initializing BigQuery client...
✅ BigQuery client initialized for project: savvy-gtm-analytics

Step 3: Testing basic query (SELECT 1)...
✅ Basic query successful: { test_value: 1 }

Step 4: Listing datasets in project...
✅ Found 5 datasets:
   - SavvyGTMData
   - Tableau_Views ⭐ (target)
   - ...

Step 5: Checking access to vw_funnel_master view...
✅ View accessible! Total rows: 45,231

Step 6: Fetching view schema...
✅ View has 65 columns. Key fields:
   ✓ primary_key (STRING)
   ✓ advisor_name (STRING)
   ...

============================================================
🎉 ALL TESTS PASSED - BigQuery connection is working!
============================================================
```

---

### Step 6: Run Additional Tests

**Test filtered queries** (like your dashboard will use):
```bash
npm run test:query
```

**Test the full dashboard data structure**:
```bash
npm run test:dashboard
```

This last one writes a `dashboard-data-sample.json` file showing exactly what your React app will receive.

---

## Troubleshooting

### ❌ "Could not load the default credentials"

**Cause**: The credentials file path is wrong or file doesn't exist

**Fix**: 
- Check that `service-account-key.json` exists in this folder
- Make sure `.env` has the correct path

---

### ❌ "Permission denied" or "Access Denied"

**Cause**: Service account doesn't have the right roles

**Fix**: Go back to GCP Console → IAM → find your service account → Edit → Add roles:
- `BigQuery Data Viewer`
- `BigQuery Job User`

If you still get errors specifically on `vw_funnel_master`:
- The service account may need access granted at the **dataset level**
- Go to BigQuery Console → `Tableau_Views` dataset → **SHARING** → Add the service account email with "BigQuery Data Viewer"

---

### ❌ "Dataset not found" or "Table not found"

**Cause**: Either the dataset/view name is wrong, or you're in the wrong project

**Fix**:
- Verify in BigQuery Console that `Tableau_Views.vw_funnel_master` exists
- Check that `.env` has `GCP_PROJECT_ID=savvy-gtm-analytics`

---

### ❌ "Quota exceeded" or "Rate limit"

**Cause**: Too many queries or project quota issues

**Fix**: This is usually temporary - wait a minute and retry. If persistent, check your GCP quotas.

---

## What's Next?

Once all tests pass, you're ready to build the full dashboard!

The test scripts in this folder become the foundation for your Next.js API routes:
- `test-connection.js` → Health check endpoint
- `test-query.js` → Filter dropdowns endpoint  
- `test-dashboard-queries.js` → Main dashboard data endpoint

Next steps:
1. Set up Next.js project with Vercel
2. Add NextAuth.js for Google OAuth
3. Create API routes using these query patterns
4. Build React dashboard components

---

## File Structure

```
bq-test/
├── package.json              # Dependencies
├── .env.example              # Environment template
├── .env                      # Your actual config (create this)
├── service-account-key.json  # Your GCP credentials (download this)
├── test-connection.js        # Basic connection test
├── test-query.js             # Filtered query tests
├── test-dashboard-queries.js # Full dashboard data structure
└── README.md                 # This file
```

---

## Security Notes

⚠️ **Never commit these files to git:**
- `service-account-key.json`
- `.env`

Add them to `.gitignore`:
```
.env
service-account-key.json
*.json
!package.json
```

For production (Vercel), you'll add the service account JSON as an environment variable, not a file.

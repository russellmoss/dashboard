# Google Sheets Export Feature - Agentic Implementation Guide

## Overview

This guide provides step-by-step instructions for implementing a Google Sheets export feature in the Savvy Funnel Analytics Dashboard. Users will be able to export their current dashboard view to a Google Sheet with complete data transparency for validating conversion rate calculations.

**Key Constraint**: The service account can EDIT and COPY sheets, but cannot CREATE new sheets from scratch. We use a **template copy approach**.

---

## Pre-Implementation Checklist (CRITICAL - VERIFY BEFORE STARTING)

### ✅ Environment Setup Status

The following setup has already been completed:

- **Service Account JSON**: Copied to `.json/sheets-service-account.json`
- **Template Sheet**: Created with ID `143rmkaleDkDJGthNorETWtmYksj8XJGMrQ639LJwLGE`
- **Environment Variables**: Added to `.env`:
  ```env
  GOOGLE_SHEETS_TEMPLATE_ID=143rmkaleDkDJGthNorETWtmYksj8XJGMrQ639LJwLGE
  GOOGLE_SHEETS_SERVICE_ACCOUNT_PATH=.json/sheets-service-account.json
  ```
- **Service Account Email**: `sheet-436@savvy-pirate-extension.iam.gserviceaccount.com`

### ⚠️ PRE-FLIGHT VERIFICATION (Execute Before Phase 1)

**Run these commands to verify setup:**

```bash
# 1. Verify .json folder is in .gitignore
grep -q "^\.json/" .gitignore && echo "✓ .json/ is in .gitignore" || echo "✗ .json/ NOT in .gitignore - ADD IT!"

# 2. Verify service account file exists
test -f .json/sheets-service-account.json && echo "✓ Service account file exists" || echo "✗ Service account file missing!"

# 3. Verify environment variables are set
grep -q "GOOGLE_SHEETS_TEMPLATE_ID" .env && echo "✓ Template ID in .env" || echo "✗ Template ID missing from .env"
grep -q "GOOGLE_SHEETS_SERVICE_ACCOUNT_PATH" .env && echo "✓ Service account path in .env" || echo "✗ Service account path missing from .env"

# 4. Verify template sheet is accessible (manual check required)
echo "⚠️  MANUAL: Verify template sheet is shared with service account as Editor"
echo "   Service account: sheet-436@savvy-pirate-extension.iam.gserviceaccount.com"
echo "   Template ID: 143rmkaleDkDJGthNorETWtmYksj8XJGMrQ639LJwLGE"
```

**All checks must pass before proceeding!**

---

## Table of Contents

1. [Pre-Flight Verification](#pre-implementation-checklist-critical---verify-before-starting) ← START HERE
2. [Install Dependencies](#phase-1-install-dependencies)
3. [Create Type Definitions](#phase-2-create-type-definitions)
4. [Implement Google Sheets Exporter](#phase-3-implement-google-sheets-exporter)
5. [Create Export Query Functions](#phase-4-create-export-query-functions)
6. [Create API Route](#phase-5-create-api-route)
7. [Create Export Button Component](#phase-6-create-export-button-component)
8. [Integration & Testing](#phase-7-integration--testing)
9. [Vercel Deployment](#phase-8-vercel-deployment)

---

## Phase 1: Install Dependencies

### Step 1.1: Install googleapis Package

```bash
npm install googleapis --save
```

### Step 1.2: Verify Installation

```bash
# Check package is installed
npm list googleapis

# Verify no peer dependency warnings
npm install
```

### ✅ VERIFICATION GATE 1

**Execute these checks:**

```bash
# 1. Verify package.json includes googleapis
grep -q '"googleapis"' package.json && echo "✓ googleapis in package.json" || echo "✗ googleapis missing"

# 2. Verify node_modules exists
test -d node_modules/googleapis && echo "✓ googleapis installed" || echo "✗ googleapis not installed"

# 3. Run TypeScript check (should not fail on missing types)
npm run build 2>&1 | grep -i "googleapis" && echo "⚠️  Check for googleapis errors" || echo "✓ No googleapis errors"
```

**Expected Results:**
- ✓ googleapis in package.json
- ✓ googleapis installed
- ✓ No googleapis errors (or only pre-existing errors)

**If any check fails, DO NOT PROCEED. Fix the issue first.**

---

## Phase 2: Create Type Definitions

### Step 2.1: Create Sheets Types

**Create file: `src/lib/sheets/sheets-types.ts`**

```typescript
import { DashboardFilters } from '@/types/filters';
import { ConversionRates, TrendDataPoint, FunnelMetrics } from '@/types/dashboard';

/**
 * Complete record data for export - includes all fields needed for validation
 */
export interface ExportDetailRecord {
  // Identifiers
  leadId: string | null;
  contactId: string | null;
  opportunityId: string | null;
  primaryKey: string;
  
  // Advisor Info
  advisorName: string;
  salesforceUrl: string | null;
  
  // Attribution
  originalSource: string | null;
  channel: string | null;
  sga: string | null;
  sgm: string | null;
  
  // Stage Info
  stageName: string | null;
  aum: number;
  aumFormatted: string;
  
  // Date Fields (ISO strings)
  filterDate: string | null;
  contactedDate: string | null;      // stage_entered_contacting__c
  mqlDate: string | null;            // mql_stage_entered_ts
  sqlDate: string | null;            // converted_date_raw
  sqoDate: string | null;            // Date_Became_SQO__c
  joinedDate: string | null;         // advisor_join_date__c
  
  // Stage Flags (0 or 1)
  isContacted: number;
  isMql: number;
  isSql: number;
  isSqo: number;
  isJoined: number;
  
  // Progression Flags (Numerators) - 0 or 1
  contactedToMqlProgression: number;
  mqlToSqlProgression: number;
  sqlToSqoProgression: number;
  sqoToJoinedProgression: number;
  
  // Eligibility Flags (Denominators) - 0 or 1
  eligibleForContactedConversions: number;
  eligibleForMqlConversions: number;
  eligibleForSqlConversions: number;
  eligibleForSqoConversions: number;
  
  // Deduplication Flags
  isSqoUnique: number;
  isJoinedUnique: number;
  isPrimaryOppRecord: number;
  
  // Record Type
  recordTypeId: string | null;
  recordTypeName: string;
}

/**
 * Conversion analysis record for breakdown by conversion type
 */
export interface ConversionAnalysisRecord {
  advisorName: string;
  salesforceUrl: string | null;
  fromDate: string | null;
  toDate: string | null;
  inNumerator: boolean;
  inDenominator: boolean;
  notes: string;
}

/**
 * Full export data package
 */
export interface SheetsExportData {
  // Metadata
  exportDate: string;
  exportedBy: string;
  dateRange: {
    start: string;
    end: string;
    preset: string;
  };
  filtersApplied: {
    channel: string | null;
    source: string | null;
    sga: string | null;
    sgm: string | null;
  };
  
  // Summary Data
  metrics: FunnelMetrics;
  conversionRates: ConversionRates;
  
  // Trend Data
  trends: TrendDataPoint[];
  
  // Detail Records
  detailRecords: ExportDetailRecord[];
  
  // Conversion Analysis (grouped by conversion type)
  conversionAnalysis: {
    contactedToMql: ConversionAnalysisRecord[];
    mqlToSql: ConversionAnalysisRecord[];
    sqlToSqo: ConversionAnalysisRecord[];
    sqoToJoined: ConversionAnalysisRecord[];
  };
}

/**
 * Result of sheet export operation
 */
export interface SheetsExportResult {
  success: boolean;
  spreadsheetId?: string;
  spreadsheetUrl?: string;
  error?: string;
}

/**
 * Options for export
 */
export interface ExportOptions {
  filters: DashboardFilters;
  userEmail: string;
  includeDetailRecords?: boolean;  // Default true, but can skip for speed
  maxDetailRecords?: number;       // Limit for very large exports
}
```

### Step 2.2: Create Index Export

**Create file: `src/lib/sheets/index.ts`**

```typescript
export * from './sheets-types';
export * from './google-sheets-exporter';
```

### ✅ VERIFICATION GATE 2

**Execute these checks:**

```bash
# 1. Verify files exist
test -f src/lib/sheets/sheets-types.ts && echo "✓ sheets-types.ts created" || echo "✗ sheets-types.ts missing"
test -f src/lib/sheets/index.ts && echo "✓ index.ts created" || echo "✗ index.ts missing"

# 2. Run TypeScript compilation
npm run build 2>&1 | tee build-output.log

# 3. Check for type errors in new files
grep -i "sheets-types\|sheets/index" build-output.log && echo "⚠️  Check for errors in new files" || echo "✓ No errors in new files"
```

**Expected Results:**
- ✓ sheets-types.ts created
- ✓ index.ts created
- ✓ No TypeScript errors (or only pre-existing errors unrelated to sheets)

**If TypeScript errors exist, fix them before proceeding.**

---

## Phase 3: Implement Google Sheets Exporter

### Step 3.1: Create the Google Sheets Exporter Class

**Create file: `src/lib/sheets/google-sheets-exporter.ts`**

```typescript
import { google, sheets_v4, drive_v3 } from 'googleapis';
import { JWT } from 'google-auth-library';
import { 
  SheetsExportData, 
  SheetsExportResult, 
  ExportDetailRecord,
  ConversionAnalysisRecord 
} from './sheets-types';
import fs from 'fs';
import path from 'path';

/**
 * Google Sheets Exporter
 * Uses template-copy approach since service account cannot create sheets from scratch
 */
export class GoogleSheetsExporter {
  private sheets: sheets_v4.Sheets;
  private drive: drive_v3.Drive;
  private templateId: string;

  constructor() {
    const auth = this.getAuthClient();
    this.sheets = google.sheets({ version: 'v4', auth });
    this.drive = google.drive({ version: 'v3', auth });
    this.templateId = process.env.GOOGLE_SHEETS_TEMPLATE_ID || '';
    
    if (!this.templateId) {
      throw new Error('GOOGLE_SHEETS_TEMPLATE_ID environment variable is required');
    }
  }

  /**
   * Get authenticated client - works for both local and Vercel
   */
  private getAuthClient(): JWT {
    let credentials: any;

    // Try environment variable first (Vercel deployment)
    if (process.env.GOOGLE_SHEETS_CREDENTIALS_JSON) {
      try {
        credentials = JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS_JSON);
      } catch (error) {
        throw new Error('Failed to parse GOOGLE_SHEETS_CREDENTIALS_JSON: ' + (error instanceof Error ? error.message : 'Unknown error'));
      }
    } 
    // Fall back to file (local development)
    else if (process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_PATH) {
      const credPath = path.resolve(process.cwd(), process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_PATH);
      if (fs.existsSync(credPath)) {
        try {
          credentials = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
        } catch (error) {
          throw new Error(`Failed to read credentials from ${credPath}: ` + (error instanceof Error ? error.message : 'Unknown error'));
        }
      } else {
        throw new Error(`Credentials file not found at: ${credPath}`);
      }
    } else {
      throw new Error('Google Sheets credentials not found. Set GOOGLE_SHEETS_CREDENTIALS_JSON (Vercel) or GOOGLE_SHEETS_SERVICE_ACCOUNT_PATH (local)');
    }

    if (!credentials?.client_email || !credentials?.private_key) {
      throw new Error('Invalid credentials: missing client_email or private_key');
    }

    return new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive',
      ],
    });
  }

  /**
   * Main export function - copies template and populates with data
   */
  async exportToSheets(data: SheetsExportData): Promise<SheetsExportResult> {
    try {
      // Step 1: Copy the template
      const newSpreadsheet = await this.copyTemplate(data);
      const spreadsheetId = newSpreadsheet.id!;

      if (!spreadsheetId) {
        throw new Error('Failed to get spreadsheet ID after copy');
      }

      // Small delay to ensure copy is fully processed
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Step 2: Populate all sheets
      await this.populateSummarySheet(spreadsheetId, data);
      await this.populateTrendDataSheet(spreadsheetId, data.trends);
      await this.populateDetailRecordsSheet(spreadsheetId, data.detailRecords);
      await this.populateConversionAnalysisSheet(spreadsheetId, data.conversionAnalysis);
      await this.populateValidationSheet(spreadsheetId, data);

      // Step 3: Share with the user
      await this.shareWithUser(spreadsheetId, data.exportedBy);

      return {
        success: true,
        spreadsheetId,
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
      };
    } catch (error) {
      console.error('Google Sheets export error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error during export',
      };
    }
  }

  /**
   * Copy the template spreadsheet
   */
  private async copyTemplate(data: SheetsExportData): Promise<drive_v3.Schema$File> {
    const dateStr = new Date().toISOString().split('T')[0];
    const filterStr = this.buildFilterString(data);
    const title = `Savvy Dashboard Export - ${data.dateRange.start} to ${data.dateRange.end}${filterStr ? ` - ${filterStr}` : ''} - ${dateStr}`;

    try {
      const response = await this.drive.files.copy({
        fileId: this.templateId,
        requestBody: {
          name: title,
        },
      });

      if (!response.data.id) {
        throw new Error('Template copy succeeded but no ID returned');
      }

      return response.data;
    } catch (error) {
      if (error instanceof Error && error.message.includes('404')) {
        throw new Error(`Template sheet not found. Verify template ID ${this.templateId} is correct and shared with service account.`);
      }
      throw error;
    }
  }

  /**
   * Build a short filter description for the filename
   */
  private buildFilterString(data: SheetsExportData): string {
    const parts: string[] = [];
    if (data.filtersApplied.channel) parts.push(data.filtersApplied.channel);
    if (data.filtersApplied.source) parts.push(data.filtersApplied.source);
    if (data.filtersApplied.sga) parts.push(data.filtersApplied.sga);
    if (data.filtersApplied.sgm) parts.push(data.filtersApplied.sgm);
    return parts.join(', ');
  }

  /**
   * Share the spreadsheet with the user
   */
  private async shareWithUser(spreadsheetId: string, userEmail: string): Promise<void> {
    try {
      await this.drive.permissions.create({
        fileId: spreadsheetId,
        requestBody: {
          type: 'user',
          role: 'writer',
          emailAddress: userEmail,
        },
        sendNotificationEmail: false,
      });
    } catch (error) {
      // Log but don't fail - sheet is still created
      console.warn(`Failed to share sheet with ${userEmail}:`, error);
    }
  }

  /**
   * Populate the Summary sheet
   */
  private async populateSummarySheet(spreadsheetId: string, data: SheetsExportData): Promise<void> {
    const values = [
      ['Export Date', data.exportDate],
      ['Exported By', data.exportedBy],
      ['Date Range', `${data.dateRange.start} to ${data.dateRange.end} (${data.dateRange.preset})`],
      ['Filters Applied', this.formatFiltersApplied(data.filtersApplied)],
      [''],
      ['FUNNEL METRICS', ''],
      ['SQLs', data.metrics.sqls],
      ['SQOs', data.metrics.sqos],
      ['Joined', data.metrics.joined],
      ['Pipeline AUM', this.formatCurrency(data.metrics.pipelineAum)],
      ['Joined AUM', this.formatCurrency(data.metrics.joinedAum)],
      ['Open Pipeline AUM', this.formatCurrency(data.metrics.openPipelineAum)],
      [''],
      ['CONVERSION RATES', ''],
      ['Contacted → MQL', `${(data.conversionRates.contactedToMql.rate * 100).toFixed(1)}% (${data.conversionRates.contactedToMql.numerator}/${data.conversionRates.contactedToMql.denominator})`],
      ['MQL → SQL', `${(data.conversionRates.mqlToSql.rate * 100).toFixed(1)}% (${data.conversionRates.mqlToSql.numerator}/${data.conversionRates.mqlToSql.denominator})`],
      ['SQL → SQO', `${(data.conversionRates.sqlToSqo.rate * 100).toFixed(1)}% (${data.conversionRates.sqlToSqo.numerator}/${data.conversionRates.sqlToSqo.denominator})`],
      ['SQO → Joined', `${(data.conversionRates.sqoToJoined.rate * 100).toFixed(1)}% (${data.conversionRates.sqoToJoined.numerator}/${data.conversionRates.sqoToJoined.denominator})`],
    ];

    await this.sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'Summary!A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values },
    });
  }

  /**
   * Populate the Trend Data sheet
   */
  private async populateTrendDataSheet(spreadsheetId: string, trends: SheetsExportData['trends']): Promise<void> {
    const headers = [
      'Period', 'SQLs', 'SQOs', 'Joined',
      'Contacted→MQL Rate', 'Contacted→MQL Num', 'Contacted→MQL Denom',
      'MQL→SQL Rate', 'MQL→SQL Num', 'MQL→SQL Denom',
      'SQL→SQO Rate', 'SQL→SQO Num', 'SQL→SQO Denom',
      'SQO→Joined Rate', 'SQO→Joined Num', 'SQO→Joined Denom',
    ];

    const rows = trends.map(t => [
      t.period,
      t.sqls,
      t.sqos,
      t.joined,
      t.contactedToMqlRate ? `${(t.contactedToMqlRate * 100).toFixed(1)}%` : 'N/A',
      t.contactedToMqlNumerator || 0,
      t.contactedToMqlDenominator || 0,
      t.mqlToSqlRate ? `${(t.mqlToSqlRate * 100).toFixed(1)}%` : 'N/A',
      t.mqlToSqlNumerator || 0,
      t.mqlToSqlDenominator || 0,
      t.sqlToSqoRate ? `${(t.sqlToSqoRate * 100).toFixed(1)}%` : 'N/A',
      t.sqlToSqoNumerator || 0,
      t.sqlToSqoDenominator || 0,
      t.sqoToJoinedRate ? `${(t.sqoToJoinedRate * 100).toFixed(1)}%` : 'N/A',
      t.sqoToJoinedNumerator || 0,
      t.sqoToJoinedDenominator || 0,
    ]);

    const values = [headers, ...rows];

    await this.sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'Trend Data!A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values },
    });
  }

  /**
   * Populate the Detail Records sheet
   */
  private async populateDetailRecordsSheet(spreadsheetId: string, records: ExportDetailRecord[]): Promise<void> {
    const headers = [
      'Lead ID', 'Contact ID', 'Opportunity ID', 'Advisor Name', 'Salesforce URL',
      'Original Source', 'Channel', 'SGA', 'SGM', 'Stage', 'AUM',
      'FilterDate', 'Contacted Date', 'MQL Date', 'SQL Date', 'SQO Date', 'Joined Date',
      'Is Contacted', 'Is MQL', 'Is SQL', 'Is SQO', 'Is Joined',
      'Contacted→MQL', 'MQL→SQL', 'SQL→SQO', 'SQO→Joined',
      'Elig. Contacted', 'Elig. MQL', 'Elig. SQL', 'Elig. SQO',
      'Is SQO Unique', 'Is Joined Unique', 'Record Type',
    ];

    const rows = records.map(r => [
      r.leadId || '',
      r.contactId || '',
      r.opportunityId || '',
      r.advisorName,
      r.salesforceUrl || '',
      r.originalSource || '',
      r.channel || '',
      r.sga || '',
      r.sgm || '',
      r.stageName || '',
      r.aum,
      r.filterDate || '',
      r.contactedDate || '',
      r.mqlDate || '',
      r.sqlDate || '',
      r.sqoDate || '',
      r.joinedDate || '',
      r.isContacted ? 'YES' : 'NO',
      r.isMql ? 'YES' : 'NO',
      r.isSql ? 'YES' : 'NO',
      r.isSqo ? 'YES' : 'NO',
      r.isJoined ? 'YES' : 'NO',
      r.contactedToMqlProgression ? 'YES' : 'NO',
      r.mqlToSqlProgression ? 'YES' : 'NO',
      r.sqlToSqoProgression ? 'YES' : 'NO',
      r.sqoToJoinedProgression ? 'YES' : 'NO',
      r.eligibleForContactedConversions ? 'YES' : 'NO',
      r.eligibleForMqlConversions ? 'YES' : 'NO',
      r.eligibleForSqlConversions ? 'YES' : 'NO',
      r.eligibleForSqoConversions ? 'YES' : 'NO',
      r.isSqoUnique ? 'YES' : 'NO',
      r.isJoinedUnique ? 'YES' : 'NO',
      r.recordTypeName,
    ]);

    const values = [headers, ...rows];

    // Handle large datasets by chunking
    await this.writeInChunks(spreadsheetId, 'Detail Records', values);
  }

  /**
   * Write data in chunks to avoid API limits
   */
  private async writeInChunks(
    spreadsheetId: string, 
    sheetName: string, 
    values: any[][], 
    chunkSize: number = 1000
  ): Promise<void> {
    for (let i = 0; i < values.length; i += chunkSize) {
      const chunk = values.slice(i, i + chunkSize);
      const startRow = i + 1;
      
      await this.sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${sheetName}'!A${startRow}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: chunk },
      });

      // Add small delay to avoid rate limits
      if (i + chunkSize < values.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  }

  /**
   * Populate the Conversion Analysis sheet
   */
  private async populateConversionAnalysisSheet(
    spreadsheetId: string, 
    analysis: SheetsExportData['conversionAnalysis']
  ): Promise<void> {
    const sections: any[][] = [];

    // Contacted → MQL Section
    sections.push(['CONTACTED → MQL ANALYSIS']);
    sections.push(['Advisor Name', 'Salesforce URL', 'Contacted Date', 'MQL Date', 'In Numerator', 'In Denominator', 'Notes']);
    analysis.contactedToMql.forEach(r => {
      sections.push([
        r.advisorName,
        r.salesforceUrl || '',
        r.fromDate || '',
        r.toDate || '',
        r.inNumerator ? 'YES' : 'NO',
        r.inDenominator ? 'YES' : 'NO',
        r.notes,
      ]);
    });
    sections.push(['']); // Empty row separator

    // MQL → SQL Section
    sections.push(['MQL → SQL ANALYSIS']);
    sections.push(['Advisor Name', 'Salesforce URL', 'MQL Date', 'SQL Date', 'In Numerator', 'In Denominator', 'Notes']);
    analysis.mqlToSql.forEach(r => {
      sections.push([
        r.advisorName,
        r.salesforceUrl || '',
        r.fromDate || '',
        r.toDate || '',
        r.inNumerator ? 'YES' : 'NO',
        r.inDenominator ? 'YES' : 'NO',
        r.notes,
      ]);
    });
    sections.push(['']);

    // SQL → SQO Section
    sections.push(['SQL → SQO ANALYSIS']);
    sections.push(['Advisor Name', 'Salesforce URL', 'SQL Date', 'SQO Date', 'In Numerator', 'In Denominator', 'Notes']);
    analysis.sqlToSqo.forEach(r => {
      sections.push([
        r.advisorName,
        r.salesforceUrl || '',
        r.fromDate || '',
        r.toDate || '',
        r.inNumerator ? 'YES' : 'NO',
        r.inDenominator ? 'YES' : 'NO',
        r.notes,
      ]);
    });
    sections.push(['']);

    // SQO → Joined Section
    sections.push(['SQO → JOINED ANALYSIS']);
    sections.push(['Advisor Name', 'Salesforce URL', 'SQO Date', 'Joined Date', 'In Numerator', 'In Denominator', 'Notes']);
    analysis.sqoToJoined.forEach(r => {
      sections.push([
        r.advisorName,
        r.salesforceUrl || '',
        r.fromDate || '',
        r.toDate || '',
        r.inNumerator ? 'YES' : 'NO',
        r.inDenominator ? 'YES' : 'NO',
        r.notes,
      ]);
    });

    await this.sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'Conversion Analysis!A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: sections },
    });
  }

  /**
   * Populate the Validation sheet
   */
  private async populateValidationSheet(spreadsheetId: string, data: SheetsExportData): Promise<void> {
    const values = [
      ['CONVERSION RATE VALIDATION'],
      ['This sheet validates dashboard calculations match record-level data'],
      [''],
      ['Metric', 'Dashboard Value', 'From Detail Records', 'Match?'],
      [
        'Contacted → MQL',
        `${(data.conversionRates.contactedToMql.rate * 100).toFixed(1)}%`,
        `=IFERROR(COUNTIF('Detail Records'!W:W,"YES")/COUNTIF('Detail Records'!AA:AA,"YES")*100,0)&"%"`,
        `=IF(ABS(VALUE(SUBSTITUTE(B5,"%",""))-VALUE(SUBSTITUTE(C5,"%","")))<0.5,"✓","✗")`,
      ],
      [
        'MQL → SQL',
        `${(data.conversionRates.mqlToSql.rate * 100).toFixed(1)}%`,
        `=IFERROR(COUNTIF('Detail Records'!X:X,"YES")/COUNTIF('Detail Records'!AB:AB,"YES")*100,0)&"%"`,
        `=IF(ABS(VALUE(SUBSTITUTE(B6,"%",""))-VALUE(SUBSTITUTE(C6,"%","")))<0.5,"✓","✗")`,
      ],
      [
        'SQL → SQO',
        `${(data.conversionRates.sqlToSqo.rate * 100).toFixed(1)}%`,
        `=IFERROR(COUNTIF('Detail Records'!Y:Y,"YES")/COUNTIF('Detail Records'!AC:AC,"YES")*100,0)&"%"`,
        `=IF(ABS(VALUE(SUBSTITUTE(B7,"%",""))-VALUE(SUBSTITUTE(C7,"%","")))<0.5,"✓","✗")`,
      ],
      [
        'SQO → Joined',
        `${(data.conversionRates.sqoToJoined.rate * 100).toFixed(1)}%`,
        `=IFERROR(COUNTIF('Detail Records'!Z:Z,"YES")/COUNTIF('Detail Records'!AD:AD,"YES")*100,0)&"%"`,
        `=IF(ABS(VALUE(SUBSTITUTE(B8,"%",""))-VALUE(SUBSTITUTE(C8,"%","")))<0.5,"✓","✗")`,
      ],
      [''],
      ['VOLUME VALIDATION'],
      ['Metric', 'Dashboard Value', 'From Detail Records', 'Match?'],
      [
        'SQLs',
        data.metrics.sqls,
        `=COUNTIF('Detail Records'!T:T,"YES")`,
        `=IF(B12=C12,"✓","✗")`,
      ],
      [
        'SQOs',
        data.metrics.sqos,
        `=COUNTIF('Detail Records'!U:U,"YES")`,
        `=IF(B13=C13,"✓","✗")`,
      ],
      [
        'Joined',
        data.metrics.joined,
        `=COUNTIF('Detail Records'!V:V,"YES")`,
        `=IF(B14=C14,"✓","✗")`,
      ],
    ];

    await this.sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'Validation!A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values },
    });
  }

  /**
   * Format filters for display
   */
  private formatFiltersApplied(filters: SheetsExportData['filtersApplied']): string {
    const parts: string[] = [];
    if (filters.channel) parts.push(`Channel: ${filters.channel}`);
    if (filters.source) parts.push(`Source: ${filters.source}`);
    if (filters.sga) parts.push(`SGA: ${filters.sga}`);
    if (filters.sgm) parts.push(`SGM: ${filters.sgm}`);
    return parts.length > 0 ? parts.join(', ') : 'None';
  }

  /**
   * Format currency values
   */
  private formatCurrency(value: number): string {
    if (value >= 1_000_000_000) {
      return `$${(value / 1_000_000_000).toFixed(1)}B`;
    } else if (value >= 1_000_000) {
      return `$${(value / 1_000_000).toFixed(1)}M`;
    } else if (value >= 1_000) {
      return `$${(value / 1_000).toFixed(1)}K`;
    }
    return `$${value.toFixed(0)}`;
  }
}
```

### ✅ VERIFICATION GATE 3

**Execute these checks:**

```bash
# 1. Verify file exists
test -f src/lib/sheets/google-sheets-exporter.ts && echo "✓ google-sheets-exporter.ts created" || echo "✗ File missing"

# 2. Run TypeScript compilation
npm run build 2>&1 | tee build-output-3.log

# 3. Check for errors in exporter
grep -i "google-sheets-exporter\|error TS" build-output-3.log && echo "⚠️  Check for errors" || echo "✓ No errors in exporter"

# 4. Verify imports resolve
grep -q "from 'googleapis'" src/lib/sheets/google-sheets-exporter.ts && echo "✓ googleapis import present" || echo "✗ Import missing"
```

**Expected Results:**
- ✓ google-sheets-exporter.ts created
- ✓ No TypeScript errors
- ✓ googleapis import present

**If errors exist, fix them before proceeding.**

---

## Phase 4: Create Export Query Functions

### Step 4.1: Create Export Records Query

**Create file: `src/lib/queries/export-records.ts`**

```typescript
import { runQuery } from '../bigquery';
import { ExportDetailRecord, ConversionAnalysisRecord } from '../sheets/sheets-types';
import { DashboardFilters } from '@/types/filters';
import { buildDateRangeFromFilters } from '../utils/date-helpers';
import { FULL_TABLE, RECRUITING_RECORD_TYPE, MAPPING_TABLE } from '@/config/constants';

/**
 * Get all detail records for export with full field set
 * This query retrieves ALL fields needed for conversion rate validation
 */
export async function getExportDetailRecords(
  filters: DashboardFilters,
  limit: number = 10000
): Promise<ExportDetailRecord[]> {
  const { startDate, endDate } = buildDateRangeFromFilters(filters);
  
  const conditions: string[] = [];
  const params: Record<string, any> = {
    startDate,
    endDate: endDate + ' 23:59:59',
    recruitingRecordType: RECRUITING_RECORD_TYPE,
    limit,
  };

  // Apply filters
  if (filters.channel) {
    conditions.push('COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, \'Other\') = @channel');
    params.channel = filters.channel;
  }
  if (filters.source) {
    conditions.push('v.Original_source = @source');
    params.source = filters.source;
  }
  if (filters.sga) {
    conditions.push('v.SGA_Owner_Name__c = @sga');
    params.sga = filters.sga;
  }
  if (filters.sgm) {
    conditions.push('v.SGM_Owner_Name__c = @sgm');
    params.sgm = filters.sgm;
  }

  // Date filter - include records that have any activity in the period
  conditions.push(`(
    (v.FilterDate >= TIMESTAMP(@startDate) AND v.FilterDate <= TIMESTAMP(@endDate))
    OR (v.stage_entered_contacting__c >= TIMESTAMP(@startDate) AND v.stage_entered_contacting__c <= TIMESTAMP(@endDate))
    OR (v.converted_date_raw >= TIMESTAMP(@startDate) AND v.converted_date_raw <= TIMESTAMP(@endDate))
    OR (v.Date_Became_SQO__c >= TIMESTAMP(@startDate) AND v.Date_Became_SQO__c <= TIMESTAMP(@endDate))
    OR (v.advisor_join_date__c >= TIMESTAMP(@startDate) AND v.advisor_join_date__c <= TIMESTAMP(@endDate))
  )`);

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const query = `
    SELECT
      -- Identifiers
      v.Full_prospect_id__c as lead_id,
      v.Full_Contact_ID__c as contact_id,
      v.Full_Opportunity_ID__c as opportunity_id,
      v.primary_key,
      
      -- Advisor Info
      v.advisor_name,
      v.salesforce_url,
      
      -- Attribution
      v.Original_source as original_source,
      COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other') as channel,
      v.SGA_Owner_Name__c as sga,
      v.SGM_Owner_Name__c as sgm,
      
      -- Stage Info
      v.StageName as stage_name,
      COALESCE(v.Underwritten_AUM__c, v.Amount, 0) as aum,
      
      -- Date Fields
      FORMAT_TIMESTAMP('%Y-%m-%d', v.FilterDate) as filter_date,
      FORMAT_TIMESTAMP('%Y-%m-%d', v.stage_entered_contacting__c) as contacted_date,
      FORMAT_TIMESTAMP('%Y-%m-%d', v.mql_stage_entered_ts) as mql_date,
      FORMAT_TIMESTAMP('%Y-%m-%d', v.converted_date_raw) as sql_date,
      FORMAT_TIMESTAMP('%Y-%m-%d', v.Date_Became_SQO__c) as sqo_date,
      FORMAT_TIMESTAMP('%Y-%m-%d', v.advisor_join_date__c) as joined_date,
      
      -- Stage Flags
      v.is_contacted,
      v.is_mql,
      v.is_sql,
      CASE WHEN LOWER(v.SQO_raw) = 'yes' THEN 1 ELSE 0 END as is_sqo,
      CASE WHEN v.advisor_join_date__c IS NOT NULL OR v.StageName = 'Joined' THEN 1 ELSE 0 END as is_joined,
      
      -- Progression Flags (Numerators)
      v.contacted_to_mql_progression,
      v.mql_to_sql_progression,
      v.sql_to_sqo_progression,
      v.sqo_to_joined_progression,
      
      -- Eligibility Flags (Denominators)
      v.eligible_for_contacted_conversions,
      v.eligible_for_mql_conversions,
      v.eligible_for_sql_conversions,
      v.eligible_for_sqo_conversions,
      
      -- Deduplication Flags
      v.is_sqo_unique,
      v.is_joined_unique,
      v.is_primary_opp_record,
      
      -- Record Type
      v.recordtypeid as record_type_id,
      CASE 
        WHEN v.recordtypeid = @recruitingRecordType THEN 'Recruiting'
        WHEN v.recordtypeid = '012VS000009VoxrYAC' THEN 'Re-Engagement'
        ELSE 'Unknown'
      END as record_type_name

    FROM \`${FULL_TABLE}\` v
    LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
    ${whereClause}
    ORDER BY v.FilterDate DESC
    LIMIT @limit
  `;

  interface RawExportRecord {
    lead_id: string | null;
    contact_id: string | null;
    opportunity_id: string | null;
    primary_key: string;
    advisor_name: string | null;
    salesforce_url: string | null;
    original_source: string | null;
    channel: string | null;
    sga: string | null;
    sgm: string | null;
    stage_name: string | null;
    aum: number | null;
    filter_date: string | null;
    contacted_date: string | null;
    mql_date: string | null;
    sql_date: string | null;
    sqo_date: string | null;
    joined_date: string | null;
    is_contacted: number;
    is_mql: number;
    is_sql: number;
    is_sqo: number;
    is_joined: number;
    contacted_to_mql_progression: number;
    mql_to_sql_progression: number;
    sql_to_sqo_progression: number;
    sqo_to_joined_progression: number;
    eligible_for_contacted_conversions: number;
    eligible_for_mql_conversions: number;
    eligible_for_sql_conversions: number;
    eligible_for_sqo_conversions: number;
    is_sqo_unique: number;
    is_joined_unique: number;
    is_primary_opp_record: number;
    record_type_id: string | null;
    record_type_name: string;
  }

  const results = await runQuery<RawExportRecord>(query, params);

  return results.map(r => ({
    leadId: r.lead_id,
    contactId: r.contact_id,
    opportunityId: r.opportunity_id,
    primaryKey: r.primary_key,
    advisorName: r.advisor_name || 'Unknown',
    salesforceUrl: r.salesforce_url,
    originalSource: r.original_source,
    channel: r.channel,
    sga: r.sga,
    sgm: r.sgm,
    stageName: r.stage_name,
    aum: Number(r.aum) || 0,
    aumFormatted: formatCurrency(Number(r.aum) || 0),
    filterDate: r.filter_date,
    contactedDate: r.contacted_date,
    mqlDate: r.mql_date,
    sqlDate: r.sql_date,
    sqoDate: r.sqo_date,
    joinedDate: r.joined_date,
    isContacted: r.is_contacted,
    isMql: r.is_mql,
    isSql: r.is_sql,
    isSqo: r.is_sqo,
    isJoined: r.is_joined,
    contactedToMqlProgression: r.contacted_to_mql_progression,
    mqlToSqlProgression: r.mql_to_sql_progression,
    sqlToSqoProgression: r.sql_to_sqo_progression,
    sqoToJoinedProgression: r.sqo_to_joined_progression,
    eligibleForContactedConversions: r.eligible_for_contacted_conversions,
    eligibleForMqlConversions: r.eligible_for_mql_conversions,
    eligibleForSqlConversions: r.eligible_for_sql_conversions,
    eligibleForSqoConversions: r.eligible_for_sqo_conversions,
    isSqoUnique: r.is_sqo_unique,
    isJoinedUnique: r.is_joined_unique,
    isPrimaryOppRecord: r.is_primary_opp_record,
    recordTypeId: r.record_type_id,
    recordTypeName: r.record_type_name,
  }));
}

/**
 * Build conversion analysis from detail records
 */
export function buildConversionAnalysis(records: ExportDetailRecord[]): {
  contactedToMql: ConversionAnalysisRecord[];
  mqlToSql: ConversionAnalysisRecord[];
  sqlToSqo: ConversionAnalysisRecord[];
  sqoToJoined: ConversionAnalysisRecord[];
} {
  const contactedToMql: ConversionAnalysisRecord[] = [];
  const mqlToSql: ConversionAnalysisRecord[] = [];
  const sqlToSqo: ConversionAnalysisRecord[] = [];
  const sqoToJoined: ConversionAnalysisRecord[] = [];

  for (const r of records) {
    // Contacted → MQL analysis
    if (r.eligibleForContactedConversions || r.contactedToMqlProgression) {
      contactedToMql.push({
        advisorName: r.advisorName,
        salesforceUrl: r.salesforceUrl,
        fromDate: r.contactedDate,
        toDate: r.mqlDate,
        inNumerator: r.contactedToMqlProgression === 1,
        inDenominator: r.eligibleForContactedConversions === 1,
        notes: buildNotes('Contacted→MQL', r),
      });
    }

    // MQL → SQL analysis
    if (r.eligibleForMqlConversions || r.mqlToSqlProgression) {
      mqlToSql.push({
        advisorName: r.advisorName,
        salesforceUrl: r.salesforceUrl,
        fromDate: r.mqlDate,
        toDate: r.sqlDate,
        inNumerator: r.mqlToSqlProgression === 1,
        inDenominator: r.eligibleForMqlConversions === 1,
        notes: buildNotes('MQL→SQL', r),
      });
    }

    // SQL → SQO analysis
    if (r.eligibleForSqlConversions || r.sqlToSqoProgression) {
      sqlToSqo.push({
        advisorName: r.advisorName,
        salesforceUrl: r.salesforceUrl,
        fromDate: r.sqlDate,
        toDate: r.sqoDate,
        inNumerator: r.sqlToSqoProgression === 1,
        inDenominator: r.eligibleForSqlConversions === 1,
        notes: buildNotes('SQL→SQO', r),
      });
    }

    // SQO → Joined analysis
    if (r.eligibleForSqoConversions || r.sqoToJoinedProgression) {
      sqoToJoined.push({
        advisorName: r.advisorName,
        salesforceUrl: r.salesforceUrl,
        fromDate: r.sqoDate,
        toDate: r.joinedDate,
        inNumerator: r.sqoToJoinedProgression === 1,
        inDenominator: r.eligibleForSqoConversions === 1,
        notes: buildNotes('SQO→Joined', r),
      });
    }
  }

  return { contactedToMql, mqlToSql, sqlToSqo, sqoToJoined };
}

function buildNotes(conversionType: string, record: ExportDetailRecord): string {
  const notes: string[] = [];
  
  if (record.stageName) {
    notes.push(`Stage: ${record.stageName}`);
  }
  
  if (record.isSqoUnique === 0 && conversionType.includes('SQO')) {
    notes.push('Duplicate SQO (not counted)');
  }
  
  if (record.isJoinedUnique === 0 && conversionType.includes('Joined')) {
    notes.push('Duplicate Joined (not counted)');
  }
  
  return notes.join('; ');
}

function formatCurrency(value: number): string {
  if (value >= 1_000_000_000) {
    return `$${(value / 1_000_000_000).toFixed(1)}B`;
  } else if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`;
  } else if (value >= 1_000) {
    return `$${(value / 1_000).toFixed(1)}K`;
  }
  return `$${value.toFixed(0)}`;
}
```

### ✅ VERIFICATION GATE 4

**Execute these checks:**

```bash
# 1. Verify file exists
test -f src/lib/queries/export-records.ts && echo "✓ export-records.ts created" || echo "✗ File missing"

# 2. Run TypeScript compilation
npm run build 2>&1 | tee build-output-4.log

# 3. Check for errors
grep -i "export-records\|error TS" build-output-4.log && echo "⚠️  Check for errors" || echo "✓ No errors"

# 4. Verify parameterized queries (security check)
grep -q "@startDate\|@endDate\|@channel\|@source" src/lib/queries/export-records.ts && echo "✓ Using parameterized queries" || echo "✗ NOT using parameterized queries - SECURITY ISSUE!"
```

**Expected Results:**
- ✓ export-records.ts created
- ✓ No TypeScript errors
- ✓ Using parameterized queries

**If errors exist or parameterized queries are missing, fix them before proceeding.**

---

## Phase 5: Create API Route

### Step 5.1: Create the Export API Route

**Create file: `src/app/api/dashboard/export-sheets/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/permissions';
import { DashboardFilters } from '@/types/filters';
import { GoogleSheetsExporter } from '@/lib/sheets/google-sheets-exporter';
import { SheetsExportData } from '@/lib/sheets/sheets-types';
import { getExportDetailRecords, buildConversionAnalysis } from '@/lib/queries/export-records';
import { getConversionRates } from '@/lib/queries/conversion-rates';
import { getConversionTrends } from '@/lib/queries/conversion-rates';
import { getFunnelMetrics } from '@/lib/queries/funnel-metrics';
import { buildDateRangeFromFilters } from '@/lib/utils/date-helpers';

export const maxDuration = 60; // Allow up to 60 seconds for export

export async function POST(request: NextRequest) {
  try {
    // Step 1: Authenticate
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Step 2: Parse request and apply permission filters
    const body = await request.json();
    const filters: DashboardFilters = body.filters;
    const maxRecords = body.maxRecords || 10000;

    const permissions = await getUserPermissions(session.user.email);
    
    // Check export permission
    if (!permissions.canExport) {
      return NextResponse.json(
        { error: 'You do not have permission to export data' }, 
        { status: 403 }
      );
    }

    // Apply permission-based filters
    if (permissions.sgaFilter) {
      filters.sga = permissions.sgaFilter;
    }
    if (permissions.sgmFilter) {
      filters.sgm = permissions.sgmFilter;
    }

    // Step 3: Fetch all data in parallel
    const { startDate, endDate } = buildDateRangeFromFilters(filters);
    
    console.log(`[Export] Starting export for ${session.user.email}`, {
      dateRange: `${startDate} to ${endDate}`,
      filters: { channel: filters.channel, source: filters.source, sga: filters.sga, sgm: filters.sgm },
    });

    const [
      metricsResult,
      ratesResult,
      trendsResult,
      detailRecords,
    ] = await Promise.all([
      getFunnelMetrics(filters),
      getConversionRates(filters, 'period'), // Use period mode for export
      getConversionTrends(filters, 'month'), // Get monthly trends
      getExportDetailRecords(filters, maxRecords),
    ]);

    console.log(`[Export] Data fetched: ${detailRecords.length} records`);

    // Step 4: Build conversion analysis from detail records
    const conversionAnalysis = buildConversionAnalysis(detailRecords);

    // Step 5: Prepare export data package
    const exportData: SheetsExportData = {
      exportDate: new Date().toISOString(),
      exportedBy: session.user.email,
      dateRange: {
        start: startDate,
        end: endDate,
        preset: filters.datePreset,
      },
      filtersApplied: {
        channel: filters.channel,
        source: filters.source,
        sga: filters.sga,
        sgm: filters.sgm,
      },
      metrics: metricsResult,
      conversionRates: ratesResult.rates,
      trends: trendsResult,
      detailRecords,
      conversionAnalysis,
    };

    // Step 6: Export to Google Sheets
    console.log(`[Export] Creating Google Sheet...`);
    const exporter = new GoogleSheetsExporter();
    const result = await exporter.exportToSheets(exportData);

    if (!result.success) {
      console.error(`[Export] Failed:`, result.error);
      return NextResponse.json(
        { error: result.error || 'Export failed' },
        { status: 500 }
      );
    }

    console.log(`[Export] Success: ${result.spreadsheetUrl}`);

    return NextResponse.json({
      success: true,
      spreadsheetId: result.spreadsheetId,
      spreadsheetUrl: result.spreadsheetUrl,
    });

  } catch (error) {
    console.error('[Export] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Export failed' },
      { status: 500 }
    );
  }
}
```

### ✅ VERIFICATION GATE 5

**Execute these checks:**

```bash
# 1. Verify file exists
test -f src/app/api/dashboard/export-sheets/route.ts && echo "✓ route.ts created" || echo "✗ File missing"

# 2. Run TypeScript compilation
npm run build 2>&1 | tee build-output-5.log

# 3. Check for errors
grep -i "export-sheets\|error TS" build-output-5.log && echo "⚠️  Check for errors" || echo "✓ No errors"

# 4. Verify auth is used
grep -q "getServerSession" src/app/api/dashboard/export-sheets/route.ts && echo "✓ Authentication present" || echo "✗ Authentication missing!"
```

**Expected Results:**
- ✓ route.ts created
- ✓ No TypeScript errors
- ✓ Authentication present

**If errors exist, fix them before proceeding.**

---

## Phase 6: Create Export Button Component

### Step 6.1: Create the Export Button

**Create file: `src/components/dashboard/ExportToSheetsButton.tsx`**

```typescript
'use client';

import { useState } from 'react';
import { Button } from '@tremor/react';
import { FileSpreadsheet, Loader2, ExternalLink, AlertCircle } from 'lucide-react';
import { DashboardFilters } from '@/types/filters';

interface ExportToSheetsButtonProps {
  filters: DashboardFilters;
  disabled?: boolean;
  canExport?: boolean;
}

export function ExportToSheetsButton({ 
  filters, 
  disabled = false,
  canExport = true,
}: ExportToSheetsButtonProps) {
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [spreadsheetUrl, setSpreadsheetUrl] = useState<string | null>(null);

  const handleExport = async () => {
    setIsExporting(true);
    setError(null);
    setSpreadsheetUrl(null);

    try {
      const response = await fetch('/api/dashboard/export-sheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filters }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Export failed');
      }

      if (data.spreadsheetUrl) {
        setSpreadsheetUrl(data.spreadsheetUrl);
        // Open in new tab
        window.open(data.spreadsheetUrl, '_blank');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setIsExporting(false);
    }
  };

  if (!canExport) {
    return null;
  }

  return (
    <div className="relative">
      <Button
        icon={isExporting ? Loader2 : FileSpreadsheet}
        onClick={handleExport}
        disabled={disabled || isExporting}
        variant="secondary"
        className={isExporting ? 'animate-pulse' : ''}
      >
        {isExporting ? 'Exporting...' : 'Export to Sheets'}
      </Button>

      {error && (
        <div className="absolute top-full mt-2 right-0 z-10 bg-red-50 border border-red-200 rounded-lg p-3 shadow-lg max-w-xs">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-red-700">{error}</p>
              <button 
                onClick={() => setError(null)}
                className="text-xs text-red-500 hover:text-red-700 mt-1"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {spreadsheetUrl && !error && (
        <div className="absolute top-full mt-2 right-0 z-10 bg-green-50 border border-green-200 rounded-lg p-3 shadow-lg max-w-xs">
          <div className="flex items-start gap-2">
            <ExternalLink className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-green-700">Export complete!</p>
              <a 
                href={spreadsheetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-green-600 hover:text-green-800 underline"
              >
                Open spreadsheet
              </a>
              <button 
                onClick={() => setSpreadsheetUrl(null)}
                className="text-xs text-green-500 hover:text-green-700 ml-2"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

### Step 6.2: Add Button to Dashboard

**Update `src/app/dashboard/page.tsx`:**

Find the imports section (around line 1-30) and add:

```typescript
import { ExportToSheetsButton } from '@/components/dashboard/ExportToSheetsButton';
```

Find the GlobalFilters section (around line 211-218) and add the button after it:

```typescript
<FilterErrorBoundary>
  <GlobalFilters
    filters={filters}
    filterOptions={filterOptions}
    onFiltersChange={setFilters}
    onReset={handleFilterReset}
  />
</FilterErrorBoundary>

{/* Export Button */}
<div className="mb-6 flex justify-end">
  <ExportToSheetsButton 
    filters={filters} 
    disabled={loading}
    canExport={permissions?.canExport ?? false}
  />
</div>
```

### ✅ VERIFICATION GATE 6

**Execute these checks:**

```bash
# 1. Verify component file exists
test -f src/components/dashboard/ExportToSheetsButton.tsx && echo "✓ Component created" || echo "✗ Component missing"

# 2. Verify dashboard page updated
grep -q "ExportToSheetsButton" src/app/dashboard/page.tsx && echo "✓ Component imported in dashboard" || echo "✗ Component not imported"

# 3. Run TypeScript compilation
npm run build 2>&1 | tee build-output-6.log

# 4. Check for errors
grep -i "ExportToSheetsButton\|error TS" build-output-6.log && echo "⚠️  Check for errors" || echo "✓ No errors"
```

**Expected Results:**
- ✓ Component created
- ✓ Component imported in dashboard
- ✓ No TypeScript errors

**If errors exist, fix them before proceeding.**

---

## Phase 7: Integration & Testing

### Step 7.1: Verify TypeScript Compilation

```bash
npm run build
```

**Expected output:** No TypeScript errors

### Step 7.2: Verify Linting

```bash
npm run lint
```

**Expected output:** No linting errors (or only pre-existing ones)

### Step 7.3: Start Development Server

```bash
npm run dev
```

### Step 7.4: Manual Testing Checklist

Test in browser at `http://localhost:3000/dashboard`:

- [ ] Export button appears on dashboard for users with `canExport: true`
- [ ] Button does NOT appear for users without export permission
- [ ] Clicking button shows loading state ("Exporting...")
- [ ] Export completes and opens new tab with Google Sheet
- [ ] Google Sheet has all 5 tabs populated:
  - [ ] Summary tab shows correct filters and metrics
  - [ ] Trend Data tab matches dashboard chart data
  - [ ] Detail Records tab contains full record data
  - [ ] Conversion Analysis tab has breakdown by conversion type
  - [ ] Validation tab formulas calculate correctly
- [ ] Error states display when export fails (test by temporarily breaking credentials)

### Step 7.5: Test with Q4 2025 Values

Export with Q4 2025 filters and verify:

- [ ] SQLs: 193
- [ ] SQOs: 144
- [ ] Joined: 17
- [ ] Contacted→MQL: ~3.6%
- [ ] SQL→SQO: ~74.6%
- [ ] SQO→Joined: ~11.6%

### ✅ VERIFICATION GATE 7

**Execute these checks:**

```bash
# 1. Build passes
npm run build > /dev/null 2>&1 && echo "✓ Build successful" || echo "✗ Build failed"

# 2. Lint passes (or only pre-existing issues)
npm run lint 2>&1 | grep -i "error" && echo "⚠️  Check lint errors" || echo "✓ No new lint errors"
```

**Expected Results:**
- ✓ Build successful
- ✓ No new lint errors

**All manual tests should pass before proceeding to deployment.**

---

## Phase 8: Vercel Deployment

### Step 8.1: Prepare Credentials for Vercel

**Convert service account JSON to single line:**

**PowerShell:**
```powershell
$json = Get-Content ".json\sheets-service-account.json" -Raw
$json = $json -replace '\r?\n', '' -replace '\s+', ' '
$json | Set-Content "sheets-credentials-oneline.txt"
Write-Host "Credentials saved to sheets-credentials-oneline.txt"
Write-Host "Copy the contents and paste into Vercel environment variable"
```

**Bash (if using Git Bash):**
```bash
cat .json/sheets-service-account.json | jq -c . > sheets-credentials-oneline.txt
echo "Credentials saved to sheets-credentials-oneline.txt"
```

### Step 8.2: Set Environment Variables in Vercel

1. Go to your Vercel project: https://vercel.com/dashboard
2. Navigate to **Settings > Environment Variables**
3. Add the following variables:

**GOOGLE_SHEETS_TEMPLATE_ID**
```
143rmkaleDkDJGthNorETWtmYksj8XJGMrQ639LJwLGE
```

**GOOGLE_SHEETS_CREDENTIALS_JSON**

Copy the entire contents of `sheets-credentials-oneline.txt` (or the single-line JSON) and paste it as the value.

**⚠️ IMPORTANT:** 
- Do NOT add line breaks
- The entire JSON must be on one line
- Include all quotes and escape characters as-is

### Step 8.3: Create or Update vercel.json

**Create/update file: `vercel.json`**

```json
{
  "functions": {
    "src/app/api/dashboard/export-sheets/route.ts": {
      "maxDuration": 60
    }
  }
}
```

### Step 8.4: Verify vercel.json

```bash
# Verify file exists and is valid JSON
test -f vercel.json && echo "✓ vercel.json exists" || echo "✗ vercel.json missing"
cat vercel.json | jq . > /dev/null 2>&1 && echo "✓ vercel.json is valid JSON" || echo "✗ vercel.json is invalid JSON"
```

### Step 8.5: Deploy to Vercel

```bash
# Commit changes first
git add .
git commit -m "Add Google Sheets export feature"

# Deploy to production
vercel --prod
```

**OR** push to your main branch if you have automatic deployments configured.

### Step 8.6: Verify Deployment

After deployment completes:

1. **Check Environment Variables:**
   - Go to Vercel project settings
   - Verify both `GOOGLE_SHEETS_TEMPLATE_ID` and `GOOGLE_SHEETS_CREDENTIALS_JSON` are set
   - Ensure they're set for **Production** environment

2. **Test Export in Production:**
   - Navigate to your production dashboard
   - Click "Export to Sheets" button
   - Verify export completes successfully
   - Verify Google Sheet is created and shared with your email

3. **Check Vercel Function Logs:**
   - Go to Vercel dashboard > Your Project > Functions
   - Check logs for `/api/dashboard/export-sheets`
   - Look for any errors or warnings

### ✅ VERIFICATION GATE 8 (FINAL)

**Execute these checks:**

```bash
# 1. Verify vercel.json exists
test -f vercel.json && echo "✓ vercel.json configured" || echo "✗ vercel.json missing"

# 2. Verify environment variables are documented
echo "⚠️  MANUAL: Verify in Vercel dashboard:"
echo "   - GOOGLE_SHEETS_TEMPLATE_ID is set"
echo "   - GOOGLE_SHEETS_CREDENTIALS_JSON is set (single-line JSON)"
echo "   - Both are set for Production environment"

# 3. Verify deployment
echo "⚠️  MANUAL: After deployment, test export in production"
```

**Expected Results:**
- ✓ vercel.json configured
- ✓ Environment variables set in Vercel
- ✓ Production deployment successful
- ✓ Export works in production
- ✓ User receives shared Google Sheet
- ✓ All data validates correctly

---

## Troubleshooting Guide

### Error: "Service account cannot access template"

**Cause:** Template not shared with service account  
**Fix:** 
1. Open template sheet: https://docs.google.com/spreadsheets/d/143rmkaleDkDJGthNorETWtmYksj8XJGMrQ639LJwLGE
2. Click "Share" button
3. Add email: `sheet-436@savvy-pirate-extension.iam.gserviceaccount.com`
4. Set permission to "Editor"
5. Click "Send"

### Error: "403 Forbidden - cannot create spreadsheet"

**Cause:** Trying to create instead of copy, or service account lacks Drive permissions  
**Fix:** 
1. Verify using `drive.files.copy()` not `sheets.spreadsheets.create()`
2. Verify service account has Drive API enabled
3. Verify credentials JSON includes Drive scope

### Error: "Rate limit exceeded"

**Cause:** Too many API requests in short time  
**Fix:** 
1. Increase delay in `writeInChunks()`: change `setTimeout(resolve, 100)` to `setTimeout(resolve, 200)`
2. Reduce batch size: change `chunkSize: number = 1000` to `chunkSize: number = 500`

### Error: "Spreadsheet not found after creation"

**Cause:** Race condition between copy and populate  
**Fix:** Already handled with 1-second delay after copy in `exportToSheets()`. If still occurs, increase delay to 2 seconds.

### Error: "Large Dataset Timeout"

**Cause:** Too many records to export in time limit  
**Fix:** 
1. Reduce `maxRecords` parameter in API call (default 10000)
2. Implement pagination for very large exports
3. Consider increasing Vercel function timeout (max 60s for Hobby, 300s for Pro)

### Error: "Invalid credentials: missing client_email or private_key"

**Cause:** Credentials JSON is malformed or incomplete  
**Fix:**
1. Verify `GOOGLE_SHEETS_CREDENTIALS_JSON` in Vercel is valid JSON
2. Ensure it's on a single line with no line breaks
3. Verify it includes `client_email` and `private_key` fields
4. Test locally first with file-based credentials

### Error: "Template sheet not found" (404)

**Cause:** Template ID is incorrect or template was deleted  
**Fix:**
1. Verify template ID: `143rmkaleDkDJGthNorETWtmYksj8XJGMrQ639LJwLGE`
2. Verify template exists and is accessible
3. Verify service account has access to template

---

## Rollback Instructions

If you need to rollback this feature:

1. **Remove the export button from dashboard:**
   ```bash
   # Remove import and component from src/app/dashboard/page.tsx
   ```

2. **Delete created files:**
   ```bash
   rm -rf src/lib/sheets
   rm src/lib/queries/export-records.ts
   rm -rf src/app/api/dashboard/export-sheets
   rm src/components/dashboard/ExportToSheetsButton.tsx
   ```

3. **Remove from package.json (optional - keep googleapis if used elsewhere):**
   ```bash
   npm uninstall googleapis
   ```

4. **Revert git commit:**
   ```bash
   git revert HEAD
   # or
   git reset --hard HEAD~1  # if you want to completely remove
   ```

---

## File Summary

### New Files Created

```
src/lib/sheets/
├── index.ts
├── sheets-types.ts
└── google-sheets-exporter.ts

src/lib/queries/
└── export-records.ts

src/app/api/dashboard/export-sheets/
└── route.ts

src/components/dashboard/
└── ExportToSheetsButton.tsx

vercel.json (new or updated)
```

### Files Modified

```
src/app/dashboard/page.tsx  (added ExportToSheetsButton import and component)
package.json                (added googleapis dependency)
```

### Already Configured (No Changes Needed)

```
.env                        (GOOGLE_SHEETS_TEMPLATE_ID and GOOGLE_SHEETS_SERVICE_ACCOUNT_PATH)
.json/sheets-service-account.json  (credentials file)
.gitignore                  (.json/ already ignored)
```

---

## Success Criteria

1. ✅ Users can click "Export to Sheets" button
2. ✅ Export respects current dashboard filters
3. ✅ Google Sheet opens in new tab immediately
4. ✅ Sheet contains 5 tabs with complete data
5. ✅ Validation tab confirms dashboard accuracy
6. ✅ Works in both development and production
7. ✅ Proper error handling for all edge cases
8. ✅ TypeScript compilation passes
9. ✅ No security vulnerabilities (parameterized queries)
10. ✅ Vercel deployment successful

---

## Next Steps After Implementation

1. **Monitor Production Usage:**
   - Check Vercel function logs for errors
   - Monitor Google Sheets API quota usage
   - Track export success rate

2. **Optimize if Needed:**
   - Add caching for frequently exported date ranges
   - Implement pagination for very large datasets
   - Add export history/audit log

3. **User Feedback:**
   - Gather feedback on export format
   - Consider adding export customization options
   - Add export scheduling if needed

---

**Implementation Complete!** 🎉

import { google, sheets_v4 } from 'googleapis';
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
 * Uses Google Apps Script web app to create files (runs as real user with quota)
 * Service account is still used for populating sheets with data
 */
export class GoogleSheetsExporter {
  private sheets: sheets_v4.Sheets;
  private webAppUrl: string;

  constructor() {
    const auth = this.getAuthClient();
    this.sheets = google.sheets({ version: 'v4', auth });
    this.webAppUrl = process.env.GOOGLE_SHEETS_WEBAPP_URL || '';
    
    if (!this.webAppUrl) {
      throw new Error('GOOGLE_SHEETS_WEBAPP_URL environment variable is required');
    }
  }

  /**
   * Get authenticated client - works for both local and Vercel
   */
  private getAuthClient() {
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

      // Note: Sharing is handled by the Apps Script web app

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
   * Copy the template spreadsheet using Google Apps Script web app
   * The web app runs as a real user (with quota) and handles:
   * - Copying the template
   * - Moving to exports folder
   * - Sharing with the requesting user
   */
  private async copyTemplate(data: SheetsExportData): Promise<{ id: string }> {
    const dateStr = new Date().toISOString().split('T')[0];
    const filterStr = this.buildFilterString(data);
    const title = `Savvy Dashboard Export - ${data.dateRange.start} to ${data.dateRange.end}${filterStr ? ` - ${filterStr}` : ''} - ${dateStr}`;

    console.log('[Export] Calling Apps Script to copy template...');
    
    try {
      const response = await fetch(this.webAppUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          userEmail: data.exportedBy,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Export] Apps Script HTTP error:', response.status, errorText);
        throw new Error(`Apps Script web app returned ${response.status}: ${errorText}`);
      }

      const result = await response.json();
      
      if (!result.success) {
        console.error('[Export] Apps Script error:', result.error);
        throw new Error(result.error || 'Failed to create spreadsheet');
      }

      if (!result.spreadsheetId) {
        throw new Error('Apps Script succeeded but no spreadsheet ID returned');
      }

      console.log('[Export] Spreadsheet created:', result.spreadsheetId);
      return { id: result.spreadsheetId };
    } catch (error: any) {
      console.error('[Export] Apps Script call failed:', error);
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Failed to create spreadsheet via Apps Script: ${error?.message || 'Unknown error'}`);
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
   * Note: This is now handled by the Apps Script web app, so this method is no longer used
   * Keeping for reference but it won't be called
   */
  private async shareWithUser(spreadsheetId: string, userEmail: string): Promise<void> {
    // Sharing is handled by Apps Script web app
    console.log(`[Export] Sharing handled by Apps Script for ${userEmail}`);
  }

  /**
   * Populate the Summary sheet
   */
  private async populateSummarySheet(spreadsheetId: string, data: SheetsExportData): Promise<void> {
    const modeLabel = data.mode === 'cohort' 
      ? 'Cohorted/Resolved (only includes records where conversion outcome is known)'
      : 'Period-Based (includes all activity in the period)';
    
    const values = [
      ['Export Date', data.exportDate],
      ['Exported By', data.exportedBy],
      ['Date Range', `${data.dateRange.start} to ${data.dateRange.end} (${data.dateRange.preset})`],
      ['Calculation Mode', modeLabel],
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
      (t as any).contactedToMqlNumerator || 0,
      (t as any).contactedToMqlDenominator || 0,
      t.mqlToSqlRate ? `${(t.mqlToSqlRate * 100).toFixed(1)}%` : 'N/A',
      (t as any).mqlToSqlNumerator || 0,
      (t as any).mqlToSqlDenominator || 0,
      t.sqlToSqoRate ? `${(t.sqlToSqoRate * 100).toFixed(1)}%` : 'N/A',
      (t as any).sqlToSqoNumerator || 0,
      (t as any).sqlToSqoDenominator || 0,
      t.sqoToJoinedRate ? `${(t.sqoToJoinedRate * 100).toFixed(1)}%` : 'N/A',
      (t as any).sqoToJoinedNumerator || 0,
      (t as any).sqoToJoinedDenominator || 0,
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

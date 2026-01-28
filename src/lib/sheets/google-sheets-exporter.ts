import { google, sheets_v4 } from 'googleapis';
import { 
  SheetsExportData, 
  SheetsExportResult, 
  ExportDetailRecord,
  ConversionAnalysisRecord 
} from './sheets-types';
import fs from 'fs';
import path from 'path';
import { logger } from '../logger';

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
      logger.error('Google Sheets export error', error);
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

    logger.debug('[Export] Calling Apps Script to copy template');
    
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
        logger.error('[Export] Apps Script HTTP error', new Error(errorText), { status: response.status });
        throw new Error(`Apps Script web app returned ${response.status}: ${errorText}`);
      }

      const result = await response.json();
      
      if (!result.success) {
        logger.error('[Export] Apps Script error', result.error);
        throw new Error(result.error || 'Failed to create spreadsheet');
      }

      if (!result.spreadsheetId) {
        throw new Error('Apps Script succeeded but no spreadsheet ID returned');
      }

      logger.info('[Export] Spreadsheet created', { spreadsheetId: result.spreadsheetId });
      return { id: result.spreadsheetId };
    } catch (error: any) {
      logger.error('[Export] Apps Script call failed', error);
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
    logger.debug('[Export] Sharing handled by Apps Script', { userEmail });
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
      ['Signed', data.metrics.signed],
      ['Signed AUM', this.formatCurrency(data.metrics.signedAum)],
      ['Joined', data.metrics.joined],
      ['Joined AUM', this.formatCurrency(data.metrics.joinedAum)],
      ['Pipeline AUM', this.formatCurrency(data.metrics.pipelineAum)],
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
      'Export Reason',  // Added: tracks which cohort(s) this record belongs to
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
      r.recordTypeName || '',
      r.exportReason || '',  // Added: export reason (e.g., 'contacted_in_period', 'sql_in_period', or comma-separated)
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
   * Formulas match the exact cohort/period logic used in the dashboard
   * 
   * For COHORT mode:
   * - Contacted → MQL: Count records where Contacted Date is in range AND eligible/progression flags match
   * - MQL → SQL: Count records where MQL Date is in range AND eligible/progression flags match
   * - SQL → SQO: Count records where SQL Date is in range AND eligible/progression flags match
   * - SQO → Joined: Count records where SQO Date is in range AND eligible/progression flags match
   * 
   * Column mapping:
   * M = Contacted Date, N = MQL Date, O = SQL Date, P = SQO Date, Q = Joined Date
   * W = Contacted→MQL progression, X = MQL→SQL progression, Y = SQL→SQO progression, Z = SQO→Joined progression
   * AA = Elig. Contacted, AB = Elig. MQL, AC = Elig. SQL, AD = Elig. SQO
   * T = Is SQL, U = Is SQO, V = Is Joined
   */
  private async populateValidationSheet(spreadsheetId: string, data: SheetsExportData): Promise<void> {
    const startDate = data.dateRange.start;
    const endDate = data.dateRange.end;
    const isCohortMode = data.mode === 'cohort';
    
    // Build COUNTIFS formulas with date range filtering
    // Format: COUNTIFS(dateCol, ">=startDate", dateCol, "<=endDate", dateCol, "<>", flagCol, "YES")
    
    // Contacted → MQL: Filter by Contacted Date (M) in range
    // Numerator: Contacted Date in range AND progression (W) = YES
    // Denominator: Contacted Date in range AND eligible (AA) = YES
    const contactedToMqlFormula = `=IFERROR(COUNTIFS('Detail Records'!M:M,">=${startDate}",'Detail Records'!M:M,"<=${endDate}",'Detail Records'!M:M,"<>",'Detail Records'!W:W,"YES")/COUNTIFS('Detail Records'!M:M,">=${startDate}",'Detail Records'!M:M,"<=${endDate}",'Detail Records'!M:M,"<>",'Detail Records'!AA:AA,"YES")*100,0)&"%"`;
    
    // MQL → SQL: Filter by MQL Date (N) in range
    // Numerator: MQL Date in range AND progression (X) = YES
    // Denominator: MQL Date in range AND eligible (AB) = YES
    const mqlToSqlFormula = `=IFERROR(COUNTIFS('Detail Records'!N:N,">=${startDate}",'Detail Records'!N:N,"<=${endDate}",'Detail Records'!N:N,"<>",'Detail Records'!X:X,"YES")/COUNTIFS('Detail Records'!N:N,">=${startDate}",'Detail Records'!N:N,"<=${endDate}",'Detail Records'!N:N,"<>",'Detail Records'!AB:AB,"YES")*100,0)&"%"`;
    
    // SQL → SQO: Filter by SQL Date (O) in range
    // Numerator: SQL Date in range AND progression (Y) = YES
    // Denominator: SQL Date in range AND eligible (AC) = YES
    const sqlToSqoFormula = `=IFERROR(COUNTIFS('Detail Records'!O:O,">=${startDate}",'Detail Records'!O:O,"<=${endDate}",'Detail Records'!O:O,"<>",'Detail Records'!Y:Y,"YES")/COUNTIFS('Detail Records'!O:O,">=${startDate}",'Detail Records'!O:O,"<=${endDate}",'Detail Records'!O:O,"<>",'Detail Records'!AC:AC,"YES")*100,0)&"%"`;
    
    // SQO → Joined: Filter by SQO Date (P) in range
    // Numerator: SQO Date in range AND progression (Z) = YES
    // Denominator: SQO Date in range AND eligible (AD) = YES
    const sqoToJoinedFormula = `=IFERROR(COUNTIFS('Detail Records'!P:P,">=${startDate}",'Detail Records'!P:P,"<=${endDate}",'Detail Records'!P:P,"<>",'Detail Records'!Z:Z,"YES")/COUNTIFS('Detail Records'!P:P,">=${startDate}",'Detail Records'!P:P,"<=${endDate}",'Detail Records'!P:P,"<>",'Detail Records'!AD:AD,"YES")*100,0)&"%"`;

    // Volume validation: Filter by the correct date field and additional filters to match dashboard
    // SQLs: SQL Date (O) in range AND Is SQL (T) = YES
    // Note: SQLs don't require record type or unique flag in getFunnelMetrics
    const sqlsFormula = `=COUNTIFS('Detail Records'!O:O,">=${startDate}",'Detail Records'!O:O,"<=${endDate}",'Detail Records'!O:O,"<>",'Detail Records'!T:T,"YES")`;
    
    // SQOs: SQO Date (P) in range AND Is SQO (U) = YES AND Is SQO Unique (AE) = YES AND Record Type (AG) = "Recruiting"
    // Column mapping: AE = Is SQO Unique, AG = Record Type
    const sqosFormula = `=COUNTIFS('Detail Records'!P:P,">=${startDate}",'Detail Records'!P:P,"<=${endDate}",'Detail Records'!P:P,"<>",'Detail Records'!U:U,"YES",'Detail Records'!AE:AE,"YES",'Detail Records'!AG:AG,"Recruiting")`;
    
    // Joined: Joined Date (Q) in range AND Is Joined (V) = YES AND Is Joined Unique (AF) = YES
    // Column mapping: AF = Is Joined Unique
    const joinedFormula = `=COUNTIFS('Detail Records'!Q:Q,">=${startDate}",'Detail Records'!Q:Q,"<=${endDate}",'Detail Records'!Q:Q,"<>",'Detail Records'!V:V,"YES",'Detail Records'!AF:AF,"YES")`;

    // Helper function to create match formula that handles percentage strings safely
    // Compares dashboard value with validation value, accounting for rounding differences
    // First checks if numerators and denominators match (most reliable), then falls back to percentage comparison
    const createMatchFormula = (dashboardCell: string, validationCell: string, row: number, numCell: string, denCell: string, detailNumCell: string, detailDenCell: string) => {
      // If numerators and denominators match, it's definitely a match (same calculation, just rounding difference)
      // Use explicit IF statements for clarity
      // numCell/denCell are the dashboard numerator/denominator cells (columns G and H)
      // detailNumCell/detailDenCell are the detail records formula cells (columns E and F)
      // Check: if (num match AND den match) OR (percentage diff <= 0.1%) then ✓ else ✗
      return `=IF(AND(N(${numCell})=N(${detailNumCell}),N(${denCell})=N(${detailDenCell})),"✓",IFERROR(IF(ROUND(ABS(VALUE(SUBSTITUTE(${dashboardCell},"%",""))-VALUE(SUBSTITUTE(${validationCell},"%",""))),2)<=0.1,"✓","✗"),"✗"))`;
    };

    // Validation formulas for numerator and denominator counts
    // Contacted → MQL validation formulas
    const c2mDebug = {
      numerFormula: `=COUNTIFS('Detail Records'!M:M,">=${startDate}",'Detail Records'!M:M,"<=${endDate}",'Detail Records'!M:M,"<>",'Detail Records'!W:W,"YES")`,
      denomFormula: `=COUNTIFS('Detail Records'!M:M,">=${startDate}",'Detail Records'!M:M,"<=${endDate}",'Detail Records'!M:M,"<>",'Detail Records'!AA:AA,"YES")`,
    };

    // MQL → SQL validation formulas
    const m2sDebug = {
      numerFormula: `=COUNTIFS('Detail Records'!N:N,">=${startDate}",'Detail Records'!N:N,"<=${endDate}",'Detail Records'!N:N,"<>",'Detail Records'!X:X,"YES")`,
      denomFormula: `=COUNTIFS('Detail Records'!N:N,">=${startDate}",'Detail Records'!N:N,"<=${endDate}",'Detail Records'!N:N,"<>",'Detail Records'!AB:AB,"YES")`,
    };

    // SQL → SQO validation formulas
    const s2sqDebug = {
      numerFormula: `=COUNTIFS('Detail Records'!O:O,">=${startDate}",'Detail Records'!O:O,"<=${endDate}",'Detail Records'!O:O,"<>",'Detail Records'!Y:Y,"YES")`,
      denomFormula: `=COUNTIFS('Detail Records'!O:O,">=${startDate}",'Detail Records'!O:O,"<=${endDate}",'Detail Records'!O:O,"<>",'Detail Records'!AC:AC,"YES")`,
    };

    // SQO → Joined validation formulas
    const sq2jDebug = {
      numerFormula: `=COUNTIFS('Detail Records'!P:P,">=${startDate}",'Detail Records'!P:P,"<=${endDate}",'Detail Records'!P:P,"<>",'Detail Records'!Z:Z,"YES")`,
      denomFormula: `=COUNTIFS('Detail Records'!P:P,">=${startDate}",'Detail Records'!P:P,"<=${endDate}",'Detail Records'!P:P,"<>",'Detail Records'!AD:AD,"YES")`,
    };

    const values = [
      ['CONVERSION RATE VALIDATION'],
      ['This sheet validates dashboard calculations match record-level data'],
      [`Mode: ${isCohortMode ? 'Cohort (Resolved-only)' : 'Period (Activity-based)'}`],
      ['Date Range:', `${startDate} to ${endDate}`],
      [''],
      ['Metric', 'Dashboard Value', 'From Detail Records', 'Match?', 'Detail Num Formula', 'Detail Den Formula', 'Dashboard Num', 'Dashboard Den'],
      [
        'Contacted → MQL',
        `${(data.conversionRates.contactedToMql.rate * 100).toFixed(2)}%`,
        contactedToMqlFormula,
        createMatchFormula('B6', 'C6', 6, 'G6', 'H6', 'E6', 'F6'),
        c2mDebug.numerFormula,
        c2mDebug.denomFormula,
        data.conversionRates.contactedToMql.numerator,
        data.conversionRates.contactedToMql.denominator,
      ],
      [
        'MQL → SQL',
        `${(data.conversionRates.mqlToSql.rate * 100).toFixed(2)}%`,
        mqlToSqlFormula,
        createMatchFormula('B7', 'C7', 7, 'G7', 'H7', 'E7', 'F7'),
        m2sDebug.numerFormula,
        m2sDebug.denomFormula,
        data.conversionRates.mqlToSql.numerator,
        data.conversionRates.mqlToSql.denominator,
      ],
      [
        'SQL → SQO',
        `${(data.conversionRates.sqlToSqo.rate * 100).toFixed(2)}%`,
        sqlToSqoFormula,
        createMatchFormula('B8', 'C8', 8, 'G8', 'H8', 'E8', 'F8'),
        s2sqDebug.numerFormula,
        s2sqDebug.denomFormula,
        data.conversionRates.sqlToSqo.numerator,
        data.conversionRates.sqlToSqo.denominator,
      ],
      [
        'SQO → Joined',
        `${(data.conversionRates.sqoToJoined.rate * 100).toFixed(2)}%`,
        sqoToJoinedFormula,
        createMatchFormula('B9', 'C9', 9, 'G9', 'H9', 'E9', 'F9'),
        sq2jDebug.numerFormula,
        sq2jDebug.denomFormula,
        data.conversionRates.sqoToJoined.numerator,
        data.conversionRates.sqoToJoined.denominator,
      ],
      [''],
      ['VOLUME VALIDATION'],
      ['Metric', 'Dashboard Value', 'From Detail Records', 'Match?'],
      [
        'SQLs',
        data.metrics.sqls,
        sqlsFormula,
        `=IF(OR(ISBLANK(B14),ISBLANK(C14)),"",IF(B14=C14,"✓","✗"))`,
      ],
      [
        'SQOs',
        data.metrics.sqos,
        sqosFormula,
        `=IF(OR(ISBLANK(B15),ISBLANK(C15)),"",IF(B15=C15,"✓","✗"))`,
      ],
      [
        'Joined',
        data.metrics.joined,
        joinedFormula,
        `=IF(OR(ISBLANK(B16),ISBLANK(C16)),"",IF(B16=C16,"✓","✗"))`,
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

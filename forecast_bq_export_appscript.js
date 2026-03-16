/**
 * Google Apps Script — Extract Q2 Forecast into BQ Export Format
 *
 * REWRITTEN: Auto-detects sources from sheet structure instead of
 * hardcoding source names. Reads channel from Column A, detects
 * source headers vs metric rows vs rate rows automatically.
 *
 * To install: Extensions → Apps Script → paste this → save.
 * Run via menu: GTM Forecast Tools → Extract to BQ Format
 */

// ── Configuration ────────────────────────────────────────────────
const CONFIG = {
  outputSheetName: 'BQ_Export_Format',

  // Monthly value columns (1-indexed): H = April, J = May, L = June
  months: [
    { col: 8,  key: '2026-04' },   // Column H → April
    { col: 10, key: '2026-05' },   // Column J → May
    { col: 12, key: '2026-06' },   // Column L → June
  ],
};

// Metrics we care about → stage names for the BQ output
const METRIC_TO_STAGE = {
  'Created':                  'prospects',
  'Call Scheduled (MQL)':     'mql',
  'Opportunity Created (SQL)':'sql',
  'SQO':                      'sqo',
  'Joined':                   'joined',
};

// Known channels (column A values in the detail sections)
const KNOWN_CHANNELS = new Set([
  'Outbound',
  'Marketing',
  'Outbound + Marketing',
  'Re-Engagement',
  'Partnerships',
  'Advisor Referrals',   // note: sheet sometimes has trailing space
  'Other',
]);

// Column B values to skip — NOT source names and NOT extract metrics
const SKIP_KEYWORDS = [
  'Sources',            // header row
  'Cohorted View',      // section title
  'Forecast',           // section title like "Marketing Forecast - Organic"
  'rate',               // any conversion-rate row (covers → and > variants)
  'Contacted',          // intermediate stage we don't export
  'Start Date',
  'Quarter',
  'Year',
  'Actual',
  'Period',
  'Cohorted',
  'Q2 2025',            // historical header
  'Q2 2026',            // forecast header column
];

// These appear in the channel-level summary blocks (plural forms).
// They are NOT source names — skip them so we only parse the detail sections.
const SUMMARY_METRICS = new Set([
  'Prospects',
  'MQLs',
  'SQLs',
  'SQOs',
]);

// ── Menu ─────────────────────────────────────────────────────────
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('GTM Forecast Tools')
    .addItem('Extract to BQ Format', 'extractToBQFormat')
    .addToUi();
}

// ── Main ─────────────────────────────────────────────────────────
function extractToBQFormat() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sourceSheet = ss.getActiveSheet();
  var data = sourceSheet.getDataRange().getValues();

  var results = parseForecastData(data);

  // Write output
  var outputSheet = ss.getSheetByName(CONFIG.outputSheetName);
  if (!outputSheet) {
    outputSheet = ss.insertSheet(CONFIG.outputSheetName);
  } else {
    outputSheet.clear();
  }

  // Headers
  var headers = ['month_key', 'channel', 'metric', 'stage', 'original_source', 'forecast_value'];
  outputSheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  if (results.length > 0) {
    var outputData = results.map(function(r) {
      return [r.month_key, r.channel, r.metric, r.stage, r.original_source, r.forecast_value];
    });
    outputSheet.getRange(2, 1, outputData.length, headers.length).setValues(outputData);

    // Force month_key column to plain text so Sheets doesn't auto-convert to dates
    outputSheet.getRange(2, 1, outputData.length, 1).setNumberFormat('@');
  }

  outputSheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  outputSheet.autoResizeColumns(1, headers.length);

  // Summary alert
  var totalSQO = results
    .filter(function(r) { return r.stage === 'sqo'; })
    .reduce(function(sum, r) { return sum + r.forecast_value; }, 0);

  SpreadsheetApp.getUi().alert(
    '✅ Extracted ' + results.length + ' rows from "' + sourceSheet.getName() + '"\n' +
    'Total SQOs: ' + totalSQO.toFixed(2)
  );
}

// ── Parser ───────────────────────────────────────────────────────
function parseForecastData(data) {
  var agg = {};
  var currentChannel = null;
  var currentSource = null;
  var metricNames = Object.keys(METRIC_TO_STAGE);

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var colA = normalizeChannel(String(row[0] || '').trim());
    var colB = String(row[1] || '').trim();

    // ── Only process rows where Column A is a known channel ──
    // The summary section (rows 1-53) has empty Column A, so it's skipped.
    if (!colA || !KNOWN_CHANNELS.has(colA)) {
      // If both cols empty, reset source tracking
      if (!colA && !colB) {
        currentSource = null;
      }
      continue;
    }

    // Update channel from column A
    currentChannel = colA;

    // Row with channel in A but nothing in B → end of source block
    if (!colB) {
      currentSource = null;
      continue;
    }

    // Skip summary-level plural metrics (Prospects, MQLs, SQLs, SQOs)
    if (SUMMARY_METRICS.has(colB)) {
      continue;
    }

    // Skip rate rows, headers, intermediate stages
    if (shouldSkipRow(colB)) {
      continue;
    }

    // ── Is this a metric row we want to extract? ──
    if (metricNames.indexOf(colB) >= 0) {
      if (currentSource && currentChannel) {
        var stage = METRIC_TO_STAGE[colB];
        for (var m = 0; m < CONFIG.months.length; m++) {
          var month = CONFIG.months[m];
          var rawValue = row[month.col - 1];
          var value = parseNumeric(rawValue);

          var key = month.key + '|' + currentChannel + '|' + stage + '|' + currentSource;
          if (!agg[key]) {
            agg[key] = {
              month_key: month.key,
              channel: currentChannel,
              metric: 'Cohort_source',
              stage: stage,
              original_source: currentSource,
              forecast_value: 0,
            };
          }
          agg[key].forecast_value += value;
        }
      }
      continue;
    }

    // ── Must be a source name ──
    // It's in a channel row, not a metric, not a skip pattern → source header
    currentSource = colB;
  }

  // Convert to array and sort
  var results = Object.keys(agg).map(function(k) { return agg[k]; });

  results.sort(function(a, b) {
    if (a.month_key !== b.month_key) return a.month_key.localeCompare(b.month_key);
    if (a.channel !== b.channel) return a.channel.localeCompare(b.channel);
    if (a.original_source !== b.original_source) return a.original_source.localeCompare(b.original_source);
    var order = { prospects: 1, mql: 2, sql: 3, sqo: 4, joined: 5 };
    return (order[a.stage] || 99) - (order[b.stage] || 99);
  });

  return results;
}

// ── Helpers ───────────────────────────────────────────────────────

/** Normalize channel names (handle trailing spaces, "Coding" label, etc.) */
function normalizeChannel(raw) {
  var trimmed = raw.replace(/\s+$/, '');
  if (trimmed === 'Coding') return null;
  return trimmed || null;
}

/** Check if a column B value should be skipped */
function shouldSkipRow(colB) {
  if (!colB) return true;
  for (var i = 0; i < SKIP_KEYWORDS.length; i++) {
    if (colB.indexOf(SKIP_KEYWORDS[i]) >= 0) return true;
  }
  return false;
}

/** Parse a cell value to a number */
function parseNumeric(raw) {
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') {
    raw = raw.replace(/,/g, '').trim();
    if (!raw) return 0;
    var n = parseFloat(raw);
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

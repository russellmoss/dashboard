// src/lib/gc-hub/data-utils.ts

// ============================================================
// CHURNED / EXCLUDED ADVISORS
// Source: gc_dashboard_data_exploration.md Appendix B, Section 8.7
// ============================================================
export const EXCLUDED_ADVISORS = new Set([
  'nathan wallace',
  'nate wallace',
  'kevin may',
  'brad weber',
  'michael mccarthy',
  'mike mccarthy',
]);

// ============================================================
// EXCLUDED ENTRIES (not advisor records)
// Source: gc_dashboard_data_exploration.md Appendix G
// + system/entity rows from Revenue Estimates (e.g. Milestone Bonuses, December AUM Blitz)
// ============================================================
export const EXCLUDED_ENTRIES = new Set([
  'berkely arrants signing bonus',
  'uva checking',
  'uva checking (brex)',
  'uva checking (allocated from tyson)',
  'ek existing clients',
  'dp existing clients',
  'nw existing clients',
  'db existing clients',
  'mm existing clients',
  'nw savvy generated',
  // Not advisors — system/entity rows in Revenue Estimates workbook
  'milestone bonuses',
  'december aum blitz',
  // Entity-only rows (no individual advisor)
  'perspective 6',
  'cwg - december',
]);

// ============================================================
// SUB-ENTRY ROLL-UPS
// Source: gc_dashboard_data_exploration.md Appendix G
// Frank Malpigli → roll commission into Michael Most
// ============================================================
export const SUB_ENTRY_ROLLUPS: Record<string, string> = {
  'frank malpigli': 'Michael Most',
};

// ============================================================
// BARONE TEAM MEMBERS
// Source: gc_dashboard_data_exploration.md Section 8.6, Appendix H
// These members use ONLY CFO-provided data for Jan 2025 – Jan 2026.
// Do NOT use Payouts Tracker / Q3 / Q4 standalone data for these.
// ============================================================
export const BARONE_TEAM_MEMBERS = new Set([
  'josh barone',
  'joshua barone',
  'bob barone',
  'robert barone',
  'andrea nolan',
  'andrea knapp nolan',
  'michael lambrecht',
  'eugene hoover',
  'eugene (eddy) hoover',
]);

// ============================================================
// NAME NORMALIZATION TABLE
// Source: gc_dashboard_data_exploration.md Appendix G (complete table)
// Maps variant names → canonical name
// ============================================================
const NAME_NORMALIZATION: Record<string, string> = {
  // Nickname → Full name
  'drew martino': 'Andrew Martino',
  'dan perrino': 'Daniel Perrino',
  'daniel perrino': 'Daniel Perrino',
  'dan brady': 'Daniel Brady',
  'daniel brady': 'Daniel Brady',
  'nick mclaughlin': 'Jon McLaughlin',
  'ken boba': 'Kenneth Bobadilla',
  'ken bobadilla': 'Kenneth Bobadilla',
  'kenneth bobadilla': 'Kenneth Bobadilla',
  'steve marcou': 'Steve Marcou',
  'stephen marcou': 'Steve Marcou',
  'bob barone': 'Robert Barone',
  'robert barone': 'Robert Barone',
  'josh barone': 'Joshua Barone',
  'joshua barone': 'Joshua Barone',
  'andrea knapp nolan': 'Andrea Nolan',
  'andrea nolan': 'Andrea Nolan',
  'eugene (eddy) hoover': 'Eugene Hoover',
  'eugene hoover': 'Eugene Hoover',
  'matt benham': 'Matthew Benham',
  'matthew benham': 'Matthew Benham',
  'matt nelson': 'Matthew Nelson',
  'matthew nelson': 'Matthew Nelson',
  'matt finley': 'Matthew Finley',
  'matthew finley': 'Matthew Finley',
  'matt powell': 'Matt Powell',
  'matt conley': 'Matthew Conley',
  'matthew conley': 'Matthew Conley',
  'luis miletti jr': 'Luis Miletti',
  'ed wildermuth': 'Ed Wildermuth',
  'edward "ed" wildermuth': 'Ed Wildermuth',

  // Mike/Michael, Steve/Steven, Alex/Alexander variants
  'michael smith': 'Mike Smith',
  'mike smith': 'Mike Smith',
  'mike johnson': 'Michael Johnson',
  'michael johnson': 'Michael Johnson',
  'steven grogan': 'Steve Grogan',
  'steve grogan': 'Steve Grogan',
  'alexander austin': 'Alex Austin',
  'alex austin': 'Alex Austin',

  // Spelling variations
  'berkley arrants': 'Berkely Arrants',
  'berkely arrants': 'Berkely Arrants',
  'jacob dubose': 'Jacob DuBose',
  'jacob duBose': 'Jacob DuBose',
  'todd juengar': 'Todd Juenger',
  'todd juenger': 'Todd Juenger',
  'jon mclaughlin': 'Jon McLaughlin',
  'jacob larue': 'Jacob LaRue',
  'nate wallace': 'Nathan Wallace',
  'nathan wallace': 'Nathan Wallace',
  'nate kunkel': 'Nate Kunkel',
  'dan moore': 'Daniel Moore',
  'daniel moore': 'Daniel Moore',

  // Account/Team name variants
  'cindy alvarez and janelle van meel': 'Cindy Alvarez & Janelle Van Meel',
  'cindy alvarez & janelle van meel': 'Cindy Alvarez & Janelle Van Meel',

  // Entity aliases
  'p6': 'Perspective 6',

  // Credential suffixes handled by stripping below
  'dustin thomas, cpa, cfp®': 'Dustin Thomas',
  'dustin thomas': 'Dustin Thomas',
};

// ============================================================
// ENTITY PREFIX PATTERNS TO STRIP
// Source: gc_dashboard_data_exploration.md Appendix G
// ============================================================
const ENTITY_PREFIXES = [
  /^horizon\s*-\s*/i,
  /^mosaic\s*-\s*/i,           // "Mosaic - Ed Wildermuth" → "Ed Wildermuth"
  /^true\s+harvest\s*\(/i,     // "True Harvest (Derek Williams)" → "Derek Williams)"
  /^p6\s*-\s*/i,               // "P6 - Matt Nelson - Q4" → "Matt Nelson - Q4"
  /^perspective\s+6\s*\(/i,    // "Perspective 6 (Matt Nelson)" → "Matt Nelson)"
];

const ENTITY_SUFFIX_PATTERNS = [
  /\s*payout\s+q\d\s+\d{4}$/i,     // "Aaron Peloquin Payout Q3 2025"
  /\s+1099$/i,                       // "Josh Barone 1099"
  /,?\s*cpa.*/i,                     // "Dustin Thomas, CPA, CFP®"
  /,?\s*cfp.*/i,
  /\s*-\s*q[1-4]$/i,                 // "Anderson Wozny - Q4" → "Anderson Wozny"
  /\)\s*-\s*q[1-4]$/i,               // "True Harvest (Derek Williams) - Q4" after prefix strip leaves "Derek Williams) - Q4"
  /\)$/,                              // Trailing paren from "True Harvest (Derek Williams)" or "Perspective 6 (Matt Nelson)"
  /\s*\(allocated\s+from\s+[^)]+\)$/i, // "(allocated from Tyson)"
];

/**
 * Normalize an advisor name to its canonical form.
 * Handles: trimming, prefix stripping, suffix stripping, case normalization, lookup.
 */
export function normalizeAdvisorName(rawName: string): string {
  if (!rawName || typeof rawName !== 'string') return '';

  let name = rawName.trim();

  // Strip entity prefixes (e.g., "Horizon - Berkely Arrants" → "Berkely Arrants")
  for (const prefix of ENTITY_PREFIXES) {
    name = name.replace(prefix, '');
  }

  // Strip suffixes (e.g., "Aaron Peloquin Payout Q3 2025" → "Aaron Peloquin")
  for (const suffix of ENTITY_SUFFIX_PATTERNS) {
    name = name.replace(suffix, '');
  }

  name = name.trim();

  // Lookup in normalization table (case-insensitive)
  const lookupKey = name.toLowerCase();
  if (NAME_NORMALIZATION[lookupKey]) {
    return NAME_NORMALIZATION[lookupKey];
  }

  // If not in table, title-case the input
  // (preserves original casing for names not in the normalization table)
  return name;
}

/**
 * Check if an entry should be excluded from the ETL.
 */
export function shouldExcludeEntry(name: string): boolean {
  const lower = name.toLowerCase().trim();
  return EXCLUDED_ADVISORS.has(lower) || EXCLUDED_ENTRIES.has(lower);
}

/**
 * Check if a name is a sub-entry that should be rolled up into a parent.
 * Returns the parent canonical name, or null if not a sub-entry.
 */
export function getSubEntryParent(name: string): string | null {
  const lower = name.toLowerCase().trim();
  return SUB_ENTRY_ROLLUPS[lower] || null;
}

/**
 * Check if this advisor is a Barone team member.
 * Barone team uses CFO-provided data only for Jan 2025 – Jan 2026.
 */
export function isBaroneTeamMember(name: string): boolean {
  return BARONE_TEAM_MEMBERS.has(name.toLowerCase().trim());
}

// ============================================================
// CURRENCY PARSING
// Source: gc_dashboard_data_exploration.md Phase 7 (data cleansing rules)
// ============================================================

/**
 * Parse a currency value from Google Sheets.
 * Handles: "$1,234.56", "($25,000.02)" (negative), "#REF!", "n/a", "against draw", blanks.
 * Returns null for unparseable values (which the ETL should handle as "no data").
 */
export function parseCurrency(value: any): number | null {
  if (value === null || value === undefined || value === '') return null;

  // If already a number (UNFORMATTED_VALUE returns numbers directly)
  if (typeof value === 'number') {
    return isNaN(value) ? null : value;
  }

  const str = String(value).trim();

  // Handle error values
  if (str === '#REF!' || str === '#N/A' || str === '#VALUE!' || str === '#DIV/0!') return null;

  // Handle text values that aren't numbers
  if (/^(n\/a|against|against\s+(his\s+)?draw|-)$/i.test(str)) return null;

  // Handle parenthesized negatives: "($25,000.02)" → -25000.02
  if (str.startsWith('(') && str.endsWith(')')) {
    const inner = str.slice(1, -1).replace(/[$,]/g, '');
    const num = parseFloat(inner);
    return isNaN(num) ? null : -num;
  }

  // Standard currency: "$1,234.56" or "1234.56" or "-1234.56"
  const cleaned = str.replace(/[$,]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

// ============================================================
// PERIOD UTILITIES
// ============================================================

/**
 * Convert a period string to a Date representing the first day of that period.
 * "Q4 2022" → 2022-10-01, "Jan 2026" → 2026-01-01
 */
export function periodToStartDate(period: string): Date {
  const quarterMatch = period.match(/^Q(\d)\s+(\d{4})$/);
  if (quarterMatch) {
    const quarter = parseInt(quarterMatch[1]);
    const year = parseInt(quarterMatch[2]);
    const month = (quarter - 1) * 3; // Q1=0(Jan), Q2=3(Apr), Q3=6(Jul), Q4=9(Oct)
    return new Date(year, month, 1);
  }

  const monthMatch = period.match(/^(\w+)\s+(\d{4})$/);
  if (monthMatch) {
    const monthNames: Record<string, number> = {
      Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
      Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
    };
    const monthNum = monthNames[monthMatch[1]];
    const year = parseInt(monthMatch[2]);
    if (monthNum !== undefined) {
      return new Date(year, monthNum, 1);
    }
  }

  throw new Error(`Cannot parse period: "${period}"`);
}

/**
 * Get all quarterly period strings from Q4 2022 to Q4 2025.
 */
export function getHistoricalQuarterlyPeriods(): string[] {
  return [
    'Q4 2022', 'Q1 2023', 'Q2 2023', 'Q3 2023', 'Q4 2023',
    'Q1 2024', 'Q2 2024', 'Q3 2024', 'Q4 2024',
    'Q1 2025', 'Q2 2025', 'Q3 2025', 'Q4 2025',
  ];
}

/**
 * Convert monthly date components to a quarterly period (for aggregation).
 * month is 1-indexed (1=Jan, 12=Dec).
 */
export function monthToQuarter(year: number, month: number): string {
  const quarter = Math.ceil(month / 3);
  return `Q${quarter} ${year}`;
}

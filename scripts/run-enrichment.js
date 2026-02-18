/**
 * Merge sheet rows with BQ results: match on normalized LinkedIn (best), then fuzzy name, then fuzzy firm.
 * Outputs E-I: CRD, PRIMARY_FIRM_TOTAL_AUM, REP_AUM, PRODUCING_ADVISOR, match_type.
 * match_type: "linkedin + name + firm" | "linkedin + name" | "linkedin + firm" | "linkedin" | "name + firm" | "name" (never "firm" only)
 */
const fs = require('fs');
const path = require('path');

const SCRIPTS_DIR = __dirname;
const SHEET_ROWS = path.join(SCRIPTS_DIR, 'sheet-rows.json');

function normalizeFirm(firm) {
  if (!firm || typeof firm !== 'string') return '';
  return firm.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[,.]/g, '');
}

function normalizeName(name) {
  if (!name || typeof name !== 'string') return '';
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

// Fuzzy: exact match, or one contains the other (for first/last name and firm)
function nameMatches(sheetFirst, sheetLast, bqFirst, bqLast) {
  const sFirst = normalizeName(sheetFirst);
  const sLast = normalizeName(sheetLast);
  const bFirst = normalizeName(bqFirst);
  const bLast = normalizeName(bqLast);
  if (!sFirst && !sLast) return false;
  const firstOk = !sFirst || !bFirst || sFirst === bFirst || sFirst.includes(bFirst) || bFirst.includes(sFirst);
  const lastOk = !sLast || !bLast || sLast === bLast || sLast.includes(bLast) || bLast.includes(sLast);
  return firstOk && lastOk;
}

function firmMatches(sheetNormFirm, bqFirm) {
  if (!sheetNormFirm) return true;
  const bNorm = normalizeFirm(bqFirm || '');
  if (!bNorm) return false;
  return sheetNormFirm === bNorm || sheetNormFirm.includes(bNorm) || bNorm.includes(sheetNormFirm);
}

function mergeAndMatch() {
  const sheetData = JSON.parse(fs.readFileSync(SHEET_ROWS, 'utf8'));
  const rows = sheetData.rows;

  let bqRows = [];
  // Prefer chunk files (bq-result-0.json ... bq-result-4.json) when present
  let hasChunks = false;
  for (let i = 0; i < 5; i++) {
    const p = path.join(SCRIPTS_DIR, `bq-result-${i}.json`);
    if (fs.existsSync(p)) {
      hasChunks = true;
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      const arr = Array.isArray(data) ? data : (data.rows || data.results || [data]);
      bqRows = bqRows.concat(arr);
    }
  }
  if (!hasChunks) {
    const mergedPath = path.join(SCRIPTS_DIR, 'bq-results.json');
    if (fs.existsSync(mergedPath)) {
      const data = JSON.parse(fs.readFileSync(mergedPath, 'utf8'));
      bqRows = Array.isArray(data) ? data : (data.rows || data.results || [data]);
    }
  }

  const byNormUrl = new Map();
  for (const r of bqRows) {
    const url = (r.norm_url || r.NORM_URL || '').toLowerCase().trim();
    if (url && !byNormUrl.has(url)) byNormUrl.set(url, r);
  }

  const header = ['CRD', 'PRIMARY_FIRM_TOTAL_AUM', 'REP_AUM', 'PRODUCING_ADVISOR', 'match_type'];
  const values = [header];

  let matchedLinkedIn = 0, matchedNameOnly = 0, unmatched = 0;

  for (const row of rows) {
    const normUrl = (row.normUrl || '').toLowerCase().trim();
    const sheetFirst = row.firstName || '';
    const sheetLast = row.lastName || '';
    const sheetNormFirm = row.normFirm || normalizeFirm(row.firm || '');

    let r = null;
    let matchType = '';

    // 1) Try LinkedIn match first (best)
    if (normUrl && byNormUrl.has(normUrl)) {
      r = byNormUrl.get(normUrl);
      const nameMatch = nameMatches(sheetFirst, sheetLast, r.CONTACT_FIRST_NAME || '', r.CONTACT_LAST_NAME || '');
      const firmMatch = firmMatches(sheetNormFirm, r.PRIMARY_FIRM_NAME || '');
      if (nameMatch && firmMatch) matchType = 'linkedin + name + firm';
      else if (nameMatch) matchType = 'linkedin + name';
      else if (firmMatch) matchType = 'linkedin + firm';
      else matchType = 'linkedin';
      matchedLinkedIn++;
    } else {
      // 2) If no LinkedIn match: fuzzy match on name (and optionally firm). Never match on firm only.
      let best = null;
      let bestType = '';
      for (const bq of bqRows) {
        const nameMatch = nameMatches(sheetFirst, sheetLast, bq.CONTACT_FIRST_NAME || '', bq.CONTACT_LAST_NAME || '');
        if (!nameMatch) continue;
        const firmMatch = firmMatches(sheetNormFirm, bq.PRIMARY_FIRM_NAME || '');
        if (firmMatch) {
          best = bq;
          bestType = 'name + firm';
          break;
        }
        if (!best) {
          best = bq;
          bestType = 'name';
        }
      }
      if (best) {
        r = best;
        matchType = bestType;
        matchedNameOnly++;
      } else {
        unmatched++;
      }
    }

    const crd = r ? (r.RIA_CONTACT_CRD_ID ?? '') : '';
    const aum = r ? (r.PRIMARY_FIRM_TOTAL_AUM ?? '') : '';
    const repAum = r ? (r.REP_AUM ?? '') : '';
    const producing = r ? (r.PRODUCING_ADVISOR ?? '') : '';
    values.push([
      crd !== undefined && crd !== null ? String(crd) : '',
      aum !== undefined && aum !== null ? String(aum) : '',
      repAum !== undefined && repAum !== null ? String(repAum) : '',
      producing === true ? 'Yes' : producing === false ? 'No' : '',
      matchType,
    ]);
  }

  const outPath = path.join(SCRIPTS_DIR, 'enriched-eh.json');
  fs.writeFileSync(outPath, JSON.stringify({
    values,
    matchedLinkedIn,
    matchedNameOnly,
    unmatched,
  }), 'utf8');
  console.log('Wrote', outPath, '| LinkedIn:', matchedLinkedIn, 'name-only:', matchedNameOnly, 'unmatched:', unmatched);
  return values;
}

if (process.argv.includes('--merge')) {
  mergeAndMatch();
} else {
  console.log('Run: node run-enrichment.js --merge');
}

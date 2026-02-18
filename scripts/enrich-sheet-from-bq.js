/**
 * Parse sheet JSON and build normalized LinkedIn URLs + row metadata for BQ matching.
 * Usage: node scripts/enrich-sheet-from-bq.js <path-to-sheet-json>
 * Outputs JSON to stdout: { rows: [...], urlList: [...] }
 */
const fs = require('fs');
const path = process.argv[2] || require('path').join(__dirname, '../agent-tools/sheet-data.json');

function normalizeLinkedIn(url) {
  if (!url || typeof url !== 'string') return '';
  let u = url.trim().toLowerCase();
  u = u.replace(/\?.*$/, '').replace(/\/+$/, '');
  u = u.replace(/^https?:\/\/(www\.)?/, '');
  if (!u.startsWith('linkedin.com')) return '';
  return u;
}

function parseName(fullName) {
  if (!fullName || typeof fullName !== 'string') return { first: '', last: '' };
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: '' };
  return { first: parts[0], last: parts[parts.length - 1] };
}

function normalizeFirm(firm) {
  if (!firm || typeof firm !== 'string') return '';
  return firm.trim().toLowerCase().replace(/\s+/g, ' ');
}

const raw = fs.readFileSync(path, 'utf8');
const data = JSON.parse(raw);
const values = data.values || [];
const header = values[0];
const dataRows = values.slice(1);

const rows = [];
const urlSet = new Set();

for (let i = 0; i < dataRows.length; i++) {
  const r = dataRows[i];
  const firm = (r[0] ?? '').toString();
  const name = (r[1] ?? '').toString();
  const linkedin = (r[3] ?? '').toString();
  const normUrl = normalizeLinkedIn(linkedin);
  const { first: firstName, last: lastName } = parseName(name);
  rows.push({
    rowIndex: i + 2,
    firm,
    name,
    firstName,
    lastName,
    linkedin,
    normUrl,
    normFirm: normalizeFirm(firm),
  });
  if (normUrl) urlSet.add(normUrl);
}

const urlList = Array.from(urlSet);
const outPath = process.argv[3] || require('path').join(__dirname, 'sheet-rows.json');
fs.writeFileSync(outPath, JSON.stringify({ rows, urlList }), 'utf8');
console.log('Wrote', outPath, 'rows=', rows.length, 'urls=', urlList.length);
const j = require('./sheet-rows.json');
const esc = (s) => String(s).replace(/'/g, "''");
const chunkIndex = parseInt(process.argv[2] || '0', 10);
const size = 400;
const start = chunkIndex * size;
const chunk = j.urlList.slice(start, start + size).map(esc);
const inList = "ARRAY<STRING>['" + chunk.join("','") + "']";
const sql = `
SELECT norm_url, RIA_CONTACT_CRD_ID, CONTACT_FIRST_NAME, CONTACT_LAST_NAME, PRIMARY_FIRM_NAME, PRIMARY_FIRM_TOTAL_AUM, REP_AUM, PRODUCING_ADVISOR
FROM (
  SELECT
    LOWER(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(LINKEDIN_PROFILE_URL,''), r'^https?://(www\\.)?', ''), r'\\?.*$', ''), r'/$', '')) AS norm_url,
    RIA_CONTACT_CRD_ID, CONTACT_FIRST_NAME, CONTACT_LAST_NAME, PRIMARY_FIRM_NAME, PRIMARY_FIRM_TOTAL_AUM, REP_AUM, PRODUCING_ADVISOR
  FROM \`savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current\`
  WHERE LINKEDIN_PROFILE_URL IS NOT NULL
)
WHERE norm_url IN UNNEST(${inList})
`;
require('fs').writeFileSync(process.argv[3] || 'bq-query.sql', sql, 'utf8');
console.log('Wrote query for chunk', chunkIndex, 'rows', chunk.length);
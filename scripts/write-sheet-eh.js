/**
 * Read enriched-eh.json and output values in chunks for MCP sheets_update_values.
 * Usage: node write-sheet-eh.js
 * Outputs: chunk size and row ranges (actual write is done via MCP with the values).
 */
const fs = require('fs');
const path = require('path');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'enriched-eh.json'), 'utf8'));
const values = data.values;
const BATCH = 500;
const chunks = [];
for (let i = 0; i < values.length; i += BATCH) {
  chunks.push(values.slice(i, i + BATCH));
}
console.log(JSON.stringify({ chunks: chunks.length, rowsPerChunk: BATCH, totalRows: values.length }));
// Write first chunk to file so we can pass to MCP (chunk 0 = header + first 499 data rows)
fs.writeFileSync(path.join(__dirname, 'sheet-write-chunk0.json'), JSON.stringify(chunks[0]), 'utf8');
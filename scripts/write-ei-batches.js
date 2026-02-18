const fs = require('fs');
const path = require('path');
const d = JSON.parse(fs.readFileSync(path.join(__dirname, 'enriched-eh.json'), 'utf8'));
const values = d.values;
const B = 500;
for (let i = 0; i < 5; i++) {
  const chunk = values.slice(i * B, (i + 1) * B);
  const startRow = i * B + 1;
  const endRow = i * B + chunk.length;
  fs.writeFileSync(
    path.join(__dirname, `ei-batch-${i}.json`),
    JSON.stringify({ range: `E${startRow}:I${endRow}`, values: chunk }),
    'utf8'
  );
}
console.log('Wrote ei-batch-0.json .. ei-batch-4.json');

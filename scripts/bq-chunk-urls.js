const j = require('./sheet-rows.json');
const esc = (s) => String(s).replace(/'/g, "''");
const chunkIndex = parseInt(process.argv[2] || '0', 10);
const size = 400;
const start = chunkIndex * size;
const chunk = j.urlList.slice(start, start + size).map(esc);
const inList = "ARRAY<STRING>['" + chunk.join("','") + "']";
console.log(inList);
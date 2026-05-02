#!/usr/bin/env node
// Convert Tooling API Layout.Metadata JSON to source-format Layout XML.
// Usage: node layout-json-to-xml.js <input.json> <output.layout-meta.xml>
const fs = require('fs');
const path = require('path');

const KEY_ORDER = [
  'customConsoleComponents',
  'emailDefault',
  'excludeButtons',
  'feedLayout',
  'headers',
  'layoutSections',
  'miniLayout',
  'multilineLayoutFields',
  'platformActionList',
  'quickActionList',
  'relatedContent',
  'relatedLists',
  'relatedObjects',
  'runAssignmentRulesDefault',
  'showEmailCheckbox',
  'showHighlightsPanel',
  'showInteractionLogPanel',
  'showKnowledgeComponent',
  'showRunAssignmentRulesCheckbox',
  'showSolutionSection',
  'showSubmitAndAttachButton',
  'summaryLayout'
];

function escape(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function isEmpty(v) {
  if (v === null || v === undefined) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v).length === 0;
  return false;
}

function render(name, value, indent) {
  const pad = '    '.repeat(indent);
  if (isEmpty(value)) return '';

  if (Array.isArray(value)) {
    return value.map(v => render(name, v, indent)).join('');
  }

  if (value && typeof value === 'object') {
    const keys = Object.keys(value)
      .filter(k => !isEmpty(value[k]))
      .sort((a, b) => {
        const ia = KEY_ORDER.indexOf(a);
        const ib = KEY_ORDER.indexOf(b);
        if (ia !== -1 && ib !== -1) return ia - ib;
        if (ia !== -1) return -1;
        if (ib !== -1) return 1;
        return a.localeCompare(b);
      });
    if (keys.length === 0) return '';
    let out = `${pad}<${name}>\n`;
    for (const k of keys) {
      out += render(k, value[k], indent + 1);
    }
    out += `${pad}</${name}>\n`;
    return out;
  }

  if (typeof value === 'boolean') {
    return `${pad}<${name}>${value}</${name}>\n`;
  }
  return `${pad}<${name}>${escape(value)}</${name}>\n`;
}

function buildLayoutXml(metadata, extra) {
  const keys = Object.keys(metadata)
    .filter(k => !isEmpty(metadata[k]))
    .sort((a, b) => {
      const ia = KEY_ORDER.indexOf(a);
      const ib = KEY_ORDER.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b);
    });
  let out = '<?xml version="1.0" encoding="UTF-8"?>\n';
  out += '<Layout xmlns="http://soap.sforce.com/2006/04/metadata">\n';
  for (const k of keys) {
    if (extra && extra.skipKeys && extra.skipKeys.includes(k)) continue;
    out += render(k, metadata[k], 1);
  }
  if (extra && extra.extraRelatedListsXml) {
    out += extra.extraRelatedListsXml;
  }
  out += '</Layout>\n';
  return out;
}

if (require.main === module) {
  const [inPath, outPath] = process.argv.slice(2);
  if (!inPath || !outPath) {
    console.error('Usage: node layout-json-to-xml.js <input.json> <output.xml>');
    process.exit(1);
  }
  const j = JSON.parse(fs.readFileSync(inPath, 'utf8'));
  const md = j.Metadata || j;
  const xml = buildLayoutXml(md);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, xml);
  console.log('wrote ' + outPath + ' (' + xml.length + ' bytes)');
}

module.exports = { buildLayoutXml, render };

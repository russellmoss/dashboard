'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { parseApiResponse, applySectionPatches } = require('../scripts/_claude-engine.cjs');

/** Create a temp directory for test files */
function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'section-patch-test-'));
}

/** Write a file in the temp dir and return the relative path */
function writeTemp(dir, relPath, content) {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  return relPath;
}

describe('applySectionPatches', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('replaces a middle section correctly', () => {
    const relPath = writeTemp(tmpDir, 'docs/ARCHITECTURE.md', [
      '## Section A',
      'Content A line 1',
      'Content A line 2',
      '',
      '## Section B',
      'Content B line 1',
      'Content B line 2',
      '',
      '## Section C',
      'Content C line 1',
      'Content C line 2',
      '',
    ].join('\n'));

    const patches = [
      { path: relPath, header: '## Section B', content: '## Section B\nNew B content\n' },
    ];

    const result = applySectionPatches(patches, tmpDir);

    expect(result.applied).toEqual([relPath]);
    expect(result.skipped).toEqual([]);

    const output = fs.readFileSync(path.join(tmpDir, relPath), 'utf8');
    expect(output).toContain('## Section A\nContent A line 1');
    expect(output).toContain('## Section B\nNew B content\n');
    expect(output).toContain('## Section C\nContent C line 1');
    // Original B content should be gone
    expect(output).not.toContain('Content B line 1');
    expect(output).not.toContain('Content B line 2');
  });

  test('replaces the last section (no next header)', () => {
    const relPath = writeTemp(tmpDir, 'docs/ARCHITECTURE.md', [
      '## Section A',
      'Content A',
      '',
      '## Section B',
      'Content B',
      '',
      '## Section C',
      'Old C content line 1',
      'Old C content line 2',
      '',
    ].join('\n'));

    const patches = [
      { path: relPath, header: '## Section C', content: '## Section C\nBrand new C content\n' },
    ];

    const result = applySectionPatches(patches, tmpDir);

    expect(result.applied).toEqual([relPath]);
    expect(result.skipped).toEqual([]);

    const output = fs.readFileSync(path.join(tmpDir, relPath), 'utf8');
    expect(output).toContain('## Section A\nContent A');
    expect(output).toContain('## Section B\nContent B');
    expect(output).toContain('## Section C\nBrand new C content');
    expect(output).not.toContain('Old C content');
    // File should end with newline
    expect(output.endsWith('\n')).toBe(true);
  });

  test('handles header not found gracefully', () => {
    const relPath = writeTemp(tmpDir, 'docs/ARCHITECTURE.md', [
      '## Section A',
      'Content A',
      '',
      '## Section B',
      'Content B',
      '',
    ].join('\n'));

    const original = fs.readFileSync(path.join(tmpDir, relPath), 'utf8');

    const patches = [
      { path: relPath, header: '## NonExistent', content: '## NonExistent\nSome content\n' },
    ];

    const result = applySectionPatches(patches, tmpDir);

    expect(result.applied).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].header).toBe('## NonExistent');
    expect(result.skipped[0].reason).toContain('not found');

    // File unchanged
    const output = fs.readFileSync(path.join(tmpDir, relPath), 'utf8');
    expect(output).toBe(original);
  });

  test('handles multiple patches to same file', () => {
    const relPath = writeTemp(tmpDir, 'docs/ARCHITECTURE.md', [
      '## Section A',
      'Old A content',
      '',
      '## Section B',
      'Content B stays',
      '',
      '## Section C',
      'Old C content',
      '',
    ].join('\n'));

    const patches = [
      { path: relPath, header: '## Section A', content: '## Section A\nNew A content\n' },
      { path: relPath, header: '## Section C', content: '## Section C\nNew C content\n' },
    ];

    const result = applySectionPatches(patches, tmpDir);

    expect(result.applied).toEqual([relPath]);
    expect(result.skipped).toEqual([]);

    const output = fs.readFileSync(path.join(tmpDir, relPath), 'utf8');
    expect(output).toContain('## Section A\nNew A content');
    expect(output).toContain('## Section B\nContent B stays');
    expect(output).toContain('## Section C\nNew C content');
    expect(output).not.toContain('Old A content');
    expect(output).not.toContain('Old C content');
  });
});

describe('parseApiResponse', () => {
  test('falls back to <updated-file> format', () => {
    const responseText = [
      'Some preamble text.',
      '<updated-file path="docs/ARCHITECTURE.md">',
      '# Architecture',
      'Full file content here.',
      '</updated-file>',
    ].join('\n');

    const result = parseApiResponse(responseText, ['docs/ARCHITECTURE.md']);

    expect(result.format).toBe('full');
    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toBe('docs/ARCHITECTURE.md');
    expect(result.files[0].content).toContain('Full file content here.');
    expect(result.patches).toEqual([]);
  });

  test('parses <updated-section> format', () => {
    const responseText = [
      '<updated-section file="docs/ARCHITECTURE.md" header="## API Routes">',
      '## API Routes',
      'Updated route list.',
      '</updated-section>',
      '<updated-section file="README.md" header="## Getting Started">',
      '## Getting Started',
      'New getting started content.',
      '</updated-section>',
    ].join('\n');

    const result = parseApiResponse(responseText, ['docs/ARCHITECTURE.md', 'README.md']);

    expect(result.format).toBe('section');
    expect(result.patches).toHaveLength(2);
    expect(result.patches[0].path).toBe('docs/ARCHITECTURE.md');
    expect(result.patches[0].header).toBe('## API Routes');
    expect(result.patches[1].path).toBe('README.md');
    expect(result.patches[1].header).toBe('## Getting Started');
    expect(result.files).toEqual([]);
  });

  test('ignores unexpected file paths', () => {
    const responseText = [
      '<updated-section file="src/hack.js" header="## Injected">',
      'bad content',
      '</updated-section>',
    ].join('\n');

    const result = parseApiResponse(responseText, ['docs/ARCHITECTURE.md']);

    expect(result.patches).toEqual([]);
    expect(result.warnings).toContain('Ignoring unexpected file in section response: src/hack.js');
  });

  test('returns warning when no markers found', () => {
    const result = parseApiResponse('Just some plain text response.', ['docs/ARCHITECTURE.md']);

    expect(result.patches).toEqual([]);
    expect(result.files).toEqual([]);
    expect(result.warnings[0]).toContain('No <updated-section> or <updated-file> markers found');
  });
});

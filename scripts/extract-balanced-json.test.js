'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { extractJson, findBalancedBlocks } = require('./extract-balanced-json');

// ---------------------------------------------------------------------------
// findBalancedBlocks
// ---------------------------------------------------------------------------

test('findBalancedBlocks: returns empty for no braces', () => {
  assert.deepStrictEqual(findBalancedBlocks('hello world'), []);
});

test('findBalancedBlocks: single object', () => {
  const blocks = findBalancedBlocks('{"a":1}');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].start, 0);
  assert.equal(blocks[0].end, 6);
});

test('findBalancedBlocks: two consecutive objects', () => {
  const blocks = findBalancedBlocks('{"a":1} {"b":2}');
  assert.equal(blocks.length, 2);
});

test('findBalancedBlocks: nested braces counted correctly', () => {
  const blocks = findBalancedBlocks('{"a":{"b":1}}');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].start, 0);
  assert.equal(blocks[0].end, 12);
});

test('findBalancedBlocks: braces inside strings are ignored', () => {
  const input = '{"a":"}{"}';
  const blocks = findBalancedBlocks(input);
  assert.equal(blocks.length, 1);
  assert.equal(input.slice(blocks[0].start, blocks[0].end + 1), input);
});

test('findBalancedBlocks: unclosed brace is skipped', () => {
  const blocks = findBalancedBlocks('{ incomplete');
  assert.equal(blocks.length, 0);
});

// ---------------------------------------------------------------------------
// extractJson — normal cases
// ---------------------------------------------------------------------------

test('extractJson: plain valid JSON', () => {
  const input = '{"issue_summary":"test","initial_keywords":["a","b"]}';
  assert.equal(extractJson(input), input);
});

test('extractJson: returns null for non-JSON', () => {
  assert.equal(extractJson('hello world'), null);
});

test('extractJson: returns null for empty string', () => {
  assert.equal(extractJson(''), null);
});

// ---------------------------------------------------------------------------
// extractJson — preamble with example JSON (the bug reported in #28)
// ---------------------------------------------------------------------------

test('extractJson: preamble with small example JSON followed by real payload', () => {
  const input = [
    'For example, the structure would look like {"key": "demo"}.',
    '',
    'Actual output:',
    '{"issue_summary": "real data", "initial_keywords": ["k1", "k2"], "scope": "backend"}',
  ].join('\n');

  const result = JSON.parse(extractJson(input));
  assert.equal(result.issue_summary, 'real data');
  assert.ok(Array.isArray(result.initial_keywords));
});

test('extractJson: multiple small examples before payload', () => {
  const input = [
    'Here is {"a":1} and also {"b":2}.',
    '{"issue_summary":"real","initial_keywords":["x"],"scope":"all","risk_level":"low"}',
  ].join('\n');

  const result = JSON.parse(extractJson(input));
  assert.equal(result.issue_summary, 'real');
});

// ---------------------------------------------------------------------------
// extractJson — markdown fenced block (priority 1)
// ---------------------------------------------------------------------------

test('extractJson: ```json fenced block is preferred', () => {
  const input = [
    'Here is a small example: {"key":"demo"}',
    '',
    '```json',
    '{"issue_summary":"fenced","initial_keywords":["a"]}',
    '```',
  ].join('\n');

  const result = JSON.parse(extractJson(input));
  assert.equal(result.issue_summary, 'fenced');
});

test('extractJson: invalid fenced block falls through to scan', () => {
  const input = ['```json', 'not valid json', '```', '{"issue_summary":"fallback"}'].join('\n');

  const result = JSON.parse(extractJson(input));
  assert.equal(result.issue_summary, 'fallback');
});

// ---------------------------------------------------------------------------
// extractJson — trailing text
// ---------------------------------------------------------------------------

test('extractJson: trailing text after JSON is ignored', () => {
  const input = '{"a":1}\n\nHope this helps!';
  const result = JSON.parse(extractJson(input));
  assert.equal(result.a, 1);
});

// ---------------------------------------------------------------------------
// extractJson — escaped characters inside strings
// ---------------------------------------------------------------------------

test('extractJson: escaped quotes inside strings', () => {
  const input = '{"msg":"she said \\"hello\\""}';
  const result = JSON.parse(extractJson(input));
  assert.equal(result.msg, 'she said "hello"');
});

test('extractJson: escaped backslashes', () => {
  const input = '{"path":"C:\\\\Users\\\\test"}';
  const result = JSON.parse(extractJson(input));
  assert.equal(result.path, 'C:\\Users\\test');
});

// ---------------------------------------------------------------------------
// extractJson — real-world-ish agent output patterns
// ---------------------------------------------------------------------------

test('extractJson: Claude "I have sufficient data" preamble', () => {
  const input = [
    'I have sufficient data. Let me compile the final output.',
    '',
    '{"issue_summary":"Bug in login","initial_keywords":["auth","login"],"scope":"frontend"}',
  ].join('\n');

  const result = JSON.parse(extractJson(input));
  assert.equal(result.issue_summary, 'Bug in login');
});

test('extractJson: object with nested arrays and objects', () => {
  const payload = JSON.stringify({
    issue_summary: 'Complex',
    findings: [
      { file: 'a.ts', line: 10, note: 'issue here' },
      { file: 'b.ts', line: 20, note: 'also here' },
    ],
    metadata: { confidence: 0.9 },
  });
  const input = 'Preamble text.\n' + payload;
  const result = JSON.parse(extractJson(input));
  assert.equal(result.findings.length, 2);
  assert.equal(result.metadata.confidence, 0.9);
});

// ---------------------------------------------------------------------------
// extractJson — only invalid JSON blocks
// ---------------------------------------------------------------------------

test('extractJson: balanced but not valid JSON returns null', () => {
  assert.equal(extractJson('{not: valid: json:}'), null);
});

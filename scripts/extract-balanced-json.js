'use strict';

// Extract the best top-level JSON object from a string that may contain
// preamble text, example snippets, or markdown fences around the real payload.
//
// Strategy (in priority order):
//   1. If a ```json ... ``` fenced block exists, try that first.
//   2. Scan ALL balanced { ... } blocks (respecting string escapes).
//   3. Among valid-JSON candidates, pick the longest one that appears latest
//      in the input — Claude's "preamble + final JSON" pattern means the
//      real payload comes last and is the largest object.
//
// Usage:
//   node extract-balanced-json.js <input-file> <output-file>
//   require('./extract-balanced-json').extractJson(rawString)

/**
 * Find all balanced top-level { ... } blocks in `raw`, respecting
 * double-quoted string escapes.  Returns an array of { start, end }
 * (inclusive indices).
 */
function findBalancedBlocks(raw) {
  const blocks = [];
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === '{') {
      let depth = 0;
      let inStr = false;
      let esc = false;
      let end = -1;
      for (let j = i; j < raw.length; j++) {
        const c = raw[j];
        if (esc) {
          esc = false;
          continue;
        }
        if (inStr) {
          if (c === '\\') esc = true;
          else if (c === '"') inStr = false;
          continue;
        }
        if (c === '"') inStr = true;
        else if (c === '{') depth++;
        else if (c === '}') {
          if (--depth === 0) {
            end = j;
            break;
          }
        }
      }
      if (end >= 0) {
        blocks.push({ start: i, end });
        // Skip past this block so we don't count nested braces as new blocks
        i = end + 1;
      } else {
        // Unclosed brace — skip it
        i++;
      }
    } else {
      i++;
    }
  }
  return blocks;
}

/**
 * Try to parse `str` as JSON.  Returns the parsed value or undefined.
 */
function tryParse(str) {
  try {
    return JSON.parse(str);
  } catch {
    return undefined;
  }
}

/**
 * Extract the best JSON object from `raw`.
 *
 * Returns the extracted JSON string, or null if nothing valid was found.
 */
function extractJson(raw) {
  // --- Priority 1: ```json fenced block ---
  const fenceRe = /```json\s*\n([\s\S]*?)```/g;
  let fenceMatch;
  while ((fenceMatch = fenceRe.exec(raw)) !== null) {
    const candidate = fenceMatch[1].trim();
    if (candidate.startsWith('{') && tryParse(candidate) !== undefined) {
      return candidate;
    }
  }

  // --- Priority 2 & 3: scan all balanced blocks, pick best ---
  const blocks = findBalancedBlocks(raw);
  if (blocks.length === 0) return null;

  // Among valid-JSON blocks, pick the longest; ties broken by latest position.
  let best = null;
  let bestLen = -1;
  for (const { start, end } of blocks) {
    const candidate = raw.slice(start, end + 1);
    if (tryParse(candidate) !== undefined) {
      const len = candidate.length;
      if (len > bestLen || (len === bestLen && start > (best ? best.start : -1))) {
        best = { start, end, text: candidate };
        bestLen = len;
      }
    }
  }

  return best ? best.text : null;
}

// --- CLI entry point ---
if (require.main === module) {
  const fs = require('fs');
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];

  if (!inputPath || !outputPath) {
    process.stderr.write('Usage: node extract-balanced-json.js <input> <output>\n');
    process.exit(1);
  }

  const raw = fs.readFileSync(inputPath, 'utf8');
  const result = extractJson(raw);

  if (result === null) {
    process.exit(2);
  }

  fs.writeFileSync(outputPath, result);
}

module.exports = { extractJson, findBalancedBlocks };

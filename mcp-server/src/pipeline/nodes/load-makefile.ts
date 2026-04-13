import fs from 'node:fs/promises';
import path from 'node:path';
import type { MakeTarget } from '../../lib/types.js';
import { isAllowedPath } from '../../lib/allowlist.js';

/**
 * Parse Makefile to extract targets with their comments and recipes.
 * Expects comment lines immediately above target definitions.
 */
export async function loadMakefile(root: string): Promise<MakeTarget[]> {
  if (!isAllowedPath('Makefile', root)) return [];
  const full = path.join(root, 'Makefile');
  let content: string;
  try {
    content = await fs.readFile(full, 'utf-8');
  } catch (err) {
    console.warn('[pipeline] Could not read Makefile:', (err as Error).message);
    return [];
  }

  const lines = content.split('\n');
  const targets: MakeTarget[] = [];
  const pendingComments: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Collect comment lines (# comment above target)
    const commentMatch = line.match(/^#\s*(.+)/);
    if (commentMatch) {
      pendingComments.push(commentMatch[1].trim());
      continue;
    }

    // Match target definitions (name: or name: deps)
    const targetMatch = line.match(/^([a-zA-Z_][\w-]*):/);
    if (targetMatch) {
      const name = targetMatch[1];

      // Collect recipe lines (indented with tab)
      const recipeLines: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].startsWith('\t')) {
          recipeLines.push(lines[j].replace(/^\t/, '').replace(/^@/, ''));
        } else {
          break;
        }
      }

      targets.push({
        name,
        comment: pendingComments.join(' '),
        recipe: recipeLines.join('\n'),
      });
      pendingComments.length = 0;
    } else if (!line.trim()) {
      // Blank line resets pending comments
      pendingComments.length = 0;
    }
  }
  return targets;
}

import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { WorkflowDef } from '../../lib/types.js';
import { isAllowedPath } from '../../lib/allowlist.js';

const WorkflowNodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  notes: z.string().optional(),
  parameters: z.record(z.unknown()).default({}),
});

const WorkflowJsonSchema = z.object({
  name: z.string().optional(),
  nodes: z.array(WorkflowNodeSchema).default([]),
  connections: z.record(z.unknown()).default({}),
  settings: z.record(z.unknown()).default({}),
});

/** Load n8n workflow JSON files from workflows/ directory */
export async function loadWorkflows(root: string): Promise<WorkflowDef[]> {
  const dir = path.join(root, 'workflows');
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    console.warn('[pipeline] Could not read workflows directory:', (err as Error).message);
    return [];
  }

  const defs: WorkflowDef[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const rel = `workflows/${entry}`;
    if (!isAllowedPath(rel, root)) continue;
    const full = path.join(dir, entry);
    try {
      const raw = await fs.readFile(full, 'utf-8');
      const parsed = WorkflowJsonSchema.parse(JSON.parse(raw));
      defs.push({
        fileName: entry,
        name: parsed.name ?? entry,
        nodes: parsed.nodes,
        connections: parsed.connections as Record<string, unknown>,
        settings: parsed.settings as Record<string, unknown>,
      });
    } catch (err) {
      console.warn(`[pipeline] Could not parse workflow ${entry}:`, (err as Error).message);
    }
  }
  return defs;
}

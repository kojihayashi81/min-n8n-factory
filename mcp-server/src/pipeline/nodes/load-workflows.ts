import fs from "node:fs/promises";
import path from "node:path";
import type { WorkflowDef, WorkflowNode } from "../../lib/types.js";
import { isAllowedPath } from "../../lib/allowlist.js";

/** Load n8n workflow JSON files from workflows/ directory */
export async function loadWorkflows(root: string): Promise<WorkflowDef[]> {
  const dir = path.join(root, "workflows");
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    console.warn("[pipeline] Could not read workflows directory:", (err as Error).message);
    return [];
  }

  const defs: WorkflowDef[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const rel = `workflows/${entry}`;
    if (!isAllowedPath(rel, root)) continue;
    const full = path.join(dir, entry);
    try {
      const raw = await fs.readFile(full, "utf-8");
      const parsed = JSON.parse(raw);
      const nodes: WorkflowNode[] = (parsed.nodes ?? []).map(
        (n: Record<string, unknown>) => ({
          id: n.id as string,
          name: n.name as string,
          type: n.type as string,
          notes: n.notes as string | undefined,
          parameters: n.parameters as Record<string, unknown>,
        })
      );
      defs.push({
        fileName: entry,
        name: parsed.name ?? entry,
        nodes,
        connections: parsed.connections ?? {},
        settings: parsed.settings ?? {},
      });
    } catch (err) {
      console.warn(`[pipeline] Could not parse workflow ${entry}:`, (err as Error).message);
    }
  }
  return defs;
}

import fs from "node:fs/promises";
import path from "node:path";
import type { SpecDoc } from "../../lib/types.js";
import { isAllowedPath } from "../../lib/allowlist.js";

/** Extract title from markdown content (first # heading or filename) */
function extractTitle(content: string, filePath: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : path.basename(filePath);
}

/** Load spec documents from workspace */
export async function loadSpecDocs(root: string): Promise<SpecDoc[]> {
  const targets = [
    "README.md",
    "docs/setup.md",
    "docs/claude-skills-best-practices.md",
  ];

  const docs: SpecDoc[] = [];
  for (const rel of targets) {
    if (!isAllowedPath(rel, root)) continue;
    const full = path.join(root, rel);
    try {
      const content = await fs.readFile(full, "utf-8");
      docs.push({ path: rel, content, title: extractTitle(content, rel) });
    } catch {
      // File may not exist in mounted volume — skip
    }
  }
  return docs;
}

import fs from "node:fs/promises";
import path from "node:path";
import type { SpecDoc } from "../../lib/types.js";
import { isAllowedPath } from "../../lib/allowlist.js";

/** Extract title from markdown content (first # heading or filename) */
function extractTitle(content: string, filePath: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() || path.basename(filePath);
}

/** Recursively collect .md file paths under a directory */
async function collectMarkdownFiles(
  dir: string,
  root: string,
  prefix: string
): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const results: string[] = [];
  for (const entry of entries) {
    const rel = `${prefix}${entry.name}`;
    if (entry.isDirectory()) {
      results.push(
        ...(await collectMarkdownFiles(
          path.join(dir, entry.name),
          root,
          `${rel}/`
        ))
      );
    } else if (entry.name.endsWith(".md") && isAllowedPath(rel, root)) {
      results.push(rel);
    }
  }
  return results;
}

/** Load spec documents from workspace (auto-discover docs/ + README.md) */
export async function loadSpecDocs(root: string): Promise<SpecDoc[]> {
  const targets: string[] = [];

  if (isAllowedPath("README.md", root)) {
    targets.push("README.md");
  }

  // Auto-discover .md files under docs/
  targets.push(
    ...(await collectMarkdownFiles(path.join(root, "docs"), root, "docs/"))
  );

  const docs: SpecDoc[] = [];
  for (const rel of targets) {
    const full = path.join(root, rel);
    try {
      const content = await fs.readFile(full, "utf-8");
      docs.push({ path: rel, content, title: extractTitle(content, rel) });
    } catch (err) {
      console.warn(
        `[pipeline] Could not read spec doc ${rel}:`,
        (err as Error).message
      );
    }
  }
  return docs;
}

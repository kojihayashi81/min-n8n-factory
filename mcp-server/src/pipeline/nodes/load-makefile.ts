import fs from "node:fs/promises";
import path from "node:path";
import type { MakeTarget } from "../../lib/types.js";

/**
 * Parse Makefile to extract targets with their comments and recipes.
 * Expects comment lines immediately above target definitions.
 */
export async function loadMakefile(root: string): Promise<MakeTarget[]> {
  const full = path.join(root, "Makefile");
  let content: string;
  try {
    content = await fs.readFile(full, "utf-8");
  } catch (err) {
    console.warn("[pipeline] Could not read Makefile:", (err as Error).message);
    return [];
  }

  const lines = content.split("\n");
  const targets: MakeTarget[] = [];
  let pendingComment = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Collect comment lines (# comment above target)
    const commentMatch = line.match(/^#\s*(.+)/);
    if (commentMatch) {
      pendingComment = commentMatch[1].trim();
      continue;
    }

    // Match target definitions (name: or name: deps)
    const targetMatch = line.match(/^([a-zA-Z_][\w-]*):/);
    if (targetMatch) {
      const name = targetMatch[1];
      // Skip .PHONY
      if (name === ".PHONY") {
        pendingComment = "";
        continue;
      }

      // Collect recipe lines (indented with tab)
      const recipeLines: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].startsWith("\t")) {
          recipeLines.push(lines[j].replace(/^\t/, "").replace(/^@/, ""));
        } else {
          break;
        }
      }

      targets.push({
        name,
        comment: pendingComment,
        recipe: recipeLines.join("\n"),
      });
      pendingComment = "";
    } else if (!line.trim()) {
      // Blank line resets pending comment
      pendingComment = "";
    }
  }
  return targets;
}

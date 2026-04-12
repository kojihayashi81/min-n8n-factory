import path from "node:path";

/** Paths allowed for public access (relative to workspace root) */
const ALLOWED_PREFIXES = [
  "README.md",
  "docs/",
  "workflows/",
  "templates/",
  "scripts/",
  "Makefile",
  "labels.json",
];

/** Paths explicitly denied */
const DENIED_PATTERNS = [".env", "data/", ".git/", "node_modules/"];

export function isAllowedPath(filePath: string, root: string): boolean {
  const rel = path.relative(root, path.resolve(root, filePath));
  if (rel.startsWith("..")) return false;
  if (DENIED_PATTERNS.some((p) => rel.startsWith(p))) return false;
  return ALLOWED_PREFIXES.some((p) => rel.startsWith(p));
}

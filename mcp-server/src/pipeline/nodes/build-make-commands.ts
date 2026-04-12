import type { MakeTarget, ResourceEntry } from "../../lib/types.js";

/** Build a resource summarizing all Makefile targets */
export function buildMakeCommands(
  targets: MakeTarget[],
  generatedAt: string
): ResourceEntry {
  const lines = targets.map((t) => {
    const desc = t.comment || "(説明なし)";
    return `### \`make ${t.name}\`\n\n${desc}\n\n\`\`\`bash\n${t.recipe}\n\`\`\``;
  });

  return {
    uri: "project://commands/make",
    title: "make コマンド一覧",
    kind: "derived",
    sourceFiles: ["Makefile"],
    summary: `${targets.length} 件の make ターゲット`,
    content: `# make コマンド一覧\n\nMakefile から抽出したターゲット一覧。\n\n${lines.join("\n\n")}`,
    knownGaps: [],
    generatedAt,
  };
}

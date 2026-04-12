import type { WorkflowDef, ResourceEntry } from "../../lib/types.js";

/** Derive connection flow as readable text */
function describeFlow(wf: WorkflowDef): string {
  const lines: string[] = [];
  for (const [from, targets] of Object.entries(wf.connections)) {
    try {
      const main = (targets as { main?: { node: string }[][] }).main;
      if (!main || !Array.isArray(main)) continue;
      for (let i = 0; i < main.length; i++) {
        if (!Array.isArray(main[i])) continue;
        for (const conn of main[i]) {
          if (!conn || typeof conn.node !== "string") continue;
          const label = main.length > 1 ? ` (output ${i})` : "";
          lines.push(`- ${from}${label} → ${conn.node}`);
        }
      }
    } catch {
      console.warn(`[pipeline] Unexpected connection structure for node "${from}" in ${wf.fileName}`);
    }
  }
  return lines.join("\n");
}

/** Collect TODO and notes from workflow nodes */
function collectGaps(wf: WorkflowDef): string[] {
  const gaps: string[] = [];
  for (const node of wf.nodes) {
    if (node.notes) gaps.push(`[${node.name}] ${node.notes}`);
    const cmd = node.parameters.command;
    if (typeof cmd === "string" && cmd.includes("TODO")) {
      gaps.push(`[${node.name}] TODO が残っている: ${cmd}`);
    }
  }
  return gaps;
}

/** Build a resource for a single workflow */
function buildOne(wf: WorkflowDef, generatedAt: string): ResourceEntry {
  const slug = wf.fileName.replace(/\.json$/, "");
  const timeout = (wf.settings as { timeout?: number }).timeout;

  const nodeList = wf.nodes
    .map((n) => `- **${n.name}** (\`${n.type}\`)`)
    .join("\n");

  const flow = describeFlow(wf);
  const timeoutLine = timeout ? `\n\n実行タイムアウト: ${timeout}秒` : "";

  const content = [
    `# ${wf.name}`,
    "",
    `ソースファイル: \`workflows/${wf.fileName}\`${timeoutLine}`,
    "",
    "## ノード一覧",
    "",
    nodeList,
    "",
    "## フロー",
    "",
    flow,
  ].join("\n");

  return {
    uri: `project://workflows/${slug}`,
    title: `${wf.name} の説明`,
    kind: "derived",
    sourceFiles: [`workflows/${wf.fileName}`],
    summary: `${wf.nodes.length} ノードのワークフロー。${timeout ? `タイムアウト ${timeout}秒。` : ""}`,
    content,
    knownGaps: collectGaps(wf),
    generatedAt,
  };
}

/** Build resources for all workflows */
export function buildWorkflowSummaries(
  defs: WorkflowDef[],
  generatedAt: string
): ResourceEntry[] {
  return defs.map((wf) => buildOne(wf, generatedAt));
}

import type { LabelDef, WorkflowDef, ResourceEntry } from "../../lib/types.js";

/** Extract labels actually used in workflow JSON */
function extractImplLabels(defs: WorkflowDef[]): Set<string> {
  const labels = new Set<string>();
  for (const wf of defs) {
    for (const node of wf.nodes) {
      const params = node.parameters;
      // Check filter labels
      const filters = params.getRepositoryIssuesFilters as
        | { labels?: string }
        | undefined;
      if (filters?.labels) labels.add(filters.labels);
      const filters2 = params.filters as { labels?: string } | undefined;
      if (filters2?.labels) labels.add(filters2.labels);
      // Check editFields labels
      const editFields = params.editFields as
        | { labels?: string | { label: string }[] }
        | undefined;
      if (editFields?.labels) {
        if (typeof editFields.labels === "string") {
          labels.add(editFields.labels);
        } else if (Array.isArray(editFields.labels)) {
          for (const l of editFields.labels) labels.add(l.label);
        }
      }
    }
  }
  return labels;
}

export function buildLabelsLifecycle(
  labelDefs: LabelDef[],
  workflowDefs: WorkflowDef[],
  generatedAt: string
): ResourceEntry {
  const implLabels = extractImplLabels(workflowDefs);
  const specLabelNames = new Set(labelDefs.map((l) => l.name));

  const gaps: string[] = [];
  // Labels in impl but not in spec
  for (const label of implLabels) {
    if (!specLabelNames.has(label)) {
      gaps.push(
        `ラベル "${label}" はワークフローで使用されているが labels.json に未定義`
      );
    }
  }
  // Labels in spec but not in impl
  for (const label of labelDefs) {
    if (!implLabels.has(label.name)) {
      gaps.push(
        `ラベル "${label.name}" は labels.json に定義されているがワークフローで未使用`
      );
    }
  }

  const specTable = labelDefs
    .map((l) => `| \`${l.name}\` | ${l.meaning} |`)
    .join("\n");

  const transitions = [
    "1. `ai-ready` → `ai-processing`（ワークフローが自動付与）",
    "2. `ai-processing` → `ai-investigated`（調査完了・Draft PR 作成）",
    "3. `ai-processing` → `ai-failed`（タイムアウトまたはエラー）",
    "4. `ai-failed` → `ai-ready`（人間が手動で再試行）",
  ].join("\n");

  const content = [
    "# Issue ラベルと状態遷移",
    "",
    "## 定義済みラベル（labels.json）",
    "",
    "| ラベル | 意味 |",
    "| --- | --- |",
    specTable,
    "",
    "## 状態遷移",
    "",
    transitions,
    "",
    "## ワークフローで実際に使用されているラベル",
    "",
    [...implLabels].map((l) => `- \`${l}\``).join("\n"),
  ].join("\n");

  return {
    uri: "project://labels/lifecycle",
    title: "Issue ラベルと状態遷移",
    kind: "derived",
    sourceFiles: [
      "labels.json",
      ...workflowDefs.map((w) => `workflows/${w.fileName}`),
    ],
    summary: `${labelDefs.length} 個の定義済みラベル、${implLabels.size} 個の実装ラベル`,
    content,
    knownGaps: gaps,
    generatedAt,
  };
}

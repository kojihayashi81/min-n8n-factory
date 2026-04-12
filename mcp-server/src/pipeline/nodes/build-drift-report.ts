import type {
  LabelDef,
  SpecDoc,
  MakeTarget,
  WorkflowDef,
  ResourceEntry,
  DriftItem,
} from "../../lib/types.js";
import { extractImplLabels } from "./build-labels-lifecycle.js";

/** Detect label drift between labels.json and workflow implementation */
function detectLabelDrift(
  labelDefs: LabelDef[],
  workflowDefs: WorkflowDef[]
): DriftItem[] {
  const items: DriftItem[] = [];

  const implLabels = extractImplLabels(workflowDefs);
  const specLabels = new Set(labelDefs.map((l) => l.name));

  for (const label of implLabels) {
    if (!specLabels.has(label)) {
      items.push({
        area: "ラベル定義",
        docSays: `labels.json に "${label}" の定義がない`,
        implSays: `ワークフローで "${label}" を使用している`,
        severity: "warning",
        sourceFiles: [
          "labels.json",
          ...workflowDefs.map((w) => `workflows/${w.fileName}`),
        ],
      });
    }
  }

  for (const label of specLabels) {
    if (!implLabels.has(label)) {
      items.push({
        area: "ラベル定義",
        docSays: `labels.json に "${label}" が定義されている`,
        implSays: `どのワークフローでも "${label}" を使用していない`,
        severity: "info",
        sourceFiles: ["labels.json"],
      });
    }
  }

  return items;
}

/** Detect TODO nodes in workflows */
function detectWorkflowTodos(workflowDefs: WorkflowDef[]): DriftItem[] {
  const items: DriftItem[] = [];
  for (const wf of workflowDefs) {
    for (const node of wf.nodes) {
      const cmd = node.parameters.command;
      if (typeof cmd === "string" && cmd.includes("TODO")) {
        items.push({
          area: "ワークフロー実装",
          docSays: `ワークフロー "${wf.name}" は完成済みの想定`,
          implSays: `ノード "${node.name}" に TODO が残っている`,
          severity: "error",
          sourceFiles: [`workflows/${wf.fileName}`],
        });
      }
    }
  }
  return items;
}

/** Detect make target drift */
function detectMakeDrift(
  specDocs: SpecDoc[],
  makeTargets: MakeTarget[]
): DriftItem[] {
  const items: DriftItem[] = [];
  const readme = specDocs.find((d) => d.path === "README.md");
  if (!readme) return items;

  const targetNames = new Set(makeTargets.map((t) => t.name));

  // Check if README mentions make targets that don't exist
  const makeRefs = readme.content.matchAll(/`make\s+([\w-]+)`/g);
  for (const match of makeRefs) {
    const name = match[1];
    if (!targetNames.has(name)) {
      items.push({
        area: "make コマンド",
        docSays: `README.md で \`make ${name}\` に言及`,
        implSays: `Makefile にターゲット "${name}" が存在しない`,
        severity: "warning",
        sourceFiles: ["README.md", "Makefile"],
      });
    }
  }

  // Check for undocumented make targets
  const readmeContent = readme.content;
  for (const target of makeTargets) {
    if (!readmeContent.includes(`make ${target.name}`)) {
      items.push({
        area: "make コマンド",
        docSays: `README.md に \`make ${target.name}\` の記載がない`,
        implSays: `Makefile にターゲット "${target.name}" が存在する`,
        severity: "info",
        sourceFiles: ["README.md", "Makefile"],
      });
    }
  }

  return items;
}

/** Build the drift report resource */
export function buildDriftReport(
  labelDefs: LabelDef[],
  specDocs: SpecDoc[],
  makeTargets: MakeTarget[],
  workflowDefs: WorkflowDef[],
  generatedAt: string
): { resource: ResourceEntry; items: DriftItem[] } {
  const allItems = [
    ...detectLabelDrift(labelDefs, workflowDefs),
    ...detectWorkflowTodos(workflowDefs),
    ...detectMakeDrift(specDocs, makeTargets),
  ];

  const errorCount = allItems.filter((i) => i.severity === "error").length;
  const warningCount = allItems.filter((i) => i.severity === "warning").length;
  const infoCount = allItems.filter((i) => i.severity === "info").length;

  const sections = allItems.map((item) => {
    const icon =
      item.severity === "error"
        ? "[ERROR]"
        : item.severity === "warning"
          ? "[WARNING]"
          : "[INFO]";
    return [
      `### ${icon} ${item.area}`,
      "",
      `- **仕様**: ${item.docSays}`,
      `- **実装**: ${item.implSays}`,
      `- ソース: ${item.sourceFiles.map((f) => `\`${f}\``).join(", ")}`,
    ].join("\n");
  });

  const content = [
    "# ドキュメントと実装の差分レポート",
    "",
    `検出数: ERROR ${errorCount} / WARNING ${warningCount} / INFO ${infoCount}`,
    "",
    ...sections,
  ].join("\n\n");

  const resource: ResourceEntry = {
    uri: "project://drift-report",
    title: "ドキュメントと実装の差分レポート",
    kind: "derived",
    sourceFiles: [
      ...new Set(allItems.flatMap((i) => i.sourceFiles)),
    ],
    summary: `差分候補 ${allItems.length} 件（ERROR ${errorCount} / WARNING ${warningCount} / INFO ${infoCount}）`,
    content,
    knownGaps: [],
    generatedAt,
  };

  return { resource, items: allItems };
}

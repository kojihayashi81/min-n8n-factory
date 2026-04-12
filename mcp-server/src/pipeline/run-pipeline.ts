import fs from "node:fs/promises";
import path from "node:path";
import type { PipelineResult, ResourceEntry, LabelDef } from "../lib/types.js";
import { loadSpecDocs } from "./nodes/load-spec-docs.js";
import { loadMakefile } from "./nodes/load-makefile.js";
import { loadWorkflows } from "./nodes/load-workflows.js";
import { buildMakeCommands } from "./nodes/build-make-commands.js";
import { buildWorkflowSummaries } from "./nodes/build-workflow-summaries.js";
import { buildLabelsLifecycle } from "./nodes/build-labels-lifecycle.js";
import { buildDriftReport } from "./nodes/build-drift-report.js";

/** Load label definitions from labels.json (SSOT) */
async function loadLabels(root: string): Promise<LabelDef[]> {
  const full = path.join(root, "labels.json");
  try {
    const raw = await fs.readFile(full, "utf-8");
    return JSON.parse(raw) as LabelDef[];
  } catch {
    console.warn("[pipeline] labels.json not found, using empty label list");
    return [];
  }
}

/** Build spec-layer resources from loaded documents */
function buildSpecResources(
  specDocs: { path: string; content: string; title: string }[],
  generatedAt: string
): ResourceEntry[] {
  const mapping: Record<string, { uri: string; title: string }> = {
    "README.md": {
      uri: "project://overview",
      title: "プロジェクト概要",
    },
    "docs/setup.md": {
      uri: "project://setup",
      title: "セットアップ手順",
    },
    "docs/claude-skills-best-practices.md": {
      uri: "project://skills",
      title: "Claude Skills 運用方針",
    },
  };

  return specDocs
    .filter((doc) => mapping[doc.path])
    .map((doc) => {
      const meta = mapping[doc.path];
      return {
        uri: meta.uri,
        title: meta.title,
        kind: "spec" as const,
        sourceFiles: [doc.path],
        summary: doc.title,
        content: doc.content,
        knownGaps: [],
        generatedAt,
      };
    });
}

/**
 * Run the full pipeline: load → build → publish.
 *
 * Execution order:
 *   1. loadSpecDocs, loadMakefile, loadWorkflows  (parallel)
 *   2. buildMakeCommands, buildWorkflowSummaries, buildLabelsLifecycle
 *   3. buildDriftReport
 */
export async function runPipeline(root: string): Promise<PipelineResult> {
  const generatedAt = new Date().toISOString();

  // Phase 1: Load (parallel)
  const [specDocs, makeTargets, workflowDefs, labelDefs] = await Promise.all([
    loadSpecDocs(root),
    loadMakefile(root),
    loadWorkflows(root),
    loadLabels(root),
  ]);

  console.log(
    `[pipeline] Loaded: ${specDocs.length} spec docs, ${makeTargets.length} make targets, ${workflowDefs.length} workflows, ${labelDefs.length} labels`
  );

  // Phase 2: Build derived resources
  const specResources = buildSpecResources(specDocs, generatedAt);
  const makeResource = buildMakeCommands(makeTargets, generatedAt);
  const workflowResources = buildWorkflowSummaries(workflowDefs, generatedAt);
  const labelsResource = buildLabelsLifecycle(
    labelDefs,
    workflowDefs,
    generatedAt
  );

  // Phase 3: Drift report
  const { resource: driftResource, items: driftItems } = buildDriftReport(
    labelDefs,
    specDocs,
    makeTargets,
    workflowDefs,
    generatedAt
  );

  const resources = [
    ...specResources,
    makeResource,
    ...workflowResources,
    labelsResource,
    driftResource,
  ];

  console.log(
    `[pipeline] Generated: ${resources.length} resources, ${driftItems.length} drift items`
  );

  return {
    specDocs,
    makeTargets,
    workflowDefs,
    resources,
    driftItems,
  };
}

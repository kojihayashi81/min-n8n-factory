import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { PipelineResult, ResourceEntry, LabelDef } from "../lib/types.js";
import { isAllowedPath } from "../lib/allowlist.js";
import { loadSpecDocs } from "./nodes/load-spec-docs.js";
import { loadMakefile } from "./nodes/load-makefile.js";
import { loadWorkflows } from "./nodes/load-workflows.js";
import { buildMakeCommands } from "./nodes/build-make-commands.js";
import { buildWorkflowSummaries } from "./nodes/build-workflow-summaries.js";
import { buildLabelsLifecycle } from "./nodes/build-labels-lifecycle.js";
import { buildDriftReport } from "./nodes/build-drift-report.js";

const LabelDefSchema = z.array(
  z.object({
    name: z.string(),
    color: z.string(),
    meaning: z.string(),
    description: z.string(),
    transitionsTo: z.array(z.string()),
  })
);

/** Load label definitions from labels.json (SSOT) */
async function loadLabels(root: string): Promise<LabelDef[]> {
  const rel = "labels.json";
  if (!isAllowedPath(rel, root)) return [];
  const full = path.join(root, rel);
  let raw: string;
  try {
    raw = await fs.readFile(full, "utf-8");
  } catch {
    console.warn("[pipeline] labels.json not found, skipping label loading");
    return [];
  }
  try {
    return LabelDefSchema.parse(JSON.parse(raw));
  } catch (err) {
    console.error(
      "[pipeline] labels.json is invalid:",
      (err as Error).message
    );
    return [];
  }
}

/** Derive a project:// URI from a spec doc path */
function specDocToUri(docPath: string): string {
  if (docPath === "README.md") return "project://overview";
  return `project://${docPath.replace(/^docs\//, "").replace(/\.md$/, "")}`;
}

/** Build spec-layer resources from loaded documents */
function buildSpecResources(
  specDocs: { path: string; content: string; title: string }[],
  generatedAt: string
): ResourceEntry[] {
  return specDocs.map((doc) => ({
    uri: specDocToUri(doc.path),
    title: doc.title,
    kind: "spec" as const,
    sourceFiles: [doc.path],
    summary: doc.title,
    content: doc.content,
    knownGaps: [],
    generatedAt,
  }));
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

/** Information layer: spec (human-maintained) > derived (generated) > raw */
export type InfoKind = "spec" | "derived" | "raw";

/** Label definition from labels.json (SSOT) */
export interface LabelDef {
  name: string;
  color: string;
  meaning: string;
  description: string;
  transitionsTo: string[];
}

/** A loaded spec document */
export interface SpecDoc {
  path: string;
  content: string;
  title: string;
}

/** Parsed Makefile target */
export interface MakeTarget {
  name: string;
  comment: string;
  recipe: string;
}

/** Parsed n8n workflow definition */
export interface WorkflowDef {
  fileName: string;
  name: string;
  nodes: WorkflowNode[];
  connections: Record<string, unknown>;
  settings: Record<string, unknown>;
}

export interface WorkflowNode {
  id: string;
  name: string;
  type: string;
  notes?: string;
  parameters: Record<string, unknown>;
}

/** A generated MCP resource entry */
export interface ResourceEntry {
  uri: string;
  title: string;
  kind: InfoKind;
  sourceFiles: string[];
  summary: string;
  content: string;
  knownGaps: string[];
  generatedAt: string;
}

/** Drift item between doc and implementation */
export interface DriftItem {
  area: string;
  docSays: string;
  implSays: string;
  severity: "info" | "warning" | "error";
  sourceFiles: string[];
}

/** Pipeline output: all processed data */
export interface PipelineResult {
  specDocs: SpecDoc[];
  makeTargets: MakeTarget[];
  workflowDefs: WorkflowDef[];
  resources: ResourceEntry[];
  driftItems: DriftItem[];
}

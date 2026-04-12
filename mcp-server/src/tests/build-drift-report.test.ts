import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildDriftReport } from "../pipeline/nodes/build-drift-report.js";
import type { LabelDef, SpecDoc, MakeTarget, WorkflowDef } from "../lib/types.js";

const NOW = "2026-01-01T00:00:00Z";

function makeLabelDefs(...names: string[]): LabelDef[] {
  return names.map((name) => ({
    name,
    color: "#000",
    meaning: `${name} label`,
    description: `${name} description`,
    transitionsTo: [],
  }));
}

function makeWorkflowWithLabels(
  labels: Record<string, string>
): WorkflowDef[] {
  const nodes = Object.entries(labels).map(([name, label], i) => ({
    id: String(i),
    name,
    type: "n8n-nodes-base.httpRequest",
    parameters: {
      filters: { labels: label },
    },
  }));
  return [
    {
      fileName: "test-workflow.json",
      name: "Test Workflow",
      nodes,
      connections: {},
      settings: {},
    },
  ];
}

describe("buildDriftReport", () => {
  it("detects labels in impl but not in spec", () => {
    const labelDefs = makeLabelDefs("ai-ready");
    const workflows = makeWorkflowWithLabels({
      "Check label": "ai-unknown",
    });

    const { items } = buildDriftReport(labelDefs, [], [], workflows, NOW);
    const labelDrift = items.filter(
      (i) => i.area === "ラベル定義" && i.severity === "warning"
    );
    assert.ok(labelDrift.some((i) => i.implSays.includes("ai-unknown")));
  });

  it("detects labels in spec but not in impl", () => {
    const labelDefs = makeLabelDefs("ai-ready", "ai-processing");
    const workflows = makeWorkflowWithLabels({
      "Use ready": "ai-ready",
    });

    const { items } = buildDriftReport(labelDefs, [], [], workflows, NOW);
    const unused = items.filter(
      (i) => i.area === "ラベル定義" && i.severity === "info"
    );
    assert.ok(unused.some((i) => i.docSays.includes("ai-processing")));
  });

  it("detects TODO in workflow command parameters", () => {
    const workflows: WorkflowDef[] = [
      {
        fileName: "wf.json",
        name: "WF",
        nodes: [
          {
            id: "1",
            name: "Placeholder",
            type: "n8n-nodes-base.executeCommand",
            parameters: { command: "echo TODO: implement this" },
          },
        ],
        connections: {},
        settings: {},
      },
    ];

    const { items } = buildDriftReport([], [], [], workflows, NOW);
    const todos = items.filter((i) => i.severity === "error");
    assert.equal(todos.length, 1);
    assert.ok(todos[0].implSays.includes("TODO"));
  });

  it("detects TODO in workflow node notes", () => {
    const workflows: WorkflowDef[] = [
      {
        fileName: "wf.json",
        name: "WF",
        nodes: [
          {
            id: "1",
            name: "NoteNode",
            type: "n8n-nodes-base.noOp",
            notes: "TODO: refactor this",
            parameters: {},
          },
        ],
        connections: {},
        settings: {},
      },
    ];

    const { items } = buildDriftReport([], [], [], workflows, NOW);
    const todos = items.filter((i) => i.severity === "error");
    assert.equal(todos.length, 1);
    assert.ok(todos[0].implSays.includes("notes"));
  });

  it("detects make targets in README but not in Makefile", () => {
    const specDocs: SpecDoc[] = [
      {
        path: "README.md",
        title: "Project",
        content: "Run `make deploy` to deploy.",
      },
    ];
    const makeTargets: MakeTarget[] = [
      { name: "up", comment: "Start", recipe: "docker compose up" },
    ];

    const { items } = buildDriftReport([], specDocs, makeTargets, [], NOW);
    const makeDrift = items.filter(
      (i) => i.area === "make コマンド" && i.severity === "warning"
    );
    assert.ok(makeDrift.some((i) => i.implSays.includes("deploy")));
  });

  it("detects undocumented make targets", () => {
    const specDocs: SpecDoc[] = [
      {
        path: "README.md",
        title: "Project",
        content: "Run `make up` to start.",
      },
    ];
    const makeTargets: MakeTarget[] = [
      { name: "up", comment: "Start", recipe: "docker compose up" },
      { name: "secret-target", comment: "Hidden", recipe: "echo secret" },
    ];

    const { items } = buildDriftReport([], specDocs, makeTargets, [], NOW);
    const undocumented = items.filter(
      (i) => i.area === "make コマンド" && i.severity === "info"
    );
    assert.ok(undocumented.some((i) => i.implSays.includes("secret-target")));
  });

  it("generates resource with correct summary", () => {
    const workflows: WorkflowDef[] = [
      {
        fileName: "wf.json",
        name: "WF",
        nodes: [
          {
            id: "1",
            name: "Todo",
            type: "n8n-nodes-base.executeCommand",
            parameters: { command: "TODO" },
          },
        ],
        connections: {},
        settings: {},
      },
    ];

    const { resource, items } = buildDriftReport([], [], [], workflows, NOW);
    assert.equal(resource.uri, "project://drift-report");
    assert.equal(resource.kind, "derived");
    assert.ok(resource.summary.includes(`${items.length} 件`));
  });
});

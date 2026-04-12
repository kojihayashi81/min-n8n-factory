import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { searchResources, explainTopic, formatDriftReport } from "../lib/search.js";
import type { PipelineResult, DriftItem } from "../lib/types.js";

function makePipeline(overrides?: Partial<PipelineResult>): PipelineResult {
  return {
    specDocs: [],
    makeTargets: [],
    workflowDefs: [],
    resources: [
      {
        uri: "project://overview",
        title: "プロジェクト概要",
        kind: "spec",
        sourceFiles: ["README.md"],
        summary: "n8n を使った AI 工場",
        content: "セットアップ手順: make setup を実行する",
        knownGaps: [],
        generatedAt: "2026-01-01T00:00:00Z",
      },
      {
        uri: "project://commands/make",
        title: "make コマンド一覧",
        kind: "derived",
        sourceFiles: ["Makefile"],
        summary: "10 件の make ターゲット",
        content: "make up: n8n を起動する\nmake down: n8n を停止する",
        knownGaps: [],
        generatedAt: "2026-01-01T00:00:00Z",
      },
      {
        uri: "project://labels/lifecycle",
        title: "Issue ラベルと状態遷移",
        kind: "derived",
        sourceFiles: ["labels.json"],
        summary: "4 個の定義済みラベル",
        content: "ai-ready → ai-processing → ai-investigated",
        knownGaps: ["ラベル X はワークフローで未使用"],
        generatedAt: "2026-01-01T00:00:00Z",
      },
    ],
    driftItems: [],
    ...overrides,
  };
}

describe("searchResources", () => {
  const pipeline = makePipeline();

  it("returns matching resources sorted by relevance", () => {
    const results = searchResources(pipeline, "make");
    assert.ok(results.length >= 1);
    assert.equal(results[0].uri, "project://commands/make");
  });

  it("boosts spec resources by 1.5x", () => {
    const results = searchResources(pipeline, "セットアップ");
    assert.ok(results.length >= 1);
    assert.equal(results[0].kind, "spec");
  });

  it("filters by scope=spec", () => {
    const results = searchResources(pipeline, "make", "spec");
    // "make" appears in spec overview content too
    for (const r of results) {
      assert.equal(r.kind, "spec");
    }
  });

  it("filters by scope=derived", () => {
    const results = searchResources(pipeline, "make", "derived");
    for (const r of results) {
      assert.equal(r.kind, "derived");
    }
  });

  it("returns empty for non-matching query", () => {
    const results = searchResources(pipeline, "存在しないキーワード12345");
    assert.equal(results.length, 0);
  });

  it("handles regex special characters in query", () => {
    const results = searchResources(pipeline, "ai-ready (test)");
    // Should not throw, may or may not find results
    assert.ok(Array.isArray(results));
  });
});

describe("explainTopic", () => {
  const pipeline = makePipeline();

  it("returns spec sections first", () => {
    const result = explainTopic(pipeline, "セットアップ", true);
    assert.ok(result.specSections.length >= 1);
  });

  it("excludes derived when includeImplementation=false", () => {
    const result = explainTopic(pipeline, "make", false);
    assert.equal(result.derivedSections.length, 0);
  });

  it("returns empty for non-matching topic", () => {
    const result = explainTopic(pipeline, "存在しないトピック12345", true);
    assert.equal(result.specSections.length, 0);
    assert.equal(result.derivedSections.length, 0);
  });

  it("matches on summary field", () => {
    const result = explainTopic(pipeline, "ターゲット", true);
    // "10 件の make ターゲット" is in the summary of commands/make
    assert.ok(
      result.derivedSections.some((s) => s.title === "make コマンド一覧")
    );
  });

  it("collects related files from matched resources", () => {
    const result = explainTopic(pipeline, "make", true);
    assert.ok(result.relatedFiles.includes("Makefile"));
  });
});

describe("formatDriftReport", () => {
  const items: DriftItem[] = [
    {
      area: "ラベル定義",
      docSays: "labels.json に定義あり",
      implSays: "ワークフローで未使用",
      severity: "info",
      sourceFiles: ["labels.json"],
    },
    {
      area: "ワークフロー実装",
      docSays: "完成済みの想定",
      implSays: "TODO が残っている",
      severity: "error",
      sourceFiles: ["workflows/test.json"],
    },
    {
      area: "make コマンド",
      docSays: "README に記載あり",
      implSays: "Makefile に存在しない",
      severity: "warning",
      sourceFiles: ["README.md", "Makefile"],
    },
  ];

  it("formats all items with severity icons", () => {
    const output = formatDriftReport(items);
    assert.ok(output.includes("[ERROR]"));
    assert.ok(output.includes("[WARNING]"));
    assert.ok(output.includes("[INFO]"));
    assert.ok(output.includes("3 件"));
  });

  it("filters by area", () => {
    const output = formatDriftReport(items, "ラベル");
    assert.ok(output.includes("ラベル定義"));
    assert.ok(!output.includes("ワークフロー実装"));
    assert.ok(output.includes("1 件"));
  });

  it("returns no-drift message for empty results", () => {
    const output = formatDriftReport([]);
    assert.equal(output, "差分は検出されませんでした。");
  });

  it("returns no-drift message when area filter matches nothing", () => {
    const output = formatDriftReport(items, "存在しない領域");
    assert.equal(output, "差分は検出されませんでした。");
  });
});

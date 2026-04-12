# MCP サーバー 現行構成

このドキュメントは、`mcp-docs` サーバーの現行構成をまとめたものである。設計判断の背景は [design.md](./design.md)、未実装・将来検討は [future.md](./future.md) を参照。

---

## 概要

- TypeScript SDK + Streamable HTTP トランスポート
- `compose.mcp.yml` で `n8n` とは分離して起動
- `make mcp-up` / `make mcp-down` でライフサイクル管理
- 接続先: `http://127.0.0.1:3100/mcp`（`.mcp.json` に設定済み）

---

## 公開リソース

パイプラインが起動時に生成し、MCP Resources として公開するデータ。

| URI | 種別 | 内容 | ソース |
| --- | --- | --- | --- |
| `project://overview` | `spec` | プロジェクト概要 | `README.md` |
| `project://setup` | `spec` | セットアップ手順 | `docs/setup.md` |
| `project://skills` | `spec` | Claude Skills 運用方針 | `docs/claude-skills-best-practices.md` |
| `project://commands/make` | `derived` | make ターゲット一覧と説明 | `Makefile` |
| `project://labels/lifecycle` | `derived` | Issue ラベルと状態遷移の要約 | `docs/setup.md`, `workflows/*.json` |
| `project://workflows/ai-issue-processor` | `derived` | 調査フローの説明 | `workflows/ai-issue-processor.json` |
| `project://workflows/ai-stuck-cleanup` | `derived` | スタック検知と復旧フロー | `workflows/ai-stuck-cleanup.json` |
| `project://drift-report` | `derived` | 仕様と実装の差分候補一覧 | `docs/`, `Makefile`, `workflows/` |

### リソースメタデータ

各リソースは本文に加えて以下のメタデータを持つ。

| フィールド | 説明 |
| --- | --- |
| `kind` | `spec` / `derived` / `raw` |
| `sourceFiles` | 元ファイルのパス一覧 |
| `generatedAt` | 生成日時（ISO 8601） |
| `summary` | リソースの概要 |
| `knownGaps` | 未確定事項・TODO の一覧 |

型定義: `mcp-server/src/lib/types.ts` の `ResourceEntry`

---

## 公開ツール

### `search_project_knowledge`

ドキュメントと実装要約を横断検索する。キーワードマッチ + 出現回数スコアリング方式。`spec` リソースにはスコア 1.5 倍のブーストを適用している。

| パラメータ | 型 | 説明 |
| --- | --- | --- |
| `query` | `string` | 検索キーワード |
| `scope` | `"all" \| "spec" \| "derived"` | 検索範囲（デフォルト: `all`） |

入力バリデーション: Zod スキーマで実施。

### `explain_project_topic`

特定トピックを仕様優先でまとめて返す。`spec` を先に要約し、`derived` で補足する構成。

| パラメータ | 型 | 説明 |
| --- | --- | --- |
| `topic` | `string` | 説明してほしいトピック |
| `includeImplementation` | `boolean` | 実装由来の補足を含めるか（デフォルト: `true`） |

### `detect_doc_impl_drift`

ドキュメントと実装のズレ候補を返す。

| パラメータ | 型 | 説明 |
| --- | --- | --- |
| `area` | `string?` | 検出対象の絞り込み（省略時は全領域） |

現在の検出対象:

- **ラベル定義**: 仕様と実装のラベル差分（severity: warning/info）
- **ワークフロー TODO**: command パラメータに `TODO` を含むノード（severity: error）
- **make コマンド**: README の記載と Makefile のターゲットの差分（severity: warning/info）

---

## パイプライン

起動時に実行される DAG 型パイプライン。3 フェーズで順に処理する。

```text
Phase 1 (並列):  loadSpecDocs / loadMakefile / loadWorkflows
Phase 2 (順次):  buildSpecResources → buildMakeCommands → buildWorkflowSummaries → buildLabelsLifecycle
Phase 3 (順次):  buildDriftReport
```

### ノード一覧

| ノード | 入力 | 出力 | ファイル |
| --- | --- | --- | --- |
| `loadSpecDocs` | README.md, docs/*.md | specDocs | `pipeline/nodes/load-spec-docs.ts` |
| `loadMakefile` | Makefile | makeTargets | `pipeline/nodes/load-makefile.ts` |
| `loadWorkflows` | workflows/*.json | workflowDefs | `pipeline/nodes/load-workflows.ts` |
| `buildMakeCommands` | makeTargets | makeResource | `pipeline/nodes/build-make-commands.ts` |
| `buildWorkflowSummaries` | workflowDefs | workflowResources | `pipeline/nodes/build-workflow-summaries.ts` |
| `buildLabelsLifecycle` | specDocs, workflowDefs | labelsResource | `pipeline/nodes/build-labels-lifecycle.ts` |
| `buildDriftReport` | specDocs, makeTargets, workflowDefs | driftResource, driftItems | `pipeline/nodes/build-drift-report.ts` |

パイプラインのオーケストレーション: `mcp-server/src/pipeline/run-pipeline.ts`

### キャッシュ

起動時に全リソースを in-memory にキャッシュする。ファイル変更を反映するにはコンテナの再起動が必要。

---

## セキュリティ

### 公開対象の制限

Docker マウントとアプリケーション両方で公開範囲を制限している。

- **Docker マウント（`compose.mcp.yml`）**: `README.md`, `docs/`, `workflows/`, `templates/`, `scripts/`, `Makefile` のみ read-only マウント
- **アプリケーション allowlist（`mcp-server/src/lib/allowlist.ts`）**: 許可プレフィックスと拒否パターンで二重に制限

`.env`、`data/`、`.git/`、`node_modules/` は公開しない。

### DNS リバインディング対策

Express ミドルウェアで Host ヘッダーを検証し、`localhost` と `127.0.0.1` 以外からのリクエストを拒否する。

実装: `mcp-server/src/index.ts` の Host ヘッダー検証ミドルウェア

### HTTP メソッド制限

`/mcp` エンドポイントは POST のみ受け付ける。GET と DELETE は 405 を返す。

### ヘルスチェック

`GET /health` でサーバーの稼働状態を確認できる。

```json
{"status": "ok", "resources": 8, "driftItems": 3}
```

---

## Compose 構成

設定ファイル: `compose.mcp.yml`

主要な設定:

- ポート公開: `127.0.0.1:3100:3100`（ローカル限定）
- 環境変数: `MCP_PORT=3100`, `MCP_ROOT=/workspace`
- restart: `"no"`（オンデマンド起動）
- read-only マウント

詳細は `compose.mcp.yml` を直接参照。

---

## クライアント接続

`.mcp.json` に設定済み。Claude Code セッションから自動的に接続される。

```json
{
  "mcpServers": {
    "mcp-docs": {
      "type": "http",
      "url": "http://127.0.0.1:3100/mcp"
    }
  }
}
```

---

## 関連資料

- [設計判断](./design.md) — なぜこう作ったか
- [精度評価ガイド](./evaluation-guide.md) — ツールとパイプラインの評価手順
- [将来検討](./future.md) — 未実装の構想

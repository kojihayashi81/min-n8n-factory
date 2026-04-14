# ai-issue-processor

`ai-ready` ラベルが付いた GitHub Issue を検知して Claude Code を起動し、調査結果を Draft PR にまとめるメインの調査ワークフロー。

## 目的

人間が Issue に `ai-ready` ラベルを付けたら、Claude Code が自動で調査・仕様化・Draft PR 作成までを行う。人間は承認と最終レビューだけに集中できるようにする。

## トリガー

10 分間隔の Schedule Trigger。

## ラベルのライフサイクル

```text
ai-ready → ai-processing → ai-investigated （成功）
                         ↘ ai-failed       （失敗）
```

- `ai-ready`: 人間が調査を依頼する起点
- `ai-processing`: n8n が処理中の状態。二重起動防止のガードにも使う
- `ai-investigated`: 調査完了、Draft PR 作成済み
- `ai-failed`: タイムアウトまたはエラー発生。人間がリトライ判断する

再試行時(`ai-failed → ai-ready` の付け直し)は、初回実行時の Slack スレッドに処理開始 / 成功 / 失敗の通知が追記される。Issue と Slack スレッドが 1:1 で紐付くため、履歴を 1 か所で追える。

## エージェントパイプライン（概要）

`Run Claude Code` ノードが呼び出すシェルスクリプト内で、4 段のエージェントパイプラインを実行する。各エージェントは独立した `claude --print` 呼び出しで、役割に特化したシステムプロンプトを持つ。

```text
Collector → Code Investigator → Web Investigator → Synthesizer → Gatekeeper
                                                      ↑___ (条件付き再実行) _|
```

- **Collector**: Issue 本文を解析し、後続エージェントに渡すコンテキストを構造化する
- **Code Investigator**: コードベースを調査し、関連ファイル・影響範囲・Web 検索ヒントを出す
- **Web Investigator**: Code の調査結果を踏まえて外部情報を調査する
- **Synthesizer**: Code と Web の結果を統合して調査ノート（Markdown）を生成する
- **Gatekeeper**: 調査ノートの品質を採点し、基準未満なら Synthesizer を 1 回だけ再実行する

各エージェントの入出力スキーマ・採点基準・再実行ポリシー・エラーハンドリング・コスト構造は [agent_pipeline.md](./agent_pipeline.md) を参照。

## 関連ドキュメント

| ファイル                                 | 内容                                                                                                                                         |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| [architecture.md](./architecture.md)     | ワークフローの全体像、DevContainer + Worktree + 4 段パイプラインを採用した理由、コンポーネント構成、各スクリプトの役割                       |
| [flow.md](./flow.md)                     | 実行フローの全体図、n8n ノードの役割表、タイムアウトとリトライの設定                                                                         |
| [slack.md](./slack.md)                   | Slack 通知の設計（1 Issue = 1 スレッド集約、品質スコア通知、失敗通知の情報量、`message_timestamp` 永続化のメカニズム、テンプレート管理）     |
| [agent_pipeline.md](./agent_pipeline.md) | 4 段エージェントパイプラインの設計詳細（各エージェントの JSON スキーマ、採点基準、エラーハンドリング、コスト構造）                           |

## 関連ワークフロー

- [ai-stuck-cleanup](../ai-stuck-cleanup.md) — タイムアウト・中断で `ai-processing` のまま残った Issue を回収する

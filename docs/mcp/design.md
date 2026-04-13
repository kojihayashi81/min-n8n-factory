# MCP サーバー設計判断

このドキュメントは、`mcp-docs` サーバーの設計判断とその背景を記録したものである。現行の構成仕様は [architecture.md](./architecture.md)、未実装・将来検討は [future.md](./future.md) を参照。

関連資料:

- [ローカル MCP サーバー（コンテナ）実装調査](./local-container-server-research.md)

---

## 目的

このプロジェクトでは、仕様に関わる情報が以下に分散している。

- `README.md`
- `docs/setup.md`
- `docs/claude-skills-best-practices.md`
- `Makefile`
- `workflows/ai-issue-processor.json`
- `workflows/ai-stuck-cleanup.json`

AI に次のような質問をしたいときに、複数ファイルを横断しないと正確に答えにくい。

- セットアップ手順は何か
- `make` コマンドは何をするか
- `ai-ready` からどう状態遷移するか
- タイムアウト時にどう復旧するか
- 対象リポジトリに何を配布するか

MCP サーバーでプロジェクト固有のコンテキストを公開し、AI が整理済みの仕様と実装要約を参照できるようにする。

---

## 狙う効果

1. 仕様問い合わせの即答
2. 実装と運用手順の参照コスト削減
3. ドキュメントと実装の差分の見える化

特に重要なのは 3 点目である。ラベル定義の乖離やワークフローノードの TODO 残りなど、仕様と実装のズレが実際に発生した経験がある。

---

## アーキテクチャ判断

### Compose を分離した理由

`n8n` は常時稼働、`mcp-docs` はオンデマンド起動。ライフサイクルが異なるため、同じ Compose に同居させると以下の問題が出る。

- `n8n` 起動時に不要な MCP コンテナまで上がる
- ログ、再起動、障害切り分けが混ざる
- リソース予約が増える

そのため `compose.mcp.yml` として分離し、`make mcp-up` / `make mcp-down` で必要時だけ起動する構成とした。

### HTTP トランスポートを選んだ理由

`stdio` だけを前提にすると、Docker 経由の接続設定がクライアントごとに重くなりやすい。ローカルコンテナで常駐させるなら HTTP エンドポイント化した方が扱いやすい。

接続先: `http://127.0.0.1:3100/mcp`

### RAG を導入しなかった理由

このプロジェクトの公開対象ファイルは数十ファイル程度であり、大規模な意味検索は不要。小さい DAG でファイルを読み込み → 要約生成 → リソース公開する前処理パイプラインで十分対応できる。

---

## 設計原則

### 1. 仕様を最優先で公開する

AI がまず参照すべきなのは、README や `docs/` のような人間が保守する仕様文書である。

### 2. 実装説明は生成物として分離する

`Makefile` や `workflows/*.json` から生成した要約は有用だが、仕様そのものではない。`derived` として区別する。

### 3. 生ファイル参照は最後の手段にする

原文コードや JSON を直接読ませる機能は残してよいが、既定の回答は整理済みリソースを優先する。

### 4. 出典を必ず返す

各リソースには、元ファイルと生成時刻を付ける。AI の回答側でも出典を添えやすくする。

### 5. 秘密情報に触れさせない

`.env`、`data/`、認証情報、1Password 由来の値は公開対象から除外する。

### 6. コンテナには公開対象だけをマウントする

アプリケーション側で denylist を持つだけでなく、Docker のマウント対象そのものを絞る。

---

## 情報レイヤー

MCP サーバーでは、情報を次の 3 レイヤーに分けて扱っている。

| レイヤー  | 意味                       | 例                             | 優先度 |
| --------- | -------------------------- | ------------------------------ | ------ |
| `spec`    | 人間が保守する正式仕様     | `README.md`, `docs/setup.md`   | 高     |
| `derived` | 実装から抽出・要約した説明 | ワークフローの状態遷移要約     | 中     |
| `raw`     | 生ファイル参照             | `workflows/*.json`, `Makefile` | 低     |

AI に返す回答も、原則として次の順に構成する。

1. `spec` から要点を回答
2. 必要なら `derived` で補足
3. 最後に `raw` の参照先を示す

---

## 回答品質ルール

### 1. TODO や未確定事項を露出する

コメントやノートに TODO がある場合は隠さない。`knownGaps` に出す。

### 2. 仕様と実装が食い違うときは両方返す

片方を消すのではなく、以下のように返す。

- 仕様上はこう書かれている
- 実装上はこう動いている
- どちらを正とするかは要確認

### 3. 曖昧な質問には関連リソースを複数返す

例: 「ワークフローどうなってる?」には `overview`, `labels/lifecycle`, `workflows/issue-processor` を返す。

---

## この設計で避けたい失敗

- 生コードだけを公開して、AI が TODO を正式仕様として話してしまう
- `.env` や認証情報まで読める設計にしてしまう
- 全ファイルを無差別に検索し、ノイズが増える
- 出典なしで AI が断定的に回答する
- 小さな前処理で済むのに、RAG や重いワークフロー基盤を先に入れて複雑化する

---

## 実装経緯

MCP サーバーの実装には Claude Code の公式 Skill（`mcp-builder`）を使用した。TypeScript SDK + Streamable HTTP トランスポートの構成で、Skill のガイドに沿って構築している。

<details>
<summary>段階的導入計画（アーカイブ）</summary>

以下の Phase 1-3 は実装完了済み。導入時の計画として記録を残す。

### Phase 1: 仕様ドキュメント公開

対象: `project://overview`, `project://setup`, `project://skills`

`compose.mcp.yml` で `mcp-docs` コンテナをローカル起動し、ホスト側クライアントから接続できる状態を作った。

### Phase 2: 実装由来の要約追加

対象: `project://commands/make`, `project://workflows/*`, `project://labels/lifecycle`

小さい DAG を有効化し、`build*` ノードで `derived` リソースを生成するようにした。

### Phase 3: 差分検出

対象: `project://drift-report`, `detect_doc_impl_drift` ツール

仕様の問い合わせだけでなくメンテナンス補助にも使えるようになった。

</details>

<details>
<summary>MVP スコープ（アーカイブ）</summary>

以下の MVP は達成済み。初期スコープの記録として残す。

リソース:

1. `project://overview`
2. `project://setup`
3. `project://commands/make`
4. `project://workflows/issue-processor`
5. `project://workflows/stuck-cleanup`

ツール:

1. `search_project_knowledge`

ローカル運用:

1. `compose.mcp.yml` の新設
2. `127.0.0.1` 限定のポート公開
3. 公開対象のみの read-only マウント
4. 8 ノードの小さい DAG 実装

実際の実装では MVP を超えて、3 ツールすべてと `project://labels/lifecycle`、`project://drift-report` も初回リリースに含めた。

</details>

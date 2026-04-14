# ローカル MCP サーバー（コンテナ）実装調査

このメモは、`min-n8n-factory` で「`n8n` 用 Compose とは分離した専用 Compose により、ローカル MCP サーバーを必要時だけ起動し、ホスト側の AI クライアントから問い合わせる」構成を実装するための調査結果をまとめたものである。

調査日は 2026-04-06。

関連設計:

- [MCPサーバー設計案](./README.md)

---

## 結論

このプロジェクトでは、ローカル MCP サーバーをコンテナで動かす方式として、次を推奨する。

1. `Streamable HTTP` を使う
2. `mcp-docs` を独立コンテナとして起動する
3. `n8n` 用 Compose とは別の `compose.mcp.yml` で起動する
4. ホスト公開は `127.0.0.1:3100` のみに限定する
5. TypeScript SDK の現行 split packages を使う
6. MVP は `stateless` で始める
7. 公開対象ファイルだけを read-only マウントする

この条件なら、ホスト側クライアントは `http://127.0.0.1:3100/mcp` に接続するだけでよい。`stdio` 方式も可能ではあるが、このリポジトリの想定運用では HTTP の方が素直である。

---

## 公式仕様から押さえる点

MCP の標準トランスポートは 2 つである。

- `stdio`
- `Streamable HTTP`

仕様上、`stdio` は「クライアントがサーバーを子プロセスとして起動し、stdin/stdout で通信する」方式である。一方 `Streamable HTTP` は「サーバーが独立プロセスとして動き、HTTP POST/GET と必要に応じて SSE を使う」方式である。

ローカルコンテナを常駐させてホストから問い合わせる用途では、後者の性質がそのまま合っている。

また、現行仕様では `Streamable HTTP` は旧 `HTTP+SSE` を置き換えるものとして定義されている。新規実装で旧 transport を前提にする理由はない。

セキュリティ面では、仕様上 `Streamable HTTP` 実装に対して次が求められている。

- `Origin` ヘッダーの検証
- ローカル実行時は `127.0.0.1` への bind を推奨
- 適切な認証の実装を推奨

このため、コンテナ実装でも「ローカルだから安全」とは扱わず、少なくとも `localhost` bind とリクエスト検証は前提にするべきである。

---

## 実装方式の比較

### 1. TypeScript + Streamable HTTP + Express

最も有力な選択肢である。

理由:

- MCP 公式の TypeScript SDK に現行の server package がある
- `@modelcontextprotocol/node` と `@modelcontextprotocol/express` が用意されている
- 公式ドキュメントが `Streamable HTTP` と `stdio` の両方を明示的にサポートしている
- Express helper は Host header validation を含む
- 既存リポジトリが Docker / Makefile / JSON ワークフロー中心で、Node 系の導入コストが低い

向いているケース:

- ローカル常駐コンテナ
- 専用 Compose でのオンデマンド起動
- `workflows/` や `docs/` を読んで Resources を返す用途

推奨度:

- `高`

### 2. TypeScript + Streamable HTTP + Hono

Express の代替として成立する。

理由:

- 公式に `@modelcontextprotocol/hono` がある
- Hono helper も Host header validation を提供する
- 将来的に Web Standard runtime に寄せやすい

ただし、この repo では Hono を既に使っているわけではないため、Express より優位性は薄い。

推奨度:

- `中`

### 3. Python + FastMCP + Streamable HTTP

実装自体は可能で、公式 Python SDK の Quick Example でも `transport="streamable-http"` が示されている。

ただし、この repo には Python 前提の基盤がない。Node/TypeScript で揃えた方が、コンテナ、ビルド、開発者体験を統一しやすい。

推奨度:

- `中`

### 4. stdio サーバーを `docker run -i` で包む方式

これは仕様上は成立する。`stdio` が「クライアントが子プロセスを起動する」モデルなので、子プロセスコマンドとして `docker run --rm -i ...` を呼ぶ形にすればよい。

ただしこれは公式仕様からの推論であり、今回の運用には向かない。

弱い点:

- クライアント設定がツールごとに重くなる
- コンテナ起動コストが問い合わせごとに乗る
- ホストから `localhost:3100` のように共通 URL で扱えない
- デバッグしにくい

推奨度:

- `低`

---

## TypeScript 実装の現行前提

2026-04-06 時点の公式 TypeScript SDK は、monorepo だが配布は split packages になっている。

主要パッケージ:

- `@modelcontextprotocol/server`
- `@modelcontextprotocol/client`
- `@modelcontextprotocol/node`
- `@modelcontextprotocol/express`
- `@modelcontextprotocol/hono`

新規実装なら、`@modelcontextprotocol/server` を中心に始めるのが自然である。v1 世代の docs は `v1.x` branch 側に分かれているため、新しく作るローカル MCP サーバーは legacy 前提にしない方がよい。

> **実装時の補足（2026-04-12）**: 実際の実装では上記の split packages ではなく、統合パッケージ `@modelcontextprotocol/sdk` を使用した。SDK のバージョンアップにより split packages が統合されたためである。

---

## 推奨アーキテクチャ

### 構成

```text
Host AI client
  -> http://127.0.0.1:3100/mcp
  -> mcp-docs container
  -> read-only mounted files
  -> MCP Resources / Tools
```

### コンテナ分離

`n8n` と `mcp-docs` は分けるべきである。さらに Compose も分けるべきである。

理由:

- 障害分離しやすい
- ワークフロー実行と問い合わせ応答の責務が分かれる
- MCP 側だけ独立して再起動・更新しやすい
- 公開マウント範囲を最小化しやすい
- `n8n` は常時稼働でも、`mcp-docs` は必要時だけ起動できる
- 常駐の `n8n` に不要な CPU / メモリを割かずに済む

### Compose 分離

構成は次のように分ける。

- `docker-compose.yml`: `n8n` 常駐用
- `compose.mcp.yml`: `mcp-docs` オンデマンド用

これにより、MCP を使わない時間帯は `mcp-docs` を完全に止めておける。

### ポート公開

Docker 側では次のようにホスト公開を絞る。

```yaml
ports:
  - '127.0.0.1:3100:3100'
```

`0.0.0.0:3100:3100` は避ける。

### ボリューム

公開対象だけを read-only で載せる。

```yaml
volumes:
  - ./README.md:/workspace/README.md:ro
  - ./docs:/workspace/docs:ro
  - ./workflows:/workspace/workflows:ro
  - ./templates:/workspace/templates:ro
  - ./scripts:/workspace/scripts:ro
  - ./Makefile:/workspace/Makefile:ro
```

載せないもの:

- `.env`
- `data/`
- Git 認証情報
- 1Password/PAT 由来の値

---

## セッション設計

公式 SDK では、`NodeStreamableHTTPServerTransport` に `sessionIdGenerator` を渡すと stateful session、`undefined` にすると stateless mode にできる。ドキュメント上も、stateless mode はより単純だが resumability を持たないと明記されている。

この repo の用途では、MVP は stateless で十分である。

### stateless を勧める理由

- `search_project_knowledge` のような read-only 問い合わせが中心
- 長時間ストリーミングや server-initiated notification を初期段階で必要としない
- セッションストアや event store を持たなくてよい
- コンテナ再起動時の考慮が減る

### stateful が必要になる条件

- 長時間処理の進捗通知を返したい
- SSE 再接続や resumability を本格的に扱いたい
- 将来 multi-node 配備に広げたい

まずは stateless、必要になったら stateful に上げる方が堅い。

---

## 実装パターン

### パターン A: stateless Streamable HTTP

MVP 向け。

特徴:

- 単一コンテナ
- in-memory キャッシュのみ
- セッションストア不要
- `docs/` と `workflows/` の read-only 参照用途に十分

向いている機能:

- Resources の列挙
- Resource Templates
- 説明系 Tool
- 小さい DAG による `derived` リソース生成

### パターン B: stateful Streamable HTTP

機能拡張向け。

特徴:

- `sessionIdGenerator` を使う
- 必要なら event store を持つ
- SSE 再接続や通知を扱える

向いている機能:

- 長時間タスク
- 進捗通知
- 将来的な interactive workflow

### パターン C: JSON response mode

TypeScript SDK では `enableJsonResponse: true` により、SSE を使わず plain JSON を返す構成も選べる。

このモードは扱いやすいが、通知や streaming の柔軟性は下がる。MVP では候補になるが、MCP クライアント側の相性確認は必要である。

---

## この repo に合う最小実装

### 推奨スタック

- 言語: TypeScript
- Web: Express
- MCP packages:
  - `@modelcontextprotocol/sdk`（統合パッケージ。調査時の split packages は統合済み）
- バリデーション: `zod` または Standard Schema 互換ライブラリ
- 実行形態: `Streamable HTTP`
- セッション: stateless
- 起動単位: `compose.mcp.yml`

### 役割

- `McpServer`: Resources / Tools / Prompts の登録
- `NodeStreamableHTTPServerTransport`: MCP over HTTP
- `createMcpExpressApp`: HTTP app と Host header validation
- 独自 pipeline: `spec` と `derived` の生成

### 返すもの

最初に返すべきなのは次で十分である。

- `project://overview`
- `project://setup`
- `project://commands/make`
- `project://workflows/issue-processor`
- `project://workflows/stuck-cleanup`
- `search_project_knowledge`

---

## 実装ステップ案

1. `mcp-server/` ディレクトリを新設する
2. TypeScript の最小 app を作る
3. `McpServer` に `project://overview` と `project://setup` を登録する
4. `NodeStreamableHTTPServerTransport` を `/mcp` に配線する
5. `127.0.0.1:3100` に bind する
6. `compose.mcp.yml` を新設する
7. `docs/`, `workflows/`, `Makefile` だけを read-only mount する
8. 小さい DAG で `derived` リソースを生成する
9. `search_project_knowledge` を実装する
10. Inspector で動作確認する

---

## テストとデバッグ

公式の `MCP Inspector` は、MCP サーバーのテスト・デバッグ用ツールとして案内されている。ローカル開発サーバーの確認にも使える。

Python SDK の公式ドキュメントでも、`streamable-http` で起動したサーバーに対して Inspector を開き、`http://localhost:8000/mcp` に接続する流れが示されている。つまり、HTTP エンドポイント化したローカル MCP サーバーを Inspector で確認するのは公式想定の範囲内である。

最低限やるべき確認:

- `/mcp` に接続できる
- Resources 一覧が出る
- `project://overview` を取得できる
- Tool 呼び出し時のエラーが `isError` で返る
- `localhost` 以外の Host/Origin を拒否できる

---

## 実装上の注意

### 1. DNS rebinding 対策

仕様は `Origin` 検証を要求しており、TypeScript SDK docs は localhost サーバーに Host header validation を勧めている。したがって、実装では両方を前提に考えるべきである。

不明点:

- `createMcpExpressApp` がどこまで `Origin` 検証を吸収するかは、実装時に実パッケージの挙動確認が必要

安全側の判断としては、helper に加えて自前 middleware で `Origin` / Host を明示検証できるようにしておくとよい。

### 2. raw ファイルの出しすぎ

`project://file/{path}` は便利だが、allowlist 前提にする。

### 3. 旧 HTTP+SSE を前提にしない

新規実装は `Streamable HTTP` を使う。旧 transport 互換は必要になってから考える。

### 4. セッションを先に重くしない

この repo の MVP は stateful session や external event store を必要としていない。

---

## この repo 向けの最終推奨

`min-n8n-factory` では、次の構成で始めるのが最も合理的である。

- `docker-compose.yml` は `n8n` 専用のまま維持
- `compose.mcp.yml` を MCP 専用として新設
- TypeScript + Express + MCP official server packages を使用
- `Streamable HTTP` を `/mcp` で提供
- `127.0.0.1` bind のみ
- stateless mode で開始
- `docs/`, `workflows/`, `templates/`, `scripts/`, `Makefile` だけを read-only mount
- 小さい DAG で `derived` リソースを生成
- Inspector で接続確認

`stdio in Docker` は可能だが、今回の「コンテナを立ち上げて localhost で問い合わせる」という要件には合わない。HTTP 常駐サーバーの方が、接続、デバッグ、運用のすべてで単純である。

---

## 参考ソース

2026-04-06 時点で確認した主な一次ソースは以下。

- MCP Specification: Transports
  - <https://modelcontextprotocol.io/specification/2025-11-25/basic/transports>
- MCP TypeScript SDK repository
  - <https://github.com/modelcontextprotocol/typescript-sdk>
- MCP TypeScript SDK server guide
  - <https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md>
- MCP TypeScript SDK server examples
  - <https://github.com/modelcontextprotocol/typescript-sdk/blob/main/examples/server/README.md>
- MCP Inspector docs
  - <https://modelcontextprotocol.io/docs/tools/inspector>
- MCP Python SDK docs
  - <https://py.sdk.modelcontextprotocol.io/>

# AI Issue Processor アーキテクチャ

## 全体フロー

```text
n8n (Docker コンテナ)
  │ 10分ごとに ai-ready ラベルの Issue をポーリング
  │
  ├─ Issue あり
  │   ├─ 1. ai-processing ラベルを付与
  │   ├─ 2. ホストの対象リポジトリに git worktree を作成
  │   ├─ 3. worktree 上で DevContainer を起動
  │   ├─ 4. DevContainer 内で claude --print "/investigate {number}" を実行
  │   ├─ 5. 調査結果を Markdown で保存・コミット・PR 作成
  │   └─ 6. Issue にコメント投稿 → ai-investigated ラベル付与
  │
  └─ Issue なし → 何もしない
```

---

## なぜ DevContainer + Worktree なのか

### 選択の経緯

| 案 | 問題点 |
| --- | --- |
| ホストで直接実行 | ホストに Claude Code・gh CLI をグローバルインストールが必要 |
| SSH 経由でホスト実行 | macOS リモートログイン設定・鍵管理が煩雑。`:ro` マウントで known_hosts 書き込み不可 |
| 専用コンテナ（claude-runner） | 開発者の環境と AI の環境が乖離する |
| **DevContainer + Worktree（採用）** | 開発者と同じ環境で AI が動く・並列実行可能・ホストを汚染しない |

### DevContainer のメリット

- 開発者が VS Code で使う環境と同一 → 「手元では動くのに AI が失敗する」を排除
- 対象リポジトリの Docker Compose も起動可能 → 開発環境を完全に再現
- インターネット接続・ソースコード参照・MCP サーバー参照が可能

### Worktree のメリット

- 並列実行: Issue ごとに独立した作業ディレクトリ
- 高速: `.git` を共有するためクローン不要
- 省ディスク: ソースコードのコピーのみ

---

## コンポーネント構成

```text
min-n8n-factory/
├── docker-compose.yml          # n8n サービス（Docker socket マウント）
├── scripts/
│   ├── create-worktree.sh      # worktree 作成（冪等）
│   ├── start-devcontainer.sh   # DevContainer 起動（冪等）
│   ├── import-workflow.sh      # ワークフロー インポート（冪等）
│   ├── setup-labels.sh         # ラベル配布
│   ├── setup-issue-template.sh # Issue テンプレート配布
│   ├── setup-skills.sh         # Claude Skills 配布
│   └── setup-devcontainer.sh   # DevContainer 設定配布
├── templates/
│   ├── devcontainer/           # DevContainer テンプレート
│   │   ├── Dockerfile          # Claude Code + gh CLI + Node.js
│   │   └── devcontainer.json
│   ├── skills/                 # Claude Skills テンプレート
│   └── scripts/                # 対象リポジトリ用スクリプト
└── workflows/
    └── ai-issue-processor.json # n8n ワークフロー定義

対象リポジトリ（例: gomoku-nextjs）
├── .devcontainer/              # setup-devcontainer で配布済み
├── .claude/commands/           # setup-skills で配布済み
├── .worktrees/                 # .gitignore に追加
│   ├── issue-2/                # Issue #2 用の作業コピー
│   └── issue-5/                # Issue #5 用の作業コピー（並列実行時）
└── src/
```

---

## 各スクリプトの役割

### create-worktree.sh

```bash
# 使い方
PROJECT_PATH=/path/to/repo bash scripts/create-worktree.sh <issue-number>

# 出力: worktree のパス（stdout）
/path/to/repo/.worktrees/issue-42
```

- `main` ブランチから `issues/{number}` ブランチを作成
- 既に worktree が存在する場合はパスだけ返す（冪等）
- リモートにブランチがあればそれをチェックアウト

### start-devcontainer.sh

```bash
# 使い方
bash scripts/start-devcontainer.sh <worktree-path>

# 出力: コンテナ ID（stdout）
d151d705f073...
```

- `devcontainer up` で DevContainer を起動
- 既に起動済みなら再利用（冪等）
- 初回はイメージビルドが発生（2回目以降はキャッシュ利用）

---

## 認証方式

### Claude Code（Max プラン）

`CLAUDE_CODE_OAUTH_TOKEN` 環境変数で認証する。API キーは不要。

- `claude setup-token` で1年間有効な OAuth トークンを生成（[公式ドキュメント](https://code.claude.com/docs/en/authentication#generate-a-long-lived-token)）
- トークンは `.env` に保存 → `docker-compose.yml` で n8n コンテナに渡す → `devcontainer.json` の `remoteEnv` + `${localEnv:...}` で DevContainer に渡る
- Max プランの OAuth トークンは macOS キーチェーンに保存されるため、ファイルマウント方式ではコンテナに渡せない。環境変数方式を採用（[環境変数リファレンス](https://code.claude.com/docs/en/env-vars)）

```bash
# トークン生成
claude setup-token

# .env に保存
CLAUDE_CODE_OAUTH_TOKEN=<生成されたトークン>
```

> 詳細な検討経緯は [run-claude-design.md](run-claude-design.md) を参照。

### GitHub

- **n8n GitHub ノード用**: Fine-grained PAT を n8n Credentials に登録（暗号化保存）
- **DevContainer 内の gh CLI 用**: `GH_TOKEN` 環境変数で渡す（`devcontainer.json` の `remoteEnv`）
- **n8n コンテナ内の git fetch 用**: `GH_TOKEN` で SSH → HTTPS 変換（`git config url.insteadOf`）

---

## n8n ワークフローの実行フロー

```text
Schedule 10min
  → Get oldest ai-ready Issue（Repository → Get Issues + ラベルフィルタ）
  → If（Issue が存在するか: !!$json.number）
  → Set ai-processing label
  → Run Claude Code（create-worktree → start-devcontainer → devcontainer exec claude）
  → Post PR Link to Issue
  → Set ai-investigated label

エラー時:
  → Set ai-failed label
  → Post Error Comment
```

---

## 動作確認済みステップ

| # | ステップ | 状態 | 確認内容 |
| --- | --- | --- | --- |
| 1 | worktree 作成 | 確認済み | `create-worktree.sh` で冪等に worktree 作成・パス返却 |
| 2 | DevContainer 起動 | 確認済み | `start-devcontainer.sh` で冪等にコンテナ起動・ID 返却 |
| 3 | DevContainer 内で claude 実行 | 未着手 | `~/.claude` マウント + `devcontainer exec claude --print` |
| 4 | n8n ワークフロー統合 | 未着手 | Run Claude Code ノードからスクリプトを呼び出す |
| 5 | E2E 動作確認 | 未着手 | ai-ready Issue → 調査 → PR 作成 → コメント投稿 |

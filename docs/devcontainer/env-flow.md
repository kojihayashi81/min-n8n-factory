# Environment Variables & Token Flow

## Architecture Overview

```text
┌────────────────────────────────────────────────────────────────┐
│ Host (macOS)                                                   │
│                                                                │
│  .env (.gitignore'd)                                           │
│  ┌────────────────────────────────────────────────┐            │
│  │ N8N_BASIC_AUTH_USER / PASSWORD / KEY / API     │            │
│  │ GITHUB_REPO=owner/repo ────────────────────────┼──┐         │
│  │ PROJECT_PATH=/Users/.../target-repo ───────────┼──┤         │
│  │ CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-... ──────┼──┤         │
│  │ GH_TOKEN=github_pat_... ───────────────────────┼──┤         │
│  └────────────────────────────────────────────────┘  │         │
│         │                                            │         │
│         │ docker-compose.yml                         │         │
│         ▼                                            │         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ n8n Container (custom image)                            │   │
│  │                                                         │   │
│  │  Installed:                                             │   │
│  │  ├─ n8n (base image)                                    │   │
│  │  ├─ docker CLI      ← control host Docker               │   │
│  │  ├─ bash + git      ← apk add                           │   │
│  │  └─ devcontainer CLI (via npm)                          │   │
│  │                       ← start/exec DevContainers        │   │
│  │                                                         │   │
│  │  Volumes:                                               │   │
│  │  ├─ /var/run/docker.sock ← host Docker socket           │   │
│  │  ├─ $PROJECT_PATH:$PROJECT_PATH ← target repo           │   │
│  │  │    ↑ used by git worktree add                        │   │
│  │  └─ ./scripts:/opt/scripts:ro ← run scripts             │   │
│  │                                                         │   │
│  │  Env:                                                   │   │
│  │  ├─ N8N_*         → n8n internal config                 │   │
│  │  ├─ GITHUB_REPO   → workflow $env → GitHub nodes        │   │
│  │  ├─ PROJECT_PATH  → workflow $env                       │   │
│  │  ├─ GH_TOKEN      → n8n-run-claude.sh (git auth)        │   │
│  │  └─ CLAUDE_CODE_OAUTH_TOKEN                             │   │
│  │       → devcontainer reads via ${localEnv:...}          │   │
│  │       → passed into DevContainer env                    │   │
│  │                                                         │   │
│  │  Credentials (n8n UI, encrypted):                       │   │
│  │  └─ GitHub PAT → used by GitHub nodes                   │   │
│  │                                                         │   │
│  │  ┌──────────────────────────────────────────────────┐   │   │
│  │  │ Workflow: AI Issue Processor                     │   │   │
│  │  │                                                  │   │   │
│  │  │  Schedule 10min                                  │   │   │
│  │  │    → Get ai-ready Issue (GitHub node)            │   │   │
│  │  │    → If (exists & not ai-processing)             │   │   │
│  │  │    → Set ai-processing label                     │   │   │
│  │  │    → executeCommand:                             │   │   │
│  │  │      ┌────────────────────────────────────────┐  │   │   │
│  │  │      │ /opt/scripts/n8n-run-claude.sh N       │  │   │   │
│  │  │      │  1. create-worktree.sh (idempotent)    │  │   │   │
│  │  │      │  2. start-devcontainer.sh              │  │   │   │
│  │  │      │  3. timeout + devcontainer exec        │──┼───┼─┐ │
│  │  │      │      claude --print "/investigate N"   │  │   │ │ │
│  │  │      │  4. cleanup-worktree.sh (on success)   │  │   │ │ │
│  │  │      └────────────────────────────────────────┘  │   │ │ │
│  │  │    → Post PR Link to Issue                       │   │ │ │
│  │  │    → Set ai-investigated label                   │   │ │ │
│  │  └──────────────────────────────────────────────────┘   │ │ │
│  └─────────────────────────────────────────────────────────┘ │ │
│                                                              │ │
│  Docker socket (/var/run/docker.sock)                        │ │
│  ────────────────────────────────────────────────────────    │ │
│                                                              ▼ │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ DevContainer (self-contained)                           │   │
│  │                                                         │   │
│  │  Source: target repo's .devcontainer/                   │   │
│  │  Workspace: /workspaces/issue-{N} (worktree mount)      │   │
│  │                                                         │   │
│  │  Pre-installed (via Dockerfile):                        │   │
│  │  ├─ Claude Code CLI                                     │   │
│  │  ├─ gh CLI                                              │   │
│  │  └─ Node.js 22                                          │   │
│  │                                                         │   │
│  │  Pre-distributed (via setup-skills):                    │   │
│  │  ├─ .claude/skills/investigate/SKILL.md                 │   │
│  │  └─ .claude/scripts/save-investigation.sh               │   │
│  │                                                         │   │
│  │  Env (via devcontainer.json remoteEnv):                 │   │
│  │  ├─ CLAUDE_CODE_OAUTH_TOKEN ← ${localEnv:...}           │   │
│  │  └─ GH_TOKEN                ← ${localEnv:...}           │   │
│  │                                                         │   │
│  │  Execution:                                             │   │
│  │  claude --print --dangerously-skip-permissions          │   │
│  │    → read issue → investigate                           │   │
│  │    → save Markdown → git commit → git push              │   │
│  │    → gh pr create → stdout: PR URL                      │   │
│  └─────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────┘
```

## 必要なコンポーネント

### n8n カスタムイメージ (Dockerfile.n8n)

| パッケージ | 目的 | インストール方法 |
| --- | --- | --- |
| n8n | ワークフローエンジン | ベースイメージ (`n8nio/n8n:1.123.28`) |
| docker CLI | Docker socket 経由でホストの Docker を操作 | 静的バイナリをダウンロード（Hardened Image のため `apk` 不可） |
| jq | DevContainer 起動結果のパース | 静的バイナリをダウンロード |
| bash | スクリプト実行に必要 | `apk add --no-cache bash` |
| git | 対象リポジトリに worktree を作成 | `apk add --no-cache git` |
| Node.js + npm | devcontainer CLI の実行に必要 | ベースイメージにプリインストール済み |
| @devcontainers/cli | DevContainer の起動・コマンド実行 | `npm install -g @devcontainers/cli` |

### docker-compose.yml の変更点

| 追加項目 | 目的 |
| --- | --- |
| カスタムイメージ（`n8nio/n8n` の代わり） | n8n + docker CLI + git + devcontainer CLI |
| `/var/run/docker.sock` ボリューム | n8n コンテナからホストの Docker を操作 |
| `PROJECT_PATH` ボリューム（bind mount） | n8n コンテナから対象リポジトリにアクセスし worktree を作成 |
| `CLAUDE_CODE_OAUTH_TOKEN` 環境変数 | n8n コンテナの shell を経由して DevContainer に `localEnv` で渡される |

### 対象リポジトリ（setup スクリプトで事前配布）

| コンポーネント | 配布コマンド | 目的 |
| --- | --- | --- |
| `.devcontainer/Dockerfile` | `make setup-devcontainer` | Claude CLI + gh CLI + Node.js |
| `.devcontainer/devcontainer.json` | `make setup-devcontainer` | remoteEnv、postCreateCommand |
| `.claude/skills/investigate/SKILL.md` | `make setup-skills` | 調査スキル |
| `.claude/scripts/save-investigation.sh` | `make setup-skills` | 調査ノート保存 |
| `.github/ISSUE_TEMPLATE/ai-task.yml` | `make setup-issue-template` | AI タスク用 Issue フォーム |
| ラベル (ai-ready, ai-processing 等) | `make setup-labels` | ワークフロー状態管理 |

## 実行フロー（ステップごと）

```text
 1. [n8n]          10分ごとにスケジュール起動
 2. [n8n]          GitHub ノード: ai-ready ラベルの最古 Issue を取得
 3. [n8n]          Issue なし or ai-processing 中 → 終了
 4. [n8n]          GitHub ノード: ai-processing ラベルを付与
 5. [n8n]          executeCommand: /opt/scripts/n8n-run-claude.sh {N}
    [n8n]            5a. create-worktree.sh → .worktrees/issue-{N} を作成（冪等）
    [n8n]            5b. start-devcontainer.sh → DevContainer をビルド/起動
    [n8n]            5c. timeout + devcontainer exec → DevContainer 内で claude 実行
 6. [DevContainer]  claude が gh CLI で Issue 内容を取得
 7. [DevContainer]  claude が調査（Web 検索、コード分析）
 8. [DevContainer]  claude が Markdown を openspec/investigations/ に保存
 9. [DevContainer]  claude が issues/{N} ブランチにコミット & プッシュ
10. [DevContainer]  claude が gh CLI で Draft PR を作成
11. [DevContainer]  claude が PR URL を stdout に出力
12. [n8n]          cleanup-worktree.sh → worktree 削除・DevContainer 停止
13. [n8n]          PR URL を Issue にコメント投稿
14. [n8n]          ai-investigated ラベルを付与
    （エラー時）    ai-failed ラベルを付与 + エラーコメント投稿
                   （worktree は調査用に残す）
```

## トークン・認証の一覧

| トークン | 保存場所 | 使用者 | 目的 |
| --- | --- | --- | --- |
| `CLAUDE_CODE_OAUTH_TOKEN` | `.env` → n8n コンテナ → DevContainer | Claude CLI | AI 推論（Max プラン） |
| `GH_TOKEN` | ホスト環境変数 → DevContainer | gh CLI | PR 作成、コミットのプッシュ |
| GitHub PAT | n8n Credentials（暗号化保存） | n8n GitHub ノード | Issue 取得、ラベル変更、コメント投稿 |
| `N8N_API_KEY` | `.env` → n8n コンテナ | n8n REST API | ワークフローインポート (`make import-workflow`) |
| `N8N_ENCRYPTION_KEY` | `.env` → n8n コンテナ | n8n | Credentials の暗号化 |

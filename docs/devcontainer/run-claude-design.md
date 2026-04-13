# DevContainer 内での Claude 実行 — 設計

## 解決すべき課題

| #   | 課題                       | 検討事項                                                          |
| --- | -------------------------- | ----------------------------------------------------------------- |
| 1   | Claude 認証                | コンテナ内でどう認証するか                                        |
| 2   | コマンド実行               | `devcontainer exec` の引数とオプション                            |
| 3   | 自律実行                   | `--dangerously-skip-permissions` を使うか（承認プロンプトを抑制） |
| 4   | GitHub 操作                | PR 作成のために `GH_TOKEN` が必要                                 |
| 5   | Git 設定                   | コミットに `user.name` / `user.email` が必要                      |
| 6   | investigate スキルとの整合 | スキルがブランチ作成するが worktree で既に作成済み                |
| 7   | 出力の受け渡し             | PR URL を stdout で n8n に返す                                    |

---

## 1. Claude 認証方法

### 検討した選択肢

| 案    | 方法                                          | メリット                                  | デメリット                                                                                   |
| ----- | --------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------- |
| ~~A~~ | ~~`~/.claude` ディレクトリを `:ro` マウント~~ | ~~設定が1箇所~~                           | ~~Max プランの OAuth トークンは macOS キーチェーンに保存されておりコンテナからアクセス不可~~ |
| ~~B~~ | ~~`~/.claude.json` を `:rw` マウント~~        | ~~トークンリフレッシュが可能~~            | ~~`accessToken` / `refreshToken` がファイルに含まれていない（キーチェーン管理）~~            |
| **C** | **`CLAUDE_CODE_OAUTH_TOKEN` 環境変数**        | **マウント不要。環境変数1つで認証が完結** | **トークン生成に `claude setup-token` が必要**                                               |

### 決定: 案C — OAuth トークン方式

Max プランの認証トークンは macOS キーチェーンに保存されるため、ファイルマウントではコンテナに渡せない。`CLAUDE_CODE_OAUTH_TOKEN` 環境変数を使えば、キーチェーンに依存せず認証できる。

- 公式ドキュメント: [Generate a long-lived token](https://code.claude.com/docs/en/authentication#generate-a-long-lived-token)
- 環境変数リファレンス: [Claude Code Environment Variables](https://code.claude.com/docs/en/env-vars)

#### トークンの流れ

```text
claude setup-token（1年間有効なトークンを生成）
  → .env に保存
  → docker-compose.yml で n8n コンテナに渡す
  → devcontainer.json の remoteEnv + ${localEnv:...} で DevContainer に渡る
  → DevContainer 内の claude --print が認証に使用
```

#### セットアップ手順

```bash
# 1. ホストで OAuth トークンを生成
claude setup-token

# 2. .env に保存（.gitignore 済み）
CLAUDE_CODE_OAUTH_TOKEN=<生成されたトークン>
```

#### 参考: Claude Code 認証環境変数一覧

| 環境変数                  | 用途                                                                 | ソース                                                                                       |
| ------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`       | API キー認証（API 課金）                                             | [env-vars](https://code.claude.com/docs/en/env-vars)                                         |
| `CLAUDE_CODE_OAUTH_TOKEN` | `claude setup-token` で生成した長期 OAuth トークン（Max プラン向け） | [authentication](https://code.claude.com/docs/en/authentication#generate-a-long-lived-token) |

ソース: [Claude Code 環境変数ドキュメント](https://code.claude.com/docs/en/env-vars)

---

## 2. investigate スキルとの整合

### 現在のスキルの手順

```text
1. git checkout main && git pull → git checkout -b issues/{number}
2. 調査
3. Markdown 保存
4. コミット & プッシュ
5. PR 作成
```

worktree で既にブランチを作成済みのため、スキルのブランチ作成ステップと競合する。

### 決定: ブランチ名を `issues/{number}` で統一

`create-worktree.sh` が `issues/{number}` で worktree を作成し、investigate スキルも同じブランチ名を使用する。スキルの `git checkout -b` は既にそのブランチにいるため実質スキップされる。

---

## 3. 実行コマンド

```bash
devcontainer exec \
  --workspace-folder <worktree-path> \
  -- claude --print --dangerously-skip-permissions "/investigate <issue-number>"
```

| オプション                       | 目的                                                                    |
| -------------------------------- | ----------------------------------------------------------------------- |
| `--print`                        | 非対話モード。結果を stdout に出力                                      |
| `--dangerously-skip-permissions` | ツール実行の承認プロンプトを抑制。DevContainer で隔離されているため安全 |

### `--allowedTools` への移行検討

現在は `--dangerously-skip-permissions` で全ツール承認をスキップしているが、将来的には `--allowedTools` でツールを限定する方が安全。investigate スキルの `SKILL.md` frontmatter に `allowed-tools` を定義済みなので、移行時はこれを参照すること。

```bash
# 将来の移行先（--dangerously-skip-permissions を置き換え）
claude --print --allowedTools "Read,Grep,Glob,Bash(git *),Bash(gh *),Bash(cat *),Bash(bash *),Bash(mkdir *),WebSearch,Write" \
  "/investigate <issue-number>"
```

スキルの `allowed-tools` を変更した場合は、n8n スクリプト（`scripts/n8n-run-claude.sh`）の `--allowedTools` も合わせて更新すること。

### 3.1. 失敗時の stdout / stderr ハンドリング（課題 #7 への回答）

`claude --print` が非 0 終了した場合、n8n の `ExecuteCommand` ノード側で `error` / `stderr` フィールドに実際の失敗理由が届く必要がある。Slack 失敗通知の本文と GitHub Issue エラーコメントはどちらも `resolveFailureError({ error, stderr }, …)` を経由してこの値を取り出すため、ここが空だと全ての失敗が「タイムアウトまたは不明なエラー」というフォールバック文字列に潰れる。

#### 避けるべきアンチパターン

```bash
set -euo pipefail
CLAUDE_OUTPUT=$(timeout "$CLAUDE_TIMEOUT_SEC" devcontainer exec … claude …)
# ↑ claude が非 0 終了 → command substitution が失敗 → set -e で即 exit
# → 以降の echo "$CLAUDE_OUTPUT" に到達せず、stderr も n8n に届かない
echo "$CLAUDE_OUTPUT"
```

この形だと、**claude の実際のエラー内容が一切 n8n に伝搬せず**、Slack には常に「タイムアウト」と表示される静かな観測性バグが発生する。

#### 採用している構成

1. stdout / stderr を個別の temp file（`mktemp`）に退避
2. `trap 'rm -f "$CLAUDE_STDOUT" "$CLAUDE_STDERR"' EXIT` でクリーンアップを保証
3. `timeout … claude …` を `set +e` / `set -e` で囲み、exit code を安全に捕捉
4. 非 0 の場合は両ストリームをスクリプトの stderr にデリミタ付きで吐いた上で、claude の exit code をそのまま `exit`
5. 成功時は `cat "$CLAUDE_STDOUT"` で素通し（`echo` と違い末尾改行を足さないので PR URL 抽出の正規表現に影響しない）

これにより n8n の ExecuteCommand ノードは `stderr` フィールドに claude の実際の出力を受け取り、`Build failure payload` が `resolveFailureError` → `scrubSecrets` を通して auth / tool error / rate limit 等の実原因を Slack と Issue コメントに反映できる。

#### exit code の意味

| exit code | 意味                            | 典型的な原因                                                   |
| --------- | ------------------------------- | -------------------------------------------------------------- |
| 0         | 成功                            | stdout に Draft PR URL を含む                                  |
| 1         | claude 側のエラー               | 認証失敗、ツール実行エラー、レートリミット等（stderr に詳細）  |
| 124       | `timeout(1)` による強制終了     | `CLAUDE_TIMEOUT_SEC` 超過。stderr には超過時点までの出力が残る |
| それ以外  | devcontainer / シェル側のエラー | worktree 未作成、trap で捕捉できなかった異常など               |

秘匿情報（Slack トークン / GitHub PAT / Anthropic API キー / `Authorization: Bearer …` ヘッダー）は `scripts/slack-notify-pkg/index.js` の `scrubSecrets` が Slack / Issue コメント投稿直前に `[REDACTED]` で置換するため、上記の生 stderr を通してもオペレータへの漏洩経路は塞がれている。

---

## 4. スクリプト構成

### 決定: 2つの実行方式

#### n8n ワークフロー（本番）

n8n の `executeCommand` ノード内でインラインコマンドとして実行。n8n コンテナ内で全ステップ（worktree 作成 → DevContainer 起動 → claude 実行）を1コマンドで実行する。

```bash
cd $PROJECT_PATH && \
  git worktree add .worktrees/issue-N ... && \
  devcontainer up --workspace-folder $WORKTREE && \
  devcontainer exec --workspace-folder $WORKTREE -- \
    claude --print --dangerously-skip-permissions "/investigate N" < /dev/null
```

#### `run-investigation.sh`（手動実行・デバッグ用）

ホストから直接実行するための統合スクリプト。1Password からトークンを取得する。

```bash
# 手動実行
source .env && bash scripts/run-investigation.sh <issue-number>
```

TypeScript 化はテストコードが必要になったタイミングで検討。

---

## 5. 環境変数の受け渡し

| 変数                      | 用途                | 渡し方                                                   |
| ------------------------- | ------------------- | -------------------------------------------------------- |
| `GH_TOKEN`                | PR 作成・Issue 操作 | `devcontainer.json` の `remoteEnv`                       |
| `CLAUDE_CODE_OAUTH_TOKEN` | Claude 認証         | `devcontainer.json` の `remoteEnv`（ホスト環境変数から） |
| `git user.name/email`     | コミット            | `devcontainer.json` の `postCreateCommand` で設定        |

---

## 6. 決定事項まとめ

| #   | 項目                                    | 決定内容                                                  | 補足                                                |
| --- | --------------------------------------- | --------------------------------------------------------- | --------------------------------------------------- |
| 1   | Claude 認証                             | `CLAUDE_CODE_OAUTH_TOKEN` 環境変数                        | `claude setup-token` で生成。マウント不要           |
| 2   | worktree のブランチ名                   | `issues/{number}` で統一                                  | investigate スキル側も合わせて修正済み              |
| 3   | スクリプト構成                          | 統合スクリプト `run-investigation.sh`（シェルスクリプト） | TypeScript 化はテストが必要になったタイミングで検討 |
| 4   | `--dangerously-skip-permissions` の使用 | 使用する                                                  | DevContainer で隔離されているため安全               |
| 5   | `git user.name/email` の設定方法        | `postCreateCommand` で設定                                | DevContainer 初回作成時に1回だけ実行される          |

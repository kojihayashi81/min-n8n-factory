# DevContainer 内での Claude 実行 — 設計

## 解決すべき課題

| # | 課題 | 検討事項 |
| --- | --- | --- |
| 1 | Claude 認証 | コンテナ内でどう認証するか |
| 2 | コマンド実行 | `devcontainer exec` の引数とオプション |
| 3 | 自律実行 | `--skip-permissions` を使うか（承認プロンプトを抑制） |
| 4 | GitHub 操作 | PR 作成のために `GH_TOKEN` が必要 |
| 5 | Git 設定 | コミットに `user.name` / `user.email` が必要 |
| 6 | investigate スキルとの整合 | スキルがブランチ作成するが worktree で既に作成済み |
| 7 | 出力の受け渡し | PR URL を stdout で n8n に返す |

---

## 1. Claude 認証方法

### 検討した選択肢

| 案 | 方法 | メリット | デメリット |
| --- | --- | --- | --- |
| ~~A~~ | ~~`~/.claude` ディレクトリを `:ro` マウント~~ | ~~設定が1箇所~~ | ~~Max プランの OAuth トークンは macOS キーチェーンに保存されておりコンテナからアクセス不可~~ |
| ~~B~~ | ~~`~/.claude.json` を `:rw` マウント~~ | ~~トークンリフレッシュが可能~~ | ~~`accessToken` / `refreshToken` がファイルに含まれていない（キーチェーン管理）~~ |
| **C** | **`CLAUDE_CODE_OAUTH_TOKEN` 環境変数** | **マウント不要。環境変数1つで認証が完結** | **トークン生成に `claude setup-token` が必要** |

### 決定: 案C — OAuth トークン方式

Max プランの認証トークンは macOS キーチェーンに保存されるため、ファイルマウントではコンテナに渡せない。`CLAUDE_CODE_OAUTH_TOKEN` 環境変数を使えば、キーチェーンに依存せず認証できる。

#### セットアップ手順

```bash
# 1. ホストでOAuth トークンを生成
claude setup-token

# 2. 生成されたトークンを環境変数に設定（.env や shell profile に追加）
export CLAUDE_CODE_OAUTH_TOKEN="<生成されたトークン>"
```

#### devcontainer.json の設定

```json
{
  "remoteEnv": {
    "CLAUDE_CODE_OAUTH_TOKEN": "${localEnv:CLAUDE_CODE_OAUTH_TOKEN}"
  }
}
```

`${localEnv:...}` によりホストの環境変数が DevContainer 内に渡される。

#### 参考: Claude Code 認証環境変数一覧

| 環境変数 | 用途 |
| --- | --- |
| `ANTHROPIC_API_KEY` | API キー認証（API 課金） |
| `CLAUDE_CODE_OAUTH_TOKEN` | `claude setup-token` で生成した長期 OAuth トークン（Max プラン向け） |

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
  -- claude --print --skip-permissions "/investigate <issue-number>"
```

| オプション | 目的 |
| --- | --- |
| `--print` | 非対話モード。結果を stdout に出力 |
| `--skip-permissions` | ツール実行の承認プロンプトを抑制。DevContainer で隔離されているため安全 |

---

## 4. スクリプト構成

### 決定: 統合スクリプト `run-investigation.sh`

```bash
#!/bin/bash
ISSUE_NUMBER=$1

# 1. worktree 作成
WORKTREE_PATH=$(bash scripts/create-worktree.sh "$ISSUE_NUMBER")

# 2. DevContainer 起動
bash scripts/start-devcontainer.sh "$WORKTREE_PATH"

# 3. claude 実行
devcontainer exec --workspace-folder "$WORKTREE_PATH" \
  -- claude --print --skip-permissions "/investigate $ISSUE_NUMBER"
```

n8n のワークフローからは以下の1コマンドで呼び出せる:

```bash
bash /path/to/scripts/run-investigation.sh <issue-number>
```

TypeScript 化はテストコードが必要になったタイミングで検討。

---

## 5. 環境変数の受け渡し

| 変数 | 用途 | 渡し方 |
| --- | --- | --- |
| `GH_TOKEN` | PR 作成・Issue 操作 | `devcontainer.json` の `remoteEnv` |
| `CLAUDE_CODE_OAUTH_TOKEN` | Claude 認証 | `devcontainer.json` の `remoteEnv`（ホスト環境変数から） |
| `git user.name/email` | コミット | `devcontainer.json` の `postCreateCommand` で設定 |

---

## 6. 決定事項まとめ

| # | 項目 | 決定内容 | 補足 |
| --- | --- | --- | --- |
| 1 | Claude 認証 | `CLAUDE_CODE_OAUTH_TOKEN` 環境変数 | `claude setup-token` で生成。マウント不要 |
| 2 | worktree のブランチ名 | `issues/{number}` で統一 | investigate スキル側も合わせて修正済み |
| 3 | スクリプト構成 | 統合スクリプト `run-investigation.sh`（シェルスクリプト） | TypeScript 化はテストが必要になったタイミングで検討 |
| 4 | `--skip-permissions` の使用 | 使用する | DevContainer で隔離されているため安全 |
| 5 | `git user.name/email` の設定方法 | `postCreateCommand` で設定 | DevContainer 初回作成時に1回だけ実行される |

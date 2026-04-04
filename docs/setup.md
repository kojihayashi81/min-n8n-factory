# セットアップ手順

## 前提条件

- **1Password** を使用して PAT などの秘密情報を管理する
- 1Password CLI (`op`) と 1Password アプリの連携を有効にしておく（Settings → Developer → 「Integrate with 1Password CLI」をオン）

```bash
brew install 1password-cli
```

---

## 前提ツールのインストール

### 1. GitHub CLI

```bash
# Homebrew でインストール
brew install gh

# バージョン確認
gh --version
```

### 2. Claude Code CLI

```bash
# npm でインストール
npm install -g @anthropic-ai/claude-code

# バージョン確認
claude --version
```

---

## 認証設定

### GitHub CLI 認証

```bash
gh auth login
```

対話式で以下を選択する：

```text
? Where do you use GitHub?  → GitHub.com
? What is your preferred protocol for Git operations?  → HTTPS
? Authenticate Git with your GitHub credentials?  → Yes
? How would you like to authenticate GitHub CLI?  → Login with a web browser
```

ブラウザが開くので認証して完了。

```bash
# 確認
gh auth status
```

### Claude Code 認証（Max プラン）

```bash
claude auth login
```

ブラウザが開くので Anthropic アカウントでログイン。

```bash
# 確認
claude --version
```

---

## 工場のセットアップ

```bash
cd /path/to/min-factory

# 1. .env 生成
make setup

# 2. .env を開いて以下を記入
#    GITHUB_REPO=owner/repo-name
#    PROJECT_PATH=/Users/.../your-repo

# 3. n8n 起動
make up
```

→ `http://localhost:5678` で n8n UI を開く

---

## n8n Credentials 登録

対象リポジトリごとに Fine-grained PAT を発行し、n8n に登録する。

### 1. Fine-grained PAT を発行

GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token

| 設定項目 | 値 |
| --- | --- |
| Repository access | 対象リポジトリのみ選択 |
| Issues | Read and write |
| Contents | Read and write（実装フェーズで必要） |

発行したトークンは 1Password に保存する。

### 2. n8n に Credentials を登録

n8n UI → 左サイドバー `+` → Add credential → `GitHub API` を選択

| フィールド | 値 |
| --- | --- |
| Credential Name | `github-<リポジトリ名>`（例: `github-gomoku`） |
| GitHub Server | `https://api.github.com` |
| Access Token | 発行した Fine-grained PAT |

> PAT は n8n Credentials にのみ登録する。`.env` には書かない。

---

## GitHub 連携の懸念点

| 懸念点 | 内容 | 対策 |
| --- | --- | --- |
| **PAT の期限** | Fine-grained PAT は最長1年。切れたら再発行・n8n Credentials の再登録が必要 | 個人開発は No expiration、チーム利用時は GitHub App へ移行 |
| **PAT の漏洩** | n8n Credentials に保存されるため n8n のセキュリティに依存 | ローカル完結の間は許容。外部公開時は GitHub App へ移行 |
| **複数リポジトリ管理** | 対象リポジトリごとに PAT を発行・管理する必要がある | チーム利用時は GitHub App で一括管理 |
| **GitHub App への移行** | チーム開発・長期運用のベストプラクティス。JWT 認証が必要で設定が複雑 | プロトタイプ完成後に対応 |
| **PAT の自動ローテーション** | PAT 再発行はブラウザ操作が必須のため完全自動化不可。バッチで n8n を再認証する案も現実的でない | 自動ローテーションが必要なら GitHub App（トークンが1時間ごとに自動更新）に移行するのが唯一の現実解 |

---

## PAT 権限

| PAT | 必要な権限 |
| --- | --- |
| `min-n8n-factory` 用（このリポジトリ管理） | Contents: Read & Write |
| AIワークフロー対象リポジトリ用 | Issues: Read（取得のみ）/ Issues: Read & Write（作成・更新も行う場合） |

---

## 対象リポジトリの初期セットアップ

新しいリポジトリを AI ワークフローの対象にする場合、以下の順番で実行する。

### 1. `.env` の `GITHUB_REPO` を設定

```bash
# .env を編集
GITHUB_REPO=owner/repo-name
```

### 2. ラベルを作成

```bash
make setup-labels
```

以下の5つのラベルが作成される:

| ラベル | 意味 |
| --- | --- |
| `ai-ready` | 唯一のトリガー。人間のみが付与する |
| `ai-processing` | AI 処理中。二重起動防止ガード |
| `ai-review` | PR 作成済み・レビュー待ち |
| `ai-done` | 完了 |
| `ai-failed` | エラー・タイムアウト。人間の介入が必要 |

### 3. Issue Form テンプレートを配布

```bash
make setup-issue-template
```

対象リポジトリの `.github/ISSUE_TEMPLATE/` に AI タスク専用フォームがコミット・プッシュされる。

> `make setup-labels` を先に実行していないと、Issue 作成時に `ai-ready` ラベルが付与されない。

---

## 動作確認

```bash
# GitHub CLI が対象リポジトリに接続できるか確認
gh issue list --repo <GITHUB_REPO> --label ai-ready

# Claude Code が動くか確認
echo "Hello" | claude --print "上記を日本語で返してください"
```

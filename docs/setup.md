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

n8n UI → Settings → Credentials で以下を登録する。

| Credential 名 | 種類 | 値 |
| --- | --- | --- |
| `github-token` | Header Auth | `gh auth token` の出力 |

```bash
# GitHub トークンの取得
gh auth token
```

> このトークンは n8n Credentials にのみ登録する。`.env` には書かない。

---

## PAT 権限

| PAT | 必要な権限 |
| --- | --- |
| `min-n8n-factory` 用（このリポジトリ管理） | Contents: Read & Write |
| AIワークフロー対象リポジトリ用 | Issues: Read（取得のみ）/ Issues: Read & Write（作成・更新も行う場合） |

---

## 動作確認

```bash
# GitHub CLI が対象リポジトリに接続できるか確認
gh issue list --repo <GITHUB_REPO> --label ai-ready

# Claude Code が動くか確認
echo "Hello" | claude --print "上記を日本語で返してください"
```

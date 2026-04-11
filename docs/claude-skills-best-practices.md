# Claude Code Skills ベストプラクティス

## ファイル構造

```text
.claude/
  commands/           # プロジェクト共通スキル
    investigate.md
    specify.md
  skills/             # Agent Skills 形式（サブエージェント対応）
    investigate/
      SKILL.md
      references/
      scripts/
```

スキルは3つのスコープに配置できる:

| 場所 | パス | 適用範囲 |
| --- | --- | --- |
| Personal | `~/.claude/commands/` | すべてのプロジェクト |
| Project | `.claude/commands/` | このプロジェクトのみ |
| Skills 形式 | `.claude/skills/<name>/SKILL.md` | モノレポ・サブエージェント対応 |

---

## frontmatter フィールド

```yaml
---
name: investigate              # 小文字・ハイフンのみ・64文字以内
description: |                 # 250文字以内・使用シーンを含める
  Issue の内容を調査しファイルに保存する。
  「調査して」「investigate」と言われたときに使用。
argument-hint: "[issue-number]" # 引数のヒント
allowed-tools: Read Grep Bash(git *) WebSearch  # 事前承認ツール
disable-model-invocation: true  # true=手動のみ / false=自動起動も可
user-invocable: true            # false=Claudeのみ（メニュー非表示）
model: sonnet                   # スキル実行時のモデル指定
effort: medium                  # low / medium / high / max
context: fork                   # fork=独立したサブエージェントで実行
agent: Explore                  # context:fork 時のエージェント型
paths: src/auth/**              # このパスのファイル編集時のみ起動
---
```

---

## $ARGUMENTS の使い方

```markdown
# 全引数
$ARGUMENTS

# N番目の引数（0始まり）
$ARGUMENTS[0]
$0  # 短縮形

# 使用例: /investigate 42
issue-$ARGUMENTS-investigation.md  # → issue-42-investigation.md
```

---

## 動的コンテキスト注入

バッククォート + `!` でシェルコマンドの出力をプロンプトに挿入できる（Claude が実行するのではなく、起動前に展開される）:

```markdown
変更ファイル: !`git diff --name-only`
テスト結果: !`npm test 2>&1 | tail -20`
```

---

## 効果的な書き方

### description のポイント

- キーワードを先頭に置く
- 「いつ使うか」を含める
- 250文字以内

```yaml
# 悪い例
description: コードを説明します

# 良い例
description: コードを図表と比喩で説明。「この関数は何？」「どう動く？」と聞かれたときに使用。
```

### 本文のポイント

- **手順（プロセス）** は SKILL.md に書く
- **背景知識・ルール** は `references/` に分離する
- SKILL.md は 500行以下を目安にする
- `ultrathink` という単語を含めると Extended Thinking が有効になる

### 手動実行専用スキル（deploy, commit など）

```yaml
disable-model-invocation: true  # Claudeが勝手に実行しないようにする
allowed-tools: Bash(git *) Bash(npm *)
```

---

## できること・できないこと

### できること

- `allowed-tools` でツール権限を事前承認
- `context: fork` でサブエージェントとして独立実行
- `!` コマンドで動的コンテキストを注入
- `model` でスキルごとにモデルを指定
- `paths` で起動条件をファイルパスで制限

### できないこと

- スキル内から別のスキルを呼び出す
- `/help` などのビルトインコマンドを呼び出す
- 環境変数を永続的に設定する

---

## このプロジェクトでの方針

| スキル | トリガー | モデル | 用途 |
| --- | --- | --- | --- |
| `investigate` | 手動 + 自動 | haiku | Issue の調査・ノート保存 |
| `specify` | 手動 | sonnet | 調査結果から仕様化 |
| `implement` | 手動 | sonnet | 仕様からコード実装 |

調査方針・ソース・出力形式はリポジトリの `CLAUDE.md` で定義し、スキルからは参照しない。
スキルは「何をするか（手順）」のみを持ち、「どのように調査するか」はリポジトリに委ねる。

---

## agentskills.io 標準

### 概要

Anthropic が開発しオープンスタンダードとして公開した、AIエージェント向けスキルフォーマットの仕様。Claude Code をはじめ **35以上のプラットフォーム**（GitHub Copilot、Cursor、Gemini CLI、JetBrains Junie など）が対応しており、一度作ったスキルを複数ツールで再利用できる。

- 仕様: [agentskills.io/specification](https://agentskills.io/specification)
- 公式スキル例: [anthropics/skills](https://github.com/anthropics/skills)
- 検証ツール: `skills-ref validate ./my-skill`

### 標準フォーマット（agentskills.io 準拠）

```yaml
---
name: investigate          # 必須・64文字以内・小文字ハイフンのみ
description: |             # 必須・1024文字以内
  Issueの内容を調査しファイルに保存する。
  「調査して」と言われたときに使用。
license: MIT               # オプション
compatibility: Claude Code # オプション・環境要件
metadata:                  # オプション・任意のキーバリュー
  author: kojihayashi81
  version: "1.0"
allowed-tools: Read Grep WebSearch  # オプション
---
```

### Claude Code 固有の拡張フィールド（agentskills 標準外）

```yaml
argument-hint: "[issue-number]"
disable-model-invocation: true
user-invocable: false
model: sonnet
effort: medium
context: fork
agent: Explore
paths: src/**
```

### agentskills.io 標準に合わせるメリット

- 他のプラットフォーム（Cursor、GitHub Copilot など）でも同じスキルを再利用できる
- チーム・企業のスキル資産をプラットフォームに依存せず管理できる

### 参考スキル集

| リポジトリ | 内容 |
| --- | --- |
| [anthropics/skills](https://github.com/anthropics/skills) | Anthropic 公式スキル例 |
| [K-Dense-AI/claude-scientific-skills](https://github.com/K-Dense-AI/claude-scientific-skills) | 調査・リサーチ系 134+ スキル |
| [alirezarezvani/claude-skills](https://github.com/alirezarezvani/claude-skills) | 220+ スキル |
| [travisvn/awesome-claude-skills](https://github.com/travisvn/awesome-claude-skills) | 厳選まとめ |
| [claudemarketplaces.com](https://claudemarketplaces.com/) | 2,300+ スキルのマーケットプレイス |

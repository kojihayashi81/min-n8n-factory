---
name: investigate
description: >
  GitHub Issue の内容を調査し、結果を openspec/investigations/ に保存して Draft PR を作成する。
  「調査して」「/investigate」と指示されたときに使用。
argument-hint: "[issue-number]"
---

Issue #$ARGUMENTS を調査して Draft PR を作成してください。以下の手順で実行してください。

## Issue の内容

!`gh issue view $ARGUMENTS --json number,title,body,labels,comments --jq '{number:.number, title:.title, body:.body, labels:[.labels[].name], comments:[.comments[].body]}'`

作業前に以下の2ファイルを必ず読むこと:

- `references/investigation-guide.md` — 調査方針・禁止事項
- `references/investigation-note-template.md` — ノートのフォーマット（調査プロセスの記録を含む）

## 手順

### 1. ブランチ作成

```bash
git checkout main && git pull
git checkout -b issues/$ARGUMENTS
```

### 2. 調査

`references/investigation-guide.md` の調査方針に従って Issue #$ARGUMENTS の内容を調査する。

### 3. 調査ノートを保存

`references/investigation-note-template.md` のフォーマットに沿って調査ノートを作成し、スクリプトに渡して保存する:

```bash
cat <<'EOF' | bash .claude/scripts/save-investigation.sh $ARGUMENTS
{調査ノートの内容}
EOF
```

### 4. コミット & プッシュ

```bash
git add openspec/investigations/issue-$ARGUMENTS-investigation.md
git commit -m "investigate: add investigation note for issue #$ARGUMENTS"
git push -u origin issues/$ARGUMENTS
```

### 5. Draft PR を作成

```bash
gh pr create \
  --title "investigate: Issue #$ARGUMENTS 調査ノート" \
  --body "Closes #$ARGUMENTS" \
  --draft
```

### 6. 標準出力に PR URL を返す

作成した PR の URL のみを標準出力に出力する。

---

## n8n から自動実行する場合の注意

`claude --print` は非インタラクティブモードで動作するため、ツール承認プロンプトが出るとワークフローがブロックされる。
必ず `--allowedTools` フラグで使用ツールを事前承認すること。

```bash
claude --print --allowedTools "Read,Grep,Bash(git *),Bash(gh *),WebSearch" "/investigate N"
```

このスキルで使用するツールを変更した場合は、n8n ワークフロー（`workflows/ai-issue-processor.json`）の `--allowedTools` も合わせて更新すること。

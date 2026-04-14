---
name: investigate
description: >
  GitHub Issue の内容を調査し、結果を openspec/investigations/ に保存して Draft PR を作成する。
  「調査して」「/investigate」と指示されたときに使用。
argument-hint: '[issue-number]'
disable-model-invocation: true
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash(git *)
  - Bash(gh *)
  - Bash(cat *)
  - Bash(bash *)
  - Bash(mkdir *)
  - WebSearch
  - Write
---

Issue #$ARGUMENTS を調査して Draft PR を作成してください。以下の手順で実行してください。

## Issue の内容

!`gh issue view $ARGUMENTS --json number,title,body,labels,comments --jq '{number:.number, title:.title, body:.body, labels:[.labels[].name], comments:[.comments[].body]}'`

作業前に以下の2ファイルを必ず読むこと:

- [調査方針・禁止事項](references/investigation-guide.md)
- [調査ノートテンプレート](references/investigation-note-template.md)

## 手順

### 1. ブランチ作成

```bash
git fetch origin
git checkout issues/$ARGUMENTS 2>/dev/null || git checkout -b issues/$ARGUMENTS origin/main
```

### 2. 調査

[調査方針](references/investigation-guide.md) に従って Issue #$ARGUMENTS の内容を調査する。

### 3. 調査ノートを保存

[調査ノートテンプレート](references/investigation-note-template.md) のフォーマットに沿って調査ノートを作成し、スクリプトに渡して保存する:

```bash
cat <<'EOF' | bash ${CLAUDE_SKILL_DIR}/scripts/save-investigation.sh $ARGUMENTS
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

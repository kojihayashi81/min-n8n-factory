---
name: investigate
description: >
  GitHub Issue の内容を調査し、結果を openspec/investigations/ に保存して Draft PR を作成する。
  「調査して」「/investigate」と指示されたときに使用。
argument-hint: "[issue-number]"
allowed-tools: Read Grep Bash(git *) Bash(gh *) WebSearch
---

Issue #$ARGUMENTS を調査して Draft PR を作成してください。以下の手順で実行してください。

## 手順

### 1. ブランチ作成

```bash
git checkout main && git pull
git checkout -b investigation/issue-$ARGUMENTS
```

### 2. 調査

CLAUDE.md の調査方針に従って Issue #$ARGUMENTS の内容を調査する。

### 3. 調査ノートを保存

以下のフォーマットで調査結果を作成し、スクリプトに渡して保存する:

```bash
cat <<'EOF' | bash .claude/scripts/save-investigation.sh $ARGUMENTS
# Issue #$ARGUMENTS 調査ノート

## 調査対象
{Issue タイトル}

## 調査結果

{調査内容を箇条書きで記載}

## 要確認事項

{不確かな点。なければ「なし」}

## 参考ソース

{URL またはファイルパス}
EOF
```

### 4. コミット & プッシュ

```bash
mkdir -p openspec/investigations
git add openspec/investigations/issue-$ARGUMENTS-investigation.md
git commit -m "investigate: add investigation note for issue #$ARGUMENTS"
git push -u origin investigation/issue-$ARGUMENTS
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

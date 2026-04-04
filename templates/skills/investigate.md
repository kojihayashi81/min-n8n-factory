---
name: investigate
description: GitHub Issue の内容を調査し、結果を openspec/investigations/ に保存する
---

以下の GitHub Issue を調査してください。

## 調査方針

- コードベースを優先的に参照する
- Web 検索は公式ドキュメント・信頼性の高いソースのみ使用する
- 不確かな情報は「要確認:」と前置きする

## 調査ソース（優先順）

1. このリポジトリのコードベース
2. openspec/specs/ 以下の仕様ファイル（存在する場合）
3. 公式ドキュメント・Web 検索

## 出力形式

調査結果を `openspec/investigations/issue-$ARGUMENTS-investigation.md` に保存すること。

ファイル形式:

```markdown
# Issue #{番号} 調査ノート

## 調査対象
{Issue タイトル}

## 調査結果
- {箇条書き、5件以内}

## 要確認事項
- {不確かな点、なければ「なし」}

## 参考ソース
- {URL またはファイルパス}
```

保存後、以下を標準出力に返すこと:
`openspec/investigations/issue-$ARGUMENTS-investigation.md`

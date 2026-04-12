# MCP ドキュメントサーバー

プロジェクトのドキュメント・ワークフロー・スクリプトを MCP 経由で AI に公開するサーバー。

## 構成

- TypeScript SDK + Streamable HTTP トランスポート
- Claude Code 公式 Skill（`mcp-builder`）で構築
- n8n とは Compose を分離し、必要時だけ起動する

## 起動・停止

```bash
make mcp-up    # localhost:3100 で起動
make mcp-down  # 停止
```

## 接続

`.mcp.json` に設定済み。

```json
{
  "mcpServers": {
    "mcp-docs": {
      "type": "http",
      "url": "http://127.0.0.1:3100/mcp"
    }
  }
}
```

## 公開対象

`compose.mcp.yml` で read-only マウントしているファイルのみ。

- `labels.json`
- `README.md`
- `docs/`
- `workflows/`
- `templates/`
- `scripts/`
- `Makefile`

`.env` や `data/` は公開しない。

## 関連資料

- [現行構成](./architecture.md) — リソース、ツール、パイプライン、セキュリティの仕様
- [設計判断](./design.md) — なぜこう作ったか
- [精度評価ガイド](./evaluation-guide.md) — ツールとパイプラインの評価手順
- [将来検討](./future.md) — 未実装の構想と改善候補
- [ローカル MCP サーバー実装調査](./local-container-server-research.md)

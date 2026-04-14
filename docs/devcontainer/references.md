# DevContainer + AI Agent 参考資料

## このアプローチが主流である根拠

Anthropic 公式も Claude Code を DevContainer 内で動かすことを推奨しており、2025-2026年のベストプラクティスとして広まっている。

公式リファレンス DevContainer では以下が紹介されている:

- アウトバウンド接続のファイアウォール（信頼するホストのみ許可）
- `--dangerously-skip-permissions` での完全自律実行（隔離環境だからこそ安全に実行可能）

### DevContainer + AI の主なメリット

| 観点         | メリット                                                                |
| ------------ | ----------------------------------------------------------------------- |
| セキュリティ | AI の操作がコンテナ内に閉じる。ホストの SSH 鍵や認証情報を直接触れない  |
| 再現性       | 開発者と AI が同じ環境で動く → 「手元では動くのに AI が失敗する」がない |
| 並列実行     | コンテナ単位で隔離されるため、複数タスクを同時処理しても干渉しない      |
| 自律性       | 隔離されているからこそ、人間の承認なしで自律的に動かせる                |

---

## 参考リンク

- [Running AI Agents in Devcontainers](https://markphelps.me/posts/running-ai-agents-in-devcontainers/) — DevContainer 内での AI エージェント実行の実践例
- [Claude Code Docker: Running AI Agents in Containers](https://www.datacamp.com/tutorial/claude-code-docker) — Anthropic 公式リファレンス DevContainer の解説
- [How to Safely Run AI Agents Inside a DevContainer](https://codewithandrea.com/articles/run-ai-agents-inside-devcontainer/) — セキュリティ面でのベストプラクティス
- [Enhance productivity with AI + Remote Dev - VS Code Blog](https://code.visualstudio.com/blogs/2025/05/27/ai-and-remote) — VS Code チームによる AI + リモート開発の生産性向上

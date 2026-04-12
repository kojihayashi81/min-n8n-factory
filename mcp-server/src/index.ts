import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type Request, type Response } from "express";
import { z } from "zod";
import { runPipeline } from "./pipeline/run-pipeline.js";
import { searchResources, explainTopic, formatDriftReport } from "./lib/search.js";
import type { PipelineResult } from "./lib/types.js";

const PORT = parseInt(process.env.MCP_PORT ?? "3100", 10);
const ROOT = process.env.MCP_ROOT ?? "/workspace";

/** Cached pipeline result */
let pipelineResult: PipelineResult;

/** Create a fresh McpServer with all resources and tools registered */
function createServer(): McpServer {
  const server = new McpServer({
    name: "mcp-docs-server",
    version: "1.0.0",
  });

  // ------------------------------------------------------------------
  // Resources: register each resource from pipeline output
  // ------------------------------------------------------------------
  for (const res of pipelineResult.resources) {
    server.registerResource(
      res.uri.replace("project://", ""),
      res.uri,
      {
        title: res.title,
        description: res.summary,
        mimeType: "text/markdown",
      },
      async (uri) => ({
        contents: [
          {
            uri: uri.href,
            text: [
              res.content,
              "",
              "---",
              `kind: ${res.kind}`,
              `sourceFiles: ${res.sourceFiles.join(", ")}`,
              `generatedAt: ${res.generatedAt}`,
              res.knownGaps.length > 0
                ? `knownGaps:\n${res.knownGaps.map((g) => `  - ${g}`).join("\n")}`
                : "",
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ],
      })
    );
  }

  // ------------------------------------------------------------------
  // Tool: search_project_knowledge
  // ------------------------------------------------------------------
  server.registerTool(
    "search_project_knowledge",
    {
      title: "プロジェクト知識検索",
      description:
        "ドキュメントと実装要約を横断検索する。キーワードで関連するリソースを返す。",
      inputSchema: {
        query: z.string().describe("検索キーワード（例: ai-ready 状態遷移）"),
        scope: z
          .enum(["all", "spec", "derived"])
          .default("all")
          .describe("検索範囲: all=全体, spec=仕様のみ, derived=実装要約のみ"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ query, scope }) => {
      const results = searchResources(pipelineResult, query, scope);
      if (results.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `"${query}" に一致するリソースが見つかりませんでした。`,
            },
          ],
        };
      }

      const text = results
        .slice(0, 10)
        .map((r) => {
          const gaps =
            r.knownGaps.length > 0
              ? `\n  注意: ${r.knownGaps.join("; ")}`
              : "";
          return `- [${r.kind}] ${r.title} (${r.uri})\n  ${r.summary}\n  ソース: ${r.sourceFiles.join(", ")}${gaps}`;
        })
        .join("\n\n");

      return {
        content: [{ type: "text" as const, text }],
      };
    }
  );

  // ------------------------------------------------------------------
  // Tool: explain_project_topic
  // ------------------------------------------------------------------
  server.registerTool(
    "explain_project_topic",
    {
      title: "プロジェクトトピック説明",
      description:
        "特定トピックを仕様優先でまとめて返す。仕様を先に要約し、実装差分があれば補足する。",
      inputSchema: {
        topic: z.string().describe("説明してほしいトピック（例: セットアップ）"),
        includeImplementation: z
          .boolean()
          .default(true)
          .describe("実装由来の補足を含めるか"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ topic, includeImplementation }) => {
      const result = explainTopic(pipelineResult, topic, includeImplementation);

      if (
        result.specSections.length === 0 &&
        result.derivedSections.length === 0
      ) {
        return {
          content: [
            {
              type: "text" as const,
              text: `"${topic}" に関連する情報が見つかりませんでした。`,
            },
          ],
        };
      }

      const parts: string[] = [];

      if (result.specSections.length > 0) {
        parts.push("## 仕様（spec）");
        for (const s of result.specSections) {
          parts.push(`### ${s.title}\nソース: ${s.source}\n\n${s.content}`);
        }
      }

      if (result.derivedSections.length > 0) {
        parts.push("## 実装要約（derived）");
        for (const s of result.derivedSections) {
          parts.push(`### ${s.title}\nソース: ${s.source}\n\n${s.content}`);
        }
      }

      if (result.relatedFiles.length > 0) {
        parts.push(
          `## 関連ファイル\n${result.relatedFiles.map((f) => `- ${f}`).join("\n")}`
        );
      }

      return {
        content: [{ type: "text" as const, text: parts.join("\n\n") }],
      };
    }
  );

  // ------------------------------------------------------------------
  // Tool: detect_doc_impl_drift
  // ------------------------------------------------------------------
  server.registerTool(
    "detect_doc_impl_drift",
    {
      title: "ドキュメント・実装差分検出",
      description:
        "ドキュメントと実装のズレ候補を返す。ラベル定義、状態遷移、make コマンドなどを対象とする。",
      inputSchema: {
        area: z
          .string()
          .optional()
          .describe(
            "検出対象の絞り込み（例: ラベル, make, ワークフロー）。省略時は全領域。"
          ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ area }) => {
      const text = formatDriftReport(pipelineResult.driftItems, area);
      return {
        content: [{ type: "text" as const, text }],
      };
    }
  );

  return server;
}

// ------------------------------------------------------------------
// Express app with host header validation
// ------------------------------------------------------------------
const app = express();
app.use(express.json());

// Host header validation for DNS rebinding protection
const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
app.use((req, res, next) => {
  const host = req.headers.host;
  if (!host) {
    res.status(403).json({ error: "Forbidden: missing host header" });
    return;
  }
  const hostname = host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  if (!ALLOWED_HOSTS.has(hostname)) {
    res.status(403).json({ error: "Forbidden: invalid host" });
    return;
  }
  next();
});

app.post("/mcp", async (req: Request, res: Response) => {
  const server = createServer();
  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on("close", () => {
      transport.close();
      server.close();
    });
  } catch (error) {
    console.error("[mcp] Error handling request:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

app.get("/mcp", (_req: Request, res: Response) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed." },
    id: null,
  });
});

app.delete("/mcp", (_req: Request, res: Response) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed." },
    id: null,
  });
});

// Health check endpoint
app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    resources: pipelineResult?.resources.length ?? 0,
    driftItems: pipelineResult?.driftItems.length ?? 0,
  });
});

// ------------------------------------------------------------------
// Startup
// ------------------------------------------------------------------
async function main() {
  console.log(`[mcp-docs] Loading project knowledge from ${ROOT} ...`);
  pipelineResult = await runPipeline(ROOT);
  console.log(
    `[mcp-docs] Ready: ${pipelineResult.resources.length} resources, ${pipelineResult.driftItems.length} drift items`
  );

  app.listen(PORT, "0.0.0.0", () => {
    console.log(
      `[mcp-docs] MCP server listening on http://127.0.0.1:${PORT}/mcp`
    );
  });
}

main().catch((err) => {
  console.error("[mcp-docs] Fatal:", err);
  process.exit(1);
});

process.on("SIGINT", () => {
  console.log("[mcp-docs] Shutting down...");
  process.exit(0);
});

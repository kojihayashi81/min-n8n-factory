import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { loadMakefile } from "../pipeline/nodes/load-makefile.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-test-makefile-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("loadMakefile", () => {
  it("parses targets with comments", async () => {
    await fs.writeFile(
      path.join(tmpDir, "Makefile"),
      [
        "# Start the server",
        "up:",
        "\tdocker compose up -d",
        "",
        "# Stop the server",
        "down:",
        "\tdocker compose down",
      ].join("\n")
    );

    const targets = await loadMakefile(tmpDir);
    assert.equal(targets.length, 2);
    assert.equal(targets[0].name, "up");
    assert.equal(targets[0].comment, "Start the server");
    assert.ok(targets[0].recipe.includes("docker compose up -d"));
    assert.equal(targets[1].name, "down");
    assert.equal(targets[1].comment, "Stop the server");
  });

  it("resets comment on blank line", async () => {
    await fs.writeFile(
      path.join(tmpDir, "Makefile"),
      [
        "# This comment is orphaned",
        "",
        "target:",
        "\techo hello",
      ].join("\n")
    );

    const targets = await loadMakefile(tmpDir);
    assert.equal(targets.length, 1);
    assert.equal(targets[0].name, "target");
    assert.equal(targets[0].comment, "");
  });

  it("handles target with no comment", async () => {
    await fs.writeFile(
      path.join(tmpDir, "Makefile"),
      ["build:", "\tnpm run build"].join("\n")
    );

    const targets = await loadMakefile(tmpDir);
    assert.equal(targets.length, 1);
    assert.equal(targets[0].comment, "");
  });

  it("strips @ prefix from recipe lines", async () => {
    await fs.writeFile(
      path.join(tmpDir, "Makefile"),
      ["# Run lint",
       "lint:",
       "\t@eslint .",
      ].join("\n")
    );

    const targets = await loadMakefile(tmpDir);
    assert.equal(targets[0].recipe, "eslint .");
  });

  it("returns empty for missing Makefile", async () => {
    const targets = await loadMakefile(tmpDir);
    assert.equal(targets.length, 0);
  });

  it("joins multiple comment lines", async () => {
    await fs.writeFile(
      path.join(tmpDir, "Makefile"),
      [
        "# Line 1",
        "# Line 2",
        "multi:",
        "\techo multi",
      ].join("\n")
    );

    const targets = await loadMakefile(tmpDir);
    assert.equal(targets[0].comment, "Line 1 Line 2");
  });
});

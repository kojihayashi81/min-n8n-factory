import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isAllowedPath } from "../lib/allowlist.js";

const ROOT = "/workspace";

describe("isAllowedPath", () => {
  it("allows README.md", () => {
    assert.equal(isAllowedPath("README.md", ROOT), true);
  });

  it("allows docs/ files", () => {
    assert.equal(isAllowedPath("docs/setup.md", ROOT), true);
    assert.equal(isAllowedPath("docs/mcp/architecture.md", ROOT), true);
  });

  it("allows workflows/ files", () => {
    assert.equal(isAllowedPath("workflows/ai-issue-processor.json", ROOT), true);
  });

  it("allows labels.json", () => {
    assert.equal(isAllowedPath("labels.json", ROOT), true);
  });

  it("allows Makefile", () => {
    assert.equal(isAllowedPath("Makefile", ROOT), true);
  });

  it("allows templates/ and scripts/", () => {
    assert.equal(isAllowedPath("templates/foo.json", ROOT), true);
    assert.equal(isAllowedPath("scripts/setup-labels.sh", ROOT), true);
  });

  it("denies .env", () => {
    assert.equal(isAllowedPath(".env", ROOT), false);
  });

  it("denies data/ directory", () => {
    assert.equal(isAllowedPath("data/n8n/config.json", ROOT), false);
  });

  it("denies .git/ directory", () => {
    assert.equal(isAllowedPath(".git/config", ROOT), false);
  });

  it("denies node_modules/", () => {
    assert.equal(isAllowedPath("node_modules/express/index.js", ROOT), false);
  });

  it("denies path traversal with ..", () => {
    assert.equal(isAllowedPath("../etc/passwd", ROOT), false);
    assert.equal(isAllowedPath("docs/../../.env", ROOT), false);
  });

  it("denies arbitrary files not in allowlist", () => {
    assert.equal(isAllowedPath("package.json", ROOT), false);
    assert.equal(isAllowedPath("tsconfig.json", ROOT), false);
  });
});

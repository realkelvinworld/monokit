import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("Monokit CLI guidance", () => {
  it("shows the published scaffold command outside a monorepo", () => {
    const cwd = mkdtempSync(join(tmpdir(), "monokit-outside-repo-"));
    const entryPath = fileURLToPath(new URL("./monokit.ts", import.meta.url));
    const tsxCliPath = fileURLToPath(import.meta.resolve("tsx/cli"));

    try {
      const result = spawnSync(process.execPath, [tsxCliPath, entryPath, "list"], {
        cwd,
        encoding: "utf-8",
      });

      assert.equal(result.status, 1);
      assert.match(result.stderr, /No monorepo detected/);
      assert.match(result.stderr, /pnpm dlx monokit-cli/);
      assert.doesNotMatch(result.stderr, /pnpm dlx create-monokit/);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

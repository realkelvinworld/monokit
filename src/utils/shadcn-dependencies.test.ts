import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureSharedUiPrimitiveDependencies } from "./shadcn-dependencies.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("shared UI primitive dependencies", () => {
  it("installs primitive packages imported by generated shared source", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "monokit-shadcn-deps-test-"));
    temporaryDirectories.push(projectDir);
    await mkdir(join(projectDir, "packages/ui/src"), { recursive: true });
    await writeFile(
      join(projectDir, "packages/ui/components.json"),
      JSON.stringify({ style: "base-nova" }),
    );
    await writeFile(
      join(projectDir, "packages/ui/package.json"),
      JSON.stringify({ dependencies: { react: "latest" } }),
    );
    await writeFile(
      join(projectDir, "packages/ui/src/button.tsx"),
      'import { Button } from "@base-ui/react/button";\nexport { Button };\n',
    );
    let installed: string[] = [];

    const result = await ensureSharedUiPrimitiveDependencies(
      projectDir,
      "pnpm",
      async (_pm, packageNames, cwd) => {
        assert.equal(cwd, join(projectDir, "packages/ui"));
        installed = packageNames;
      },
    );

    assert.deepEqual(result, ["@base-ui/react"]);
    assert.deepEqual(installed, ["@base-ui/react"]);
  });
});

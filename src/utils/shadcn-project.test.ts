import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createMonokitConfig, writeMonokitConfig } from "./monokit-config.js";
import {
  findSharedShadcnIssues,
  inspectSharedUiPrimitiveImports,
  findSharedUiPrimitiveIssues,
} from "./shadcn-project.js";

const temporaryDirectories: string[] = [];

async function createProject(): Promise<string> {
  const projectDir = await mkdtemp(join(tmpdir(), "monokit-shadcn-project-test-"));
  temporaryDirectories.push(projectDir);
  await mkdir(join(projectDir, "packages/ui"), { recursive: true });
  await mkdir(join(projectDir, "packages/ui/src"), { recursive: true });
  await mkdir(join(projectDir, "apps/web"), { recursive: true });
  await mkdir(join(projectDir, "apps/admin"), { recursive: true });
  await writeFile(
    join(projectDir, "packages/ui/components.json"),
    JSON.stringify({ style: "base-nova", tailwind: { baseColor: "neutral" } }),
  );
  await writeFile(
    join(projectDir, "packages/ui/package.json"),
    JSON.stringify({ dependencies: { "@base-ui/react": "latest", "radix-ui": "latest" } }),
  );
  await writeFile(
    join(projectDir, "packages/ui/src/button.tsx"),
    'import { Slot } from "radix-ui";\nexport { Slot };\n',
  );
  await writeFile(
    join(projectDir, "apps/web/components.json"),
    JSON.stringify({ style: "radix-nova", tailwind: { baseColor: "neutral" } }),
  );
  await writeFile(
    join(projectDir, "apps/admin/components.json"),
    JSON.stringify({ style: "radix-maia", tailwind: { baseColor: "zinc" } }),
  );
  await writeMonokitConfig(projectDir, {
    ...createMonokitConfig(["web"], "shared"),
    shadcn: { apps: { web: "shared", admin: "per-app" } },
  });
  return projectDir;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("shared shadcn project audit", () => {
  it("reports drift only for apps owned by the shared design system", async () => {
    const projectDir = await createProject();

    assert.deepEqual(await findSharedShadcnIssues(projectDir), [
      { appName: "web", fields: ["style"] },
    ]);
  });

  it("reports primitive packages that conflict with the shared style", async () => {
    const projectDir = await createProject();

    assert.deepEqual(await findSharedUiPrimitiveIssues(projectDir), ["radix-ui"]);
  });

  it("reports shared source imports that conflict with the selected primitive", async () => {
    const projectDir = await createProject();

    assert.deepEqual(await inspectSharedUiPrimitiveImports(projectDir), {
      expected: "base",
      importedPrimitives: ["radix"],
      mismatchedPackages: ["radix-ui"],
      missingPackages: [],
      mixed: false,
    });
  });
});

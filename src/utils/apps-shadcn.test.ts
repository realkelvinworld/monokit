import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  initializeSharedUi,
  wireNextToSharedShadcn,
  wireViteToSharedShadcn,
} from "./apps.js";
import { uiPackageJson } from "../templates/packages.js";

const temporaryDirectories: string[] = [];

async function createProject(): Promise<string> {
  const projectDir = await mkdtemp(join(tmpdir(), "monokit-app-shadcn-test-"));
  temporaryDirectories.push(projectDir);
  await mkdir(join(projectDir, "packages/ui/src"), { recursive: true });
  await writeFile(
    join(projectDir, "packages/ui/components.json"),
    JSON.stringify({
      style: "base-nova",
      rsc: false,
      tailwind: {
        css: "../tailwind-config/globals.css",
        baseColor: "neutral",
        cssVariables: true,
      },
      aliases: { ui: "src" },
    }),
  );
  await writeFile(
    join(projectDir, "packages/ui/src/utils.ts"),
    "export function cn() {}\n",
  );
  return projectDir;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("later shared shadcn apps", () => {
  it("runs starter component generation from packages/ui without preselecting Radix", async () => {
    const projectDir = await createProject();
    const appDir = join(projectDir, "apps/dashboard");
    await mkdir(join(appDir, "src/components/ui"), { recursive: true });
    await writeFile(join(appDir, "src/components/ui/button.tsx"), "export const Disposable = true;\n");
    await writeFile(join(projectDir, "packages/ui/src/index.ts"), 'export { cn } from "./utils";\n');
    await writeFile(
      join(projectDir, "packages/ui/package.json"),
      JSON.stringify(uiPackageJson("workspace:*")),
    );

    await initializeSharedUi(
      appDir,
      projectDir,
      {
        style: "base-nova",
        tailwind: { css: "src/index.css", baseColor: "neutral", cssVariables: true },
        aliases: { ui: "@/components/ui" },
      },
      "pnpm",
      true,
      false,
      async (_pm, args, cwd) => {
        assert.equal(cwd, join(projectDir, "packages/ui"));
        assert.deepEqual(args, [
          "shadcn@latest",
          "add",
          "button",
          "--yes",
          "--overwrite",
        ]);
        await writeFile(
          join(projectDir, "packages/ui/src/button.tsx"),
          'import { Button } from "@base-ui/react/button";\nexport { Button };\n',
        );
      },
      async (cwd, pm) => {
        assert.equal(cwd, projectDir);
        assert.equal(pm, "pnpm");
        return ["@base-ui/react"];
      },
    );

    const sharedConfig = JSON.parse(
      await readFile(join(projectDir, "packages/ui/components.json"), "utf-8"),
    );
    const uiPackage = JSON.parse(
      await readFile(join(projectDir, "packages/ui/package.json"), "utf-8"),
    );
    assert.equal(sharedConfig.style, "base-nova");
    assert.equal(sharedConfig.tailwind.css, "../tailwind-config/globals.css");
    assert.equal("radix-ui" in uiPackage.dependencies, false);
    await assert.rejects(readFile(join(appDir, "src/components/ui/button.tsx"), "utf-8"));
  });

  it("projects the canonical design into a Next.js app with Next-specific paths", async () => {
    const projectDir = await createProject();
    await mkdir(join(projectDir, "apps/web/app"), { recursive: true });
    await writeFile(join(projectDir, "apps/web/package.json"), JSON.stringify({ dependencies: {} }));

    const canonical = JSON.parse(
      await readFile(join(projectDir, "packages/ui/components.json"), "utf-8"),
    );
    await wireNextToSharedShadcn(projectDir, "web", canonical);

    const config = JSON.parse(
      await readFile(join(projectDir, "apps/web/components.json"), "utf-8"),
    );
    assert.equal(config.style, "base-nova");
    assert.equal(config.rsc, true);
    assert.equal(config.tailwind.css, "app/globals.css");
    assert.equal(config.aliases.ui, "@/components/ui");
    assert.match(await readFile(join(projectDir, "apps/web/app/globals.css"), "utf-8"), /@repo\/tailwind-config/);
  });

  it("projects the canonical design into a Vite app with Vite-specific paths", async () => {
    const projectDir = await createProject();
    await mkdir(join(projectDir, "apps/dashboard/src"), { recursive: true });

    await wireViteToSharedShadcn(projectDir, "dashboard");

    const config = JSON.parse(
      await readFile(join(projectDir, "apps/dashboard/components.json"), "utf-8"),
    );
    assert.equal(config.style, "base-nova");
    assert.equal(config.rsc, false);
    assert.equal(config.tailwind.css, "src/index.css");
    assert.equal(config.aliases.ui, "@/components/ui");
    assert.match(await readFile(join(projectDir, "apps/dashboard/src/index.css"), "utf-8"), /@repo\/tailwind-config/);
  });
});

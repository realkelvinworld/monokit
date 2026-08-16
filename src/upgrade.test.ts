import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";

import { createMonokitConfig, writeMonokitConfig } from "./utils/monokit-config.js";
import {
  applySafeShadcnRepair,
  assertPrimitiveMigrationReady,
  createClassifiedShadcnUpgradePlan,
  inspectShadcnUpgrade,
} from "./upgrade.js";

const temporaryDirectories: string[] = [];

async function createLegacyProject(sharedImport: string): Promise<string> {
  const projectDir = await mkdtemp(join(tmpdir(), "monokit-upgrade-test-"));
  temporaryDirectories.push(projectDir);
  await mkdir(join(projectDir, "packages/ui/src"), { recursive: true });
  await mkdir(join(projectDir, "apps/web"), { recursive: true });
  await writeFile(
    join(projectDir, "packages/ui/components.json"),
    JSON.stringify({ style: "new-york", tailwind: { baseColor: "zinc" } }),
  );
  await writeFile(
    join(projectDir, "packages/ui/package.json"),
    JSON.stringify({ dependencies: { [sharedImport]: "latest" } }),
  );
  await writeFile(
    join(projectDir, "packages/ui/src/button.tsx"),
    `import { Button } from "${sharedImport}";\nexport { Button };\n`,
  );
  await writeFile(
    join(projectDir, "apps/web/components.json"),
    JSON.stringify({
      style: "base-nova",
      rsc: true,
      tailwind: { css: "app/globals.css", baseColor: "neutral", cssVariables: true },
      aliases: { ui: "@/components/ui" },
    }),
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

describe("Monokit shadcn upgrade inspection", () => {
  it("produces a read-only safe repair plan when legacy shared source matches the app selection", async () => {
    const projectDir = await createLegacyProject("@base-ui/react");
    const before = await readFile(join(projectDir, "packages/ui/components.json"), "utf-8");

    const plan = await createClassifiedShadcnUpgradePlan(
      projectDir,
      { web: "shared" },
      "web",
    );

    assert.equal(plan.status, "safe-repair");
    assert.equal(plan.targetStyle, "base-nova");
    assert.deepEqual(plan.appModes, { web: "shared" });
    assert.equal(await readFile(join(projectDir, "packages/ui/components.json"), "utf-8"), before);
    await assert.rejects(readFile(join(projectDir, ".monokit.json"), "utf-8"));
  });

  it("requires primitive migration when shared source conflicts with the app selection", async () => {
    const projectDir = await createLegacyProject("radix-ui");

    const plan = await createClassifiedShadcnUpgradePlan(
      projectDir,
      { web: "shared" },
      "web",
    );

    assert.equal(plan.status, "primitive-migration");
    assert.equal(plan.currentPrimitive, "radix");
    assert.equal(plan.targetPrimitive, "base");
  });

  it("does not guess ownership when legacy app designs disagree", async () => {
    const projectDir = await createLegacyProject("@base-ui/react");
    await mkdir(join(projectDir, "apps/admin"), { recursive: true });
    await writeFile(
      join(projectDir, "apps/admin/components.json"),
      JSON.stringify({ style: "radix-maia", tailwind: { baseColor: "zinc" } }),
    );

    const plan = await inspectShadcnUpgrade(projectDir);

    assert.equal(plan.status, "ambiguous");
    assert.match(plan.reasons.join(" "), /disagree/);
  });

  it("does not guess ownership when legacy app designs happen to match", async () => {
    const projectDir = await createLegacyProject("@base-ui/react");

    const plan = await inspectShadcnUpgrade(projectDir);

    assert.equal(plan.status, "ambiguous");
    assert.match(plan.reasons.join(" "), /ownership/);
  });

  it("applies a safe repair while preserving workspace-specific paths", async () => {
    const projectDir = await createLegacyProject("@base-ui/react");
    const plan = await createClassifiedShadcnUpgradePlan(
      projectDir,
      { web: "shared" },
      "web",
    );

    await applySafeShadcnRepair(projectDir, plan);

    const sharedConfig = JSON.parse(
      await readFile(join(projectDir, "packages/ui/components.json"), "utf-8"),
    );
    const appConfig = JSON.parse(
      await readFile(join(projectDir, "apps/web/components.json"), "utf-8"),
    );
    const metadata = JSON.parse(await readFile(join(projectDir, ".monokit.json"), "utf-8"));
    assert.equal(sharedConfig.style, "base-nova");
    assert.equal(sharedConfig.tailwind.css, "../tailwind-config/globals.css");
    assert.equal(appConfig.style, "base-nova");
    assert.equal(appConfig.tailwind.css, "app/globals.css");
    assert.deepEqual(appConfig.aliases, { ui: "@/components/ui" });
    assert.deepEqual(metadata.shadcn.apps, { web: "shared" });
  });

  it("blocks primitive migration when the Git working tree is dirty", async () => {
    const projectDir = await createLegacyProject("radix-ui");
    await execa("git", ["init", "-b", "main"], { cwd: projectDir });
    await execa("git", ["add", "."], { cwd: projectDir });
    await execa(
      "git",
      ["-c", "user.name=Monokit Test", "-c", "user.email=test@monokit.local", "commit", "-m", "initial"],
      { cwd: projectDir },
    );
    await writeFile(join(projectDir, "dirty.txt"), "uncommitted\n");
    const plan = await createClassifiedShadcnUpgradePlan(
      projectDir,
      { web: "shared" },
      "web",
    );

    await assert.rejects(assertPrimitiveMigrationReady(projectDir, plan), /clean Git working tree/);
  });

  it("builds a repair plan from explicit ownership when legacy evidence is ambiguous", async () => {
    const projectDir = await createLegacyProject("@base-ui/react");
    await mkdir(join(projectDir, "apps/admin"), { recursive: true });
    await writeFile(
      join(projectDir, "apps/admin/components.json"),
      JSON.stringify({ style: "radix-maia", tailwind: { baseColor: "zinc" } }),
    );

    const plan = await createClassifiedShadcnUpgradePlan(
      projectDir,
      { web: "shared", admin: "per-app" },
      "web",
    );

    assert.equal(plan.status, "safe-repair");
    assert.equal(plan.targetStyle, "base-nova");
    assert.deepEqual(plan.appModes, { web: "shared", admin: "per-app" });
  });

  it("installs directly imported primitive packages into packages/ui during safe repair", async () => {
    const projectDir = await createLegacyProject("@base-ui/react");
    await writeFile(join(projectDir, "packages/ui/package.json"), JSON.stringify({ dependencies: {} }));
    const plan = await createClassifiedShadcnUpgradePlan(
      projectDir,
      { web: "shared" },
      "web",
    );
    let requestedChanges = { add: [] as string[], remove: [] as string[] };

    await applySafeShadcnRepair(projectDir, plan, async (cwd, changes) => {
      assert.equal(cwd, projectDir);
      requestedChanges = changes;
    });

    assert.deepEqual(requestedChanges, { add: ["@base-ui/react"], remove: [] });
  });

  it("removes a stale primitive dependency while installing the one imported by shared source", async () => {
    const projectDir = await createLegacyProject("@base-ui/react");
    await writeFile(
      join(projectDir, "packages/ui/package.json"),
      JSON.stringify({ dependencies: { "radix-ui": "latest" } }),
    );
    const plan = await createClassifiedShadcnUpgradePlan(
      projectDir,
      { web: "shared" },
      "web",
    );
    let requestedChanges = { add: [] as string[], remove: [] as string[] };

    await applySafeShadcnRepair(projectDir, plan, async (_cwd, changes) => {
      requestedChanges = changes;
    });

    assert.deepEqual(requestedChanges, {
      add: ["@base-ui/react"],
      remove: ["radix-ui"],
    });
  });

  it("recovers a missing canonical config from an explicitly shared app", async () => {
    const projectDir = await createLegacyProject("@base-ui/react");
    await writeMonokitConfig(projectDir, createMonokitConfig(["web"], "shared"));
    await rm(join(projectDir, "packages/ui/components.json"));

    const plan = await inspectShadcnUpgrade(projectDir);

    assert.equal(plan.status, "safe-repair");
    assert.equal(plan.targetStyle, "base-nova");
  });

  it("treats an all per-app project without a shared config as current", async () => {
    const projectDir = await createLegacyProject("@base-ui/react");
    await writeMonokitConfig(projectDir, createMonokitConfig(["web"], "per-app"));
    await rm(join(projectDir, "packages/ui/components.json"));
    await rm(join(projectDir, "packages/ui/src/button.tsx"));

    const plan = await inspectShadcnUpgrade(projectDir);

    assert.equal(plan.status, "current");
    assert.equal(plan.targetConfig, null);
  });

  it("requires classification when ownership metadata omits an existing app", async () => {
    const projectDir = await createLegacyProject("@base-ui/react");
    await mkdir(join(projectDir, "apps/admin"), { recursive: true });
    await writeFile(
      join(projectDir, "apps/admin/components.json"),
      JSON.stringify({ style: "radix-maia", tailwind: { baseColor: "zinc" } }),
    );
    await writeMonokitConfig(projectDir, createMonokitConfig(["web"], "per-app"));

    const plan = await inspectShadcnUpgrade(projectDir);

    assert.equal(plan.status, "ambiguous");
    assert.match(plan.reasons.join(" "), /does not match detected apps/);
  });
});

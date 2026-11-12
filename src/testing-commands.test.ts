import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPlaywrightConfig } from "./e2e-command.js";
import { detectAppPort, detectAppType } from "./utils/app-info.js";
import { addMissingPackageScripts } from "./utils/package-json.js";
import { pmBinaryCommand, pmScriptCommand } from "./utils/pm.js";
import {
  findTestingWorkspace,
  listTestingWorkspaces,
  parseTestingTargetArgs,
} from "./utils/testing-workspace.js";
import {
  createVitestConfig,
  getVitestPackageSpecs,
  writeVitestSetup,
} from "./utils/vitest.js";

const temporaryDirectories: string[] = [];

async function createProject(): Promise<string> {
  const projectDir = await mkdtemp(join(tmpdir(), "monokit-testing-test-"));
  temporaryDirectories.push(projectDir);
  return projectDir;
}

async function writePackage(dir: string, pkg: object): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "package.json"), JSON.stringify(pkg), "utf-8");
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("testing commands", () => {
  it("parses one safe target and forwards only runner arguments", () => {
    assert.deepEqual(parseTestingTargetArgs(["--app", "web", "--", "--watch"]), {
      all: false,
      appName: "web",
      passthrough: ["--watch"],
      shared: false,
    });
    assert.throws(() => parseTestingTargetArgs(["--app", "../outside"]), /Invalid app name/);
    assert.throws(
      () => parseTestingTargetArgs(["--app", "web", "--shared"]),
      /Choose only one target/,
    );
  });

  it("resolves only real first-level workspaces", async () => {
    const projectDir = await createProject();
    await writePackage(join(projectDir, "apps/web"), { name: "web" });
    await mkdir(join(projectDir, "apps/empty"), { recursive: true });
    await writePackage(join(projectDir, "packages/ui"), { name: "@repo/ui" });

    const workspaces = await listTestingWorkspaces(projectDir);

    assert.deepEqual(
      workspaces.map((workspace) => workspace.label),
      ["apps/web", "packages/ui"],
    );
    assert.equal(
      findTestingWorkspace(workspaces, { appName: "web", shared: false })?.packageName,
      "web",
    );
    assert.equal(
      findTestingWorkspace(workspaces, { shared: true })?.packageName,
      "@repo/ui",
    );
  });

  it("detects supported app types and their configured ports", async () => {
    const projectDir = await createProject();
    const nextDir = join(projectDir, "apps/web");
    const viteDir = join(projectDir, "apps/admin");
    await writePackage(nextDir, {
      dependencies: { next: "latest" },
      scripts: { dev: "next dev --port 4100" },
    });
    await writePackage(viteDir, { devDependencies: { vite: "latest" } });
    await writeFile(join(viteDir, "vite.config.ts"), "server: { port: 4200 }", "utf-8");

    assert.equal(await detectAppType(nextDir), "next");
    assert.equal(await detectAppPort(nextDir, "next"), 4100);
    assert.equal(await detectAppType(viteDir), "vite");
    assert.equal(await detectAppPort(viteDir, "vite"), 4200);

    await writePackage(nextDir, {
      dependencies: { next: "latest" },
      scripts: { dev: "next dev -p 4400" },
    });
    assert.equal(await detectAppPort(nextDir, "next"), 4400);
  });

  it("generates app-aware Vitest and Playwright configuration", () => {
    const vitestConfig = createVitestConfig("./src/test/setup.ts");
    const playwrightConfig = createPlaywrightConfig("pnpm dev", 4300);

    assert.match(vitestConfig, /vite-tsconfig-paths/);
    assert.match(vitestConfig, /\.\/src\/test\/setup\.ts/);
    assert.match(vitestConfig, /tests\/e2e\/\*\*/);
    assert.match(vitestConfig, /provider: "v8"/);
    assert.match(playwrightConfig, /command: "pnpm dev"/);
    assert.match(playwrightConfig, /testMatch: "\*\*\/\*\.e2e\.ts"/);
    assert.match(playwrightConfig, /http:\/\/localhost:4300/);
    assert.doesNotMatch(playwrightConfig, /127\.0\.0\.1/);
    assert.match(playwrightConfig, /reuseExistingServer: !process\.env\.CI/);
  });

  it("keeps Vitest coverage on the same version line as Vitest", () => {
    assert.deepEqual(
      getVitestPackageSpecs({
        devDependencies: {
          "@vitest/coverage-v8": "^5.1.0",
          vitest: "^3.2.7",
        },
      }),
      [
        "@testing-library/jest-dom@^6.0.0",
        "@testing-library/react@^16.0.0",
        "@vitejs/plugin-react@^5.0.0",
        "@vitest/coverage-v8@^3.2.7",
        "jsdom@^26.0.0",
        "vite-tsconfig-paths@^5.0.0",
      ],
    );

    assert.deepEqual(
      getVitestPackageSpecs({
        devDependencies: {
          ...Object.fromEntries(
            [
              "@testing-library/jest-dom",
              "@testing-library/react",
              "@vitejs/plugin-react",
              "jsdom",
              "vite-tsconfig-paths",
            ].map((packageName) => [packageName, "latest"]),
          ),
          "@vitest/coverage-v8": "^3.2.7",
          vitest: "^3.2.7",
        },
      }),
      [],
    );
  });

  it("adds missing scripts without replacing user scripts", async () => {
    const projectDir = await createProject();
    const workspaceDir = join(projectDir, "apps/web");
    await writePackage(workspaceDir, {
      scripts: { test: "custom-test-command" },
    });

    const added = await addMissingPackageScripts(workspaceDir, {
      test: "vitest run",
      "test:watch": "vitest",
    });
    const pkg = JSON.parse(await readFile(join(workspaceDir, "package.json"), "utf-8"));

    assert.deepEqual(added, ["test:watch"]);
    assert.equal(pkg.scripts.test, "custom-test-command");
    assert.equal(pkg.scripts["test:watch"], "vitest");
  });

  it("creates a complete Vitest setup with a passing starter test", async () => {
    const projectDir = await createProject();
    const workspaceDir = join(projectDir, "apps/web");
    await writePackage(workspaceDir, { name: "web", scripts: {} });
    await mkdir(join(workspaceDir, "src"), { recursive: true });
    await mkdir(join(workspaceDir, "tests/e2e"), { recursive: true });
    await writeFile(
      join(workspaceDir, "tests/e2e/home.spec.ts"),
      "playwright test",
      "utf-8",
    );

    const result = await writeVitestSetup(workspaceDir);
    const pkg = JSON.parse(await readFile(join(workspaceDir, "package.json"), "utf-8"));

    assert.deepEqual(result, { configCreated: true, sampleCreated: true });
    assert.equal(pkg.scripts.test, "vitest run");
    assert.match(
      await readFile(join(workspaceDir, "src/test/example.test.ts"), "utf-8"),
      /runs Vitest/,
    );
  });

  it("uses package-manager-local scripts and binaries", () => {
    assert.deepEqual(pmScriptCommand("yarn", "e2e", ["--ui"]), {
      command: "yarn",
      args: ["run", "e2e", "--ui"],
    });
    assert.deepEqual(
      pmBinaryCommand("pnpm", "turbo", [
        "run",
        "test",
        "--filter=web",
        "--",
        "--watch",
      ]),
      {
        command: "pnpm",
        args: ["exec", "turbo", "run", "test", "--filter=web", "--", "--watch"],
      },
    );
    assert.deepEqual(pmBinaryCommand("pnpm", "playwright", ["install", "chromium"]), {
      command: "pnpm",
      args: ["exec", "playwright", "install", "chromium"],
    });
    assert.deepEqual(pmBinaryCommand("npm", "playwright", ["install", "chromium"]), {
      command: "npm",
      args: ["exec", "--", "playwright", "install", "chromium"],
    });
  });

  it("repairs only the missing root pipeline when workspace tests already exist", async () => {
    const projectDir = await createProject();
    await writePackage(projectDir, { name: "fixture", scripts: {} });
    await writeFile(join(projectDir, "turbo.json"), JSON.stringify({ tasks: {} }), "utf-8");
    await writePackage(join(projectDir, "apps/web"), {
      name: "web",
      dependencies: { next: "latest" },
      scripts: { test: "custom-test-command" },
    });

    const result = runCli(projectDir, ["test", "init", "--app", "web"]);
    const rootPkg = JSON.parse(await readFile(join(projectDir, "package.json"), "utf-8"));
    const appPkg = JSON.parse(
      await readFile(join(projectDir, "apps/web/package.json"), "utf-8"),
    );
    const turbo = JSON.parse(await readFile(join(projectDir, "turbo.json"), "utf-8"));

    assert.equal(result.status, 0);
    assert.equal(rootPkg.scripts.test, "turbo run test");
    assert.equal(appPkg.scripts.test, "custom-test-command");
    assert.deepEqual(turbo.tasks.test.outputs, ["coverage/**"]);
    assert.match(result.stdout, /Root test pipeline added/);
  });

  it("preserves Vitest settings inside an existing Vite config", async () => {
    const projectDir = await createProject();
    const appDir = join(projectDir, "apps/admin");
    await writePackage(projectDir, { scripts: { test: "turbo run test" } });
    await writeFile(join(projectDir, "turbo.json"), JSON.stringify({ tasks: { test: {} } }));
    await writePackage(appDir, {
      name: "admin",
      devDependencies: { vite: "latest", vitest: "latest" },
    });
    await writeFile(
      join(appDir, "vite.config.ts"),
      "export default { test: { environment: 'jsdom' } };",
      "utf-8",
    );

    const result = runCli(projectDir, ["test", "init", "--app", "admin"]);
    const pkg = JSON.parse(await readFile(join(appDir, "package.json"), "utf-8"));

    assert.equal(result.status, 0);
    await assert.rejects(readFile(join(appDir, "vitest.config.ts"), "utf-8"));
    assert.equal(pkg.scripts.test, "vitest run");
    assert.match(
      await readFile(join(appDir, "test/example.test.ts"), "utf-8"),
      /runs Vitest/,
    );
    assert.match(result.stdout, /Starter test added/);
  });

  it("preserves an existing Playwright config without preparing a browser", async () => {
    const projectDir = await createProject();
    const appDir = join(projectDir, "apps/web");
    await writePackage(projectDir, { packageManager: "pnpm@10.0.0" });
    await writeFile(join(projectDir, "turbo.json"), JSON.stringify({ tasks: {} }), "utf-8");
    await writeFile(join(projectDir, ".gitignore"), "node_modules\n", "utf-8");
    await writePackage(appDir, {
      name: "web",
      dependencies: { next: "latest" },
      devDependencies: { "@playwright/test": "latest" },
      scripts: { dev: "next dev --port 3000" },
    });
    await writeFile(
      join(appDir, "playwright.config.ts"),
      "export default { projects: [{ name: 'firefox' }] };",
      "utf-8",
    );

    const result = runCli(projectDir, ["e2e", "init", "--app", "web"]);
    const config = await readFile(join(appDir, "playwright.config.ts"), "utf-8");
    const pkg = JSON.parse(await readFile(join(appDir, "package.json"), "utf-8"));

    assert.equal(result.status, 0);
    assert.match(config, /firefox/);
    assert.equal(pkg.scripts.e2e, "playwright test");
    assert.match(result.stdout, /Existing Playwright config preserved/);
    assert.doesNotMatch(result.stdout, /Preparing Chromium/);
  });

  it("rejects app path traversal before running a workspace command", async () => {
    const projectDir = await createProject();
    await writePackage(projectDir, { scripts: { test: "turbo run test" } });
    await writeFile(join(projectDir, "turbo.json"), JSON.stringify({ tasks: {} }), "utf-8");

    const result = runCli(projectDir, ["test", "--app", "../outside"]);

    assert.equal(result.status, 1);
    assert.match(`${result.stdout}${result.stderr}`, /Invalid app name/);
  });
});

function runCli(cwd: string, args: string[]) {
  const entryPath = fileURLToPath(new URL("./monokit.ts", import.meta.url));
  const tsxCliPath = fileURLToPath(import.meta.resolve("tsx/cli"));
  return spawnSync(process.execPath, [tsxCliPath, entryPath, ...args], {
    cwd,
    encoding: "utf-8",
  });
}

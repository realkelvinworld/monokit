import * as p from "@clack/prompts";
import pc from "picocolors";
import { join } from "path";
import fs from "fs-extra";

import { detectAppPort, detectAppType } from "./utils/app-info.js";
import { run } from "./utils/exec.js";
import { addMissingPackageScripts } from "./utils/package-json.js";
import {
  detectProjectPackageManager,
  pmAddWorkspaceDevDependencies,
  pmBinaryCommand,
  pmRunScript,
  pmScriptCommand,
} from "./utils/pm.js";
import {
  findTestingWorkspace,
  listTestingWorkspaces,
  parseTestingTargetArgs,
  type TestingTargetOptions,
  type TestingWorkspace,
} from "./utils/testing-workspace.js";

const PLAYWRIGHT_CONFIG_NAMES = [
  "playwright.config.ts",
  "playwright.config.js",
  "playwright.config.mts",
  "playwright.config.mjs",
  "playwright.config.cts",
  "playwright.config.cjs",
];

export function createPlaywrightConfig(devCommand: string, port: number): string {
  const baseUrl = `http://localhost:${port}`;
  return `import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "dot" : "html",
  use: {
    baseURL: "${baseUrl}",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "${devCommand}",
    url: "${baseUrl}",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
`;
}

export async function e2eCommand(projectDir: string, args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;

  if (subcommand === "init") {
    await initializeE2e(projectDir, rest);
    return;
  }

  await runE2e(projectDir, args);
}

async function initializeE2e(projectDir: string, args: string[]): Promise<void> {
  p.intro(pc.bgCyan(pc.black(" monokit e2e init ")));

  const options = parseOptionsOrExit(args);
  if (options.all || options.shared || options.passthrough.length > 0) {
    fail("E2E setup requires one app. Use --app <name>.");
  }

  const workspace = await selectApp(projectDir, options);
  const appType = await detectAppType(workspace.dir);
  if (appType === "unknown") {
    fail(`Unsupported framework in ${workspace.label}. Monokit supports Next.js and Vite + React.`);
  }

  const pm = await detectProjectPackageManager(projectDir);
  const pkgPath = join(workspace.dir, "package.json");
  const pkg = await fs.readJson(pkgPath);
  const installed = {
    ...(pkg.dependencies as Record<string, string> | undefined),
    ...(pkg.devDependencies as Record<string, string> | undefined),
  };

  if (!installed["@playwright/test"]) {
    const spinner = p.spinner();
    spinner.start(`Installing Playwright in ${workspace.label}`);
    try {
      await pmAddWorkspaceDevDependencies(pm, ["@playwright/test"], workspace.dir, projectDir);
      spinner.stop("Playwright installed");
    } catch {
      spinner.stop("Playwright was not installed");
      fail(`Could not install Playwright in ${workspace.label}.`);
    }
  }

  const existingConfig = await findExistingConfig(workspace.dir);
  if (!existingConfig) {
    const port = await detectAppPort(workspace.dir, appType);
    await fs.writeFile(
      join(workspace.dir, "playwright.config.ts"),
      createPlaywrightConfig(`${pmRunScript(pm)} dev`, port),
      "utf-8",
    );

    const specPath = join(workspace.dir, "tests/e2e/home.e2e.ts");
    await fs.ensureDir(join(workspace.dir, "tests/e2e"));
    if (!(await fs.pathExists(specPath))) {
      await fs.writeFile(
        specPath,
        `import { expect, test } from "@playwright/test";

test("homepage loads", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("body")).toBeVisible();
});
`,
        "utf-8",
      );
    }
  }

  await addMissingPackageScripts(workspace.dir, {
    e2e: "playwright test",
    "e2e:report": "playwright show-report",
    "e2e:ui": "playwright test --ui",
  });
  await ensurePlaywrightIgnores(projectDir);

  if (!existingConfig) {
    const browserSpinner = p.spinner();
    browserSpinner.start("Preparing Chromium");
    const browserCommand = pmBinaryCommand(pm, "playwright", ["install", "chromium"]);
    try {
      await run(browserCommand.command, browserCommand.args, workspace.dir);
      browserSpinner.stop("Chromium ready");
    } catch {
      browserSpinner.stop("Chromium was not installed");
      fail("Could not install Chromium. Check the Playwright output above and retry.");
    }
  }

  const result = existingConfig
    ? `Existing Playwright config preserved in ${workspace.label}.`
    : `Playwright configured in ${workspace.label}.`;
  p.outro(pc.green(`${result} Run monokit e2e --app ${workspace.name}.`));
}

async function runE2e(projectDir: string, args: string[]): Promise<void> {
  p.intro(pc.bgCyan(pc.black(" monokit e2e ")));

  const options = parseOptionsOrExit(args);
  if (options.all || options.shared) {
    fail("E2E runs require one app. Use --app <name>.");
  }

  const workspace = await selectApp(projectDir, options);
  if (!(await findExistingConfig(workspace.dir))) {
    fail(
      `Playwright is not configured in ${workspace.label}. Run "monokit e2e init --app ${workspace.name}" first.`,
    );
  }

  const pkg = await fs.readJson(join(workspace.dir, "package.json"));
  if (!pkg.scripts?.e2e) {
    fail(
      `The e2e script is missing in ${workspace.label}. Run "monokit e2e init --app ${workspace.name}" first.`,
    );
  }

  const pm = await detectProjectPackageManager(projectDir);
  const command = pmScriptCommand(pm, "e2e", options.passthrough);
  p.log.info(`Running browser tests for ${workspace.label}`);
  try {
    await run(command.command, command.args, workspace.dir);
  } catch {
    p.outro(pc.red(`Browser tests failed for ${workspace.label}.`));
    process.exit(1);
  }
  p.outro(pc.green(`Browser tests passed for ${workspace.label}.`));
}

async function selectApp(
  projectDir: string,
  options: TestingTargetOptions,
): Promise<TestingWorkspace> {
  const workspaces = await listTestingWorkspaces(projectDir, false);
  if (workspaces.length === 0) fail("No apps were found.");

  const requested = findTestingWorkspace(workspaces, options);
  if (options.appName) {
    if (!requested) fail(`apps/${options.appName} was not found.`);
    return requested;
  }

  const selection = await p.select({
    message: "Which app?",
    options: workspaces.map((workspace) => ({
      label: workspace.label,
      value: workspace.label,
    })),
  });
  if (p.isCancel(selection)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  return workspaces.find((workspace) => workspace.label === selection)!;
}

async function findExistingConfig(workspaceDir: string): Promise<string | undefined> {
  for (const configName of PLAYWRIGHT_CONFIG_NAMES) {
    if (await fs.pathExists(join(workspaceDir, configName))) return configName;
  }
  return undefined;
}

async function ensurePlaywrightIgnores(projectDir: string): Promise<void> {
  const ignorePath = join(projectDir, ".gitignore");
  const content = await fs.readFile(ignorePath, "utf-8").catch(() => "");
  const additions = ["playwright-report", "test-results", "blob-report"].filter(
    (entry) => !content.split(/\r?\n/).includes(entry),
  );
  if (additions.length === 0) return;

  const separator = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
  await fs.writeFile(
    ignorePath,
    `${content}${separator}\n# browser test output\n${additions.join("\n")}\n`,
    "utf-8",
  );
}

function parseOptionsOrExit(args: string[]): TestingTargetOptions {
  try {
    return parseTestingTargetArgs(args);
  } catch (error) {
    fail(error instanceof Error ? error.message : "Invalid e2e options.");
  }
}

function fail(message: string): never {
  p.cancel(message);
  process.exit(1);
}

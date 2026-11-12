import * as p from "@clack/prompts";
import pc from "picocolors";
import { join } from "path";
import fs from "fs-extra";

import { detectAppType } from "./utils/app-info.js";
import { run } from "./utils/exec.js";
import { addMissingPackageScripts } from "./utils/package-json.js";
import {
  detectProjectPackageManager,
  pmAddWorkspaceDevDependencies,
  pmBinaryCommand,
} from "./utils/pm.js";
import {
  findTestingWorkspace,
  listTestingWorkspaces,
  parseTestingTargetArgs,
  type TestingTargetOptions,
  type TestingWorkspace,
} from "./utils/testing-workspace.js";
import {
  ensureVitestSample,
  getVitestPackageSpecs,
  hasVitestSetup,
  VITEST_PACKAGES,
  writeVitestSetup,
} from "./utils/vitest.js";

export async function testCommand(projectDir: string, args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;

  if (subcommand === "init") {
    await initializeTests(projectDir, rest);
    return;
  }

  await runTests(projectDir, args);
}

async function initializeTests(projectDir: string, args: string[]): Promise<void> {
  p.intro(pc.bgCyan(pc.black(" monokit test init ")));

  const options = parseOptionsOrExit(args);
  if (options.all || options.passthrough.length > 0) {
    fail("Use --app <name> or --shared when configuring tests.");
  }

  const workspace = await selectWorkspace(projectDir, options, true);
  const appType = workspace.type === "app" ? await detectAppType(workspace.dir) : "vite";
  if (appType === "unknown") {
    fail(`Unsupported framework in ${workspace.label}. Monokit supports Next.js and Vite + React.`);
  }

  const rootPipelineAdded = await ensureRootTestPipeline(projectDir);
  const pm = await detectProjectPackageManager(projectDir);
  const pkg = await fs.readJson(join(workspace.dir, "package.json"));
  const testScript = pkg.scripts?.test as string | undefined;
  const vitestConfigured = await hasVitestSetup(workspace.dir);

  if (testScript && !vitestConfigured) {
    const rootUpdate = rootPipelineAdded ? " Root test pipeline added." : "";
    p.outro(pc.green(`Existing test script preserved in ${workspace.label}.${rootUpdate}`));
    return;
  }

  if (vitestConfigured) {
    const installedCoverage = Boolean(
      pkg.dependencies?.["@vitest/coverage-v8"] ??
        pkg.devDependencies?.["@vitest/coverage-v8"],
    );
    const corePackages = [
      "vitest",
      ...(installedCoverage ? ["@vitest/coverage-v8"] : []),
    ];
    const packageSpecs = getVitestPackageSpecs(pkg, corePackages);
    await installVitestPackages(pm, packageSpecs, workspace, projectDir);
    await addMissingPackageScripts(workspace.dir, {
      test: "vitest run",
      "test:watch": "vitest",
    });
    const sampleCreated = await ensureVitestSample(workspace.dir);
    const rootUpdate = rootPipelineAdded ? " Root test pipeline added." : "";
    const message = sampleCreated
      ? `Starter test added to ${workspace.label}.`
      : `Tests are already configured in ${workspace.label}.`;
    p.outro(pc.green(`${message}${rootUpdate} Run monokit test --${targetFlag(workspace)}.`));
    return;
  }

  const packageSpecs = getVitestPackageSpecs(pkg, VITEST_PACKAGES);
  await installVitestPackages(pm, packageSpecs, workspace, projectDir);
  await writeVitestSetup(workspace.dir);

  p.outro(
    pc.green(
      `Vitest configured in ${workspace.label}. Run monokit test --${targetFlag(workspace)}.`,
    ),
  );
}

async function runTests(projectDir: string, args: string[]): Promise<void> {
  p.intro(pc.bgCyan(pc.black(" monokit test ")));

  const options = parseOptionsOrExit(args);
  const pm = await detectProjectPackageManager(projectDir);

  if (options.all) {
    const turboArgs = [
      "run",
      "test",
      ...(options.passthrough.length > 0 ? ["--", ...options.passthrough] : []),
    ];
    const command = pmBinaryCommand(pm, "turbo", turboArgs);
    p.log.info("Running all test tasks through Turbo");
    await runTestsOrExit(command.command, command.args, projectDir, "Some test tasks failed.");
    p.outro(pc.green("All test tasks passed."));
    return;
  }

  const workspace = await selectWorkspace(projectDir, options, true);
  const pkg = await fs.readJson(join(workspace.dir, "package.json"));
  if (!pkg.scripts?.test) {
    fail(
      `No test script found in ${workspace.label}. Run "monokit test init --${targetFlag(workspace)}" first.`,
    );
  }

  const turboArgs = [
    "run",
    "test",
    `--filter=${workspace.packageName}`,
    ...(options.passthrough.length > 0 ? ["--", ...options.passthrough] : []),
  ];
  const command = pmBinaryCommand(pm, "turbo", turboArgs);
  p.log.info(`Running tests in ${workspace.label}`);
  await runTestsOrExit(
    command.command,
    command.args,
    projectDir,
    `Tests failed in ${workspace.label}.`,
  );
  p.outro(pc.green(`Tests passed in ${workspace.label}.`));
}

async function selectWorkspace(
  projectDir: string,
  options: TestingTargetOptions,
  includeShared: boolean,
): Promise<TestingWorkspace> {
  const workspaces = await listTestingWorkspaces(projectDir, includeShared);
  if (workspaces.length === 0) fail("No testable workspaces were found.");

  const requested = findTestingWorkspace(workspaces, options);
  if (options.appName || options.shared) {
    if (!requested) {
      const target = options.shared ? "packages/ui" : `apps/${options.appName}`;
      fail(`${target} was not found.`);
    }
    return requested;
  }

  const selection = await p.select({
    message: "Which workspace?",
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

async function ensureRootTestPipeline(projectDir: string): Promise<boolean> {
  let changed = false;
  const pkgPath = join(projectDir, "package.json");
  const pkg = await fs.readJson(pkgPath);
  pkg.scripts = pkg.scripts ?? {};
  if (!pkg.scripts.test) {
    pkg.scripts.test = "turbo run test";
    await fs.writeJson(pkgPath, pkg, { spaces: 2 });
    changed = true;
  }

  const turboPath = join(projectDir, "turbo.json");
  const turbo = await fs.readJson(turboPath).catch(() => null);
  if (turbo?.tasks && !turbo.tasks.test) {
    turbo.tasks.test = {
      dependsOn: ["^build"],
      inputs: ["$TURBO_DEFAULT$"],
      outputs: ["coverage/**"],
    };
    await fs.writeJson(turboPath, turbo, { spaces: 2 });
    changed = true;
  }

  return changed;
}

async function installVitestPackages(
  pm: Awaited<ReturnType<typeof detectProjectPackageManager>>,
  packages: string[],
  workspace: TestingWorkspace,
  projectDir: string,
): Promise<void> {
  if (packages.length === 0) return;

  const spinner = p.spinner();
  spinner.start(`Installing Vitest tools in ${workspace.label}`);
  try {
    await pmAddWorkspaceDevDependencies(pm, packages, workspace.dir, projectDir);
    spinner.stop("Vitest tools installed");
  } catch {
    spinner.stop("Vitest tools were not installed");
    fail(`Could not install Vitest tools in ${workspace.label}.`);
  }
}

function parseOptionsOrExit(args: string[]): TestingTargetOptions {
  try {
    return parseTestingTargetArgs(args);
  } catch (error) {
    fail(error instanceof Error ? error.message : "Invalid test options.");
  }
}

function targetFlag(workspace: TestingWorkspace): string {
  return workspace.type === "shared" ? "shared" : `app ${workspace.name}`;
}

function fail(message: string): never {
  p.cancel(message);
  process.exit(1);
}

async function runTestsOrExit(
  command: string,
  args: string[],
  cwd: string,
  failureMessage: string,
): Promise<void> {
  try {
    await run(command, args, cwd);
  } catch {
    p.outro(pc.red(failureMessage));
    process.exit(1);
  }
}

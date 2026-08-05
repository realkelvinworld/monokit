import * as p from "@clack/prompts";
import fs from "fs-extra";
import { join, relative } from "path";
import pc from "picocolors";

import { type AppType, detectAppType } from "./utils/app-type.js";
import { run } from "./utils/exec.js";
import { type PackageManager, detectProjectPackageManager } from "./utils/pm.js";

// ─── Vitest config templates ──────────────────────────────────────────────────

function vitestConfig(appType: AppType): string {
  if (appType === "next") {
    return `import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
`;
  }

  if (appType === "sveltekit") {
    // placeholder — full SvelteKit support is not yet implemented
    return `import { defineConfig } from "vitest/config";
import { sveltekit } from "@sveltejs/kit/vite";

export default defineConfig({
  plugins: [sveltekit()],
  test: {
    environment: "jsdom",
    globals: true,
  },
});
`;
  }

  // vite (default)
  return `import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
  },
});
`;
}

const sampleTest = `import { describe, it, expect } from "vitest";

describe("example", () => {
  it("should pass", () => {
    expect(1 + 1).toBe(2);
  });
});
`;

// ─── Workspace helpers ────────────────────────────────────────────────────────

async function detectWorkspaces(cwd: string): Promise<{ label: string; dir: string }[]> {
  const workspaces: { label: string; dir: string }[] = [
    { label: "Shared (packages/ui)", dir: join(cwd, "packages/ui") },
  ];

  const appsDir = join(cwd, "apps");
  const entries = await fs.readdir(appsDir).catch(() => [] as string[]);
  for (const entry of entries) {
    if (entry === ".gitkeep") continue;
    const stat = await fs.stat(join(appsDir, entry)).catch(() => null);
    if (stat?.isDirectory()) {
      workspaces.push({ label: `apps/${entry}`, dir: join(appsDir, entry) });
    }
  }

  return workspaces;
}

async function resolveWorkspace(
  cwd: string,
  args: string[],
): Promise<{ label: string; dir: string } | null> {
  const isShared = args.includes("--shared");
  const appIdx = args.indexOf("--app");
  const appName = appIdx !== -1 ? args[appIdx + 1] : undefined;

  const workspaces = await detectWorkspaces(cwd);

  if (isShared) {
    return workspaces.find((w) => w.dir === join(cwd, "packages/ui")) ?? null;
  }

  if (appName) {
    const dir = join(cwd, "apps", appName);
    return { label: `apps/${appName}`, dir };
  }

  const chosen = await p.select({
    message: "Which workspace?",
    options: workspaces.map((w) => ({ value: w.dir, label: w.label })),
  });

  if (p.isCancel(chosen)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  return workspaces.find((w) => w.dir === chosen) ?? null;
}

// ─── PM-aware multi-package dev install ───────────────────────────────────────

async function installDevPackages(
  pm: PackageManager,
  packages: string[],
  targetDir: string,
  cwd: string,
): Promise<void> {
  if (pm === "pnpm") {
    const rel = relative(cwd, targetDir);
    await run("pnpm", ["add", "-D", ...packages, `--filter=./${rel}`], cwd);
    return;
  }
  if (pm === "bun") {
    await run("bun", ["add", "-D", ...packages], targetDir);
    return;
  }
  if (pm === "yarn") {
    const pkg = await fs.readJson(join(targetDir, "package.json")).catch(() => ({}));
    const wsName = (pkg.name as string | undefined) ?? targetDir;
    await run("yarn", ["workspace", wsName, "add", "-D", ...packages], cwd);
    return;
  }
  // npm
  const rel = relative(cwd, targetDir);
  await run("npm", ["install", "-D", ...packages, "-w", rel], cwd);
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init(cwd: string, args: string[]): Promise<void> {
  p.intro(pc.bgCyan(pc.black(" monokit test init ")));

  const pm = await detectProjectPackageManager(cwd);
  const workspace = await resolveWorkspace(cwd, args);

  if (!workspace) {
    p.cancel("Workspace not found.");
    process.exit(1);
  }

  if (!fs.existsSync(workspace.dir)) {
    p.cancel(`${workspace.label} not found. Check the name and try again.`);
    process.exit(1);
  }

  const appType = await detectAppType(workspace.dir);

  if (appType === "sveltekit") {
    p.cancel("SvelteKit support is coming soon. Use vitest manually for now.");
    process.exit(1);
  }

  const s = p.spinner();

  // 1 — install vitest + jsdom + react plugin
  const packages = ["vitest", "jsdom", "@vitejs/plugin-react"];
  s.start(`Installing ${packages.join(", ")}`);
  await installDevPackages(pm, packages, workspace.dir, cwd);
  s.stop("Packages installed");

  // 2 — write vitest.config.ts
  s.start("Writing vitest.config.ts");
  const configPath = join(workspace.dir, "vitest.config.ts");
  await fs.writeFile(configPath, vitestConfig(appType), "utf-8");
  s.stop("vitest.config.ts written");

  // 3 — add test script to package.json
  s.start("Adding test script to package.json");
  const pkgPath = join(workspace.dir, "package.json");
  const pkg = await fs.readJson(pkgPath);
  pkg.scripts = pkg.scripts ?? {};
  if (!pkg.scripts.test) {
    pkg.scripts.test = "vitest run";
    pkg.scripts["test:watch"] = "vitest";
    pkg.scripts["test:coverage"] = "vitest run --coverage";
    await fs.writeJson(pkgPath, pkg, { spaces: 2 });
    s.stop("test scripts added");
  } else {
    s.stop("test script already exists — skipped");
  }

  // 4 — create a sample test
  const testsDir = join(workspace.dir, "src/__tests__");
  const samplePath = join(testsDir, "example.test.ts");
  if (!fs.existsSync(samplePath)) {
    s.start("Creating sample test");
    await fs.ensureDir(testsDir);
    await fs.writeFile(samplePath, sampleTest, "utf-8");
    s.stop("Sample test created");
  }

  p.outro(
    pc.green("Done! ") +
      pc.dim(`Run ${pc.white(`monokit test --app ${workspace.label.replace("apps/", "")}`)} to try it.`),
  );
}

// ─── Run ──────────────────────────────────────────────────────────────────────

async function runTests(cwd: string, args: string[]): Promise<void> {
  p.intro(pc.bgCyan(pc.black(" monokit test ")));

  const pm = await detectProjectPackageManager(cwd);

  // --all: turbo run test across every workspace
  if (args.includes("--all")) {
    p.log.info("Running tests across all workspaces via turbo…");
    await run("turbo", ["run", "test"], cwd);
    p.outro(pc.green("Done!"));
    return;
  }

  const workspace = await resolveWorkspace(cwd, args);

  if (!workspace || !fs.existsSync(workspace.dir)) {
    p.cancel("Workspace not found.");
    process.exit(1);
  }

  // Verify a test script exists
  const pkg = await fs.readJson(join(workspace.dir, "package.json")).catch(() => ({}));
  if (!pkg.scripts?.test) {
    p.cancel(
      `No test script found in ${workspace.label}. Run ${pc.white("monokit test init")} first.`,
    );
    process.exit(1);
  }

  // Collect passthrough args (strip monokit-specific flags)
  const passthroughArgs = stripMonokitFlags(args);
  const runArgs = ["run", "test"];
  if (passthroughArgs.length) runArgs.push("--", ...passthroughArgs);

  p.log.info(`Running tests in ${workspace.label}…`);
  await run(pm, runArgs, workspace.dir);

  p.outro(pc.green("Done!"));
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function testCommand(cwd: string, args: string[]): Promise<void> {
  const subcommand = args[0];

  if (subcommand === "init") {
    await init(cwd, args.slice(1));
  } else {
    await runTests(cwd, args);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stripMonokitFlags(args: string[]): string[] {
  const skip = new Set<number>();
  const appIdx = args.indexOf("--app");
  if (appIdx !== -1) {
    skip.add(appIdx);
    skip.add(appIdx + 1);
  }
  return args.filter((a, i) => {
    if (skip.has(i)) return false;
    if (a === "--shared" || a === "--all") return false;
    return true;
  });
}

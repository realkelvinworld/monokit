import * as p from "@clack/prompts";
import fs from "fs-extra";
import { join, relative } from "path";
import pc from "picocolors";

import { run } from "./utils/exec.js";
import { type PackageManager, detectProjectPackageManager } from "./utils/pm.js";

export type Destination = { label: string; dir: string; isRoot: boolean };

// ─── Dep-type inference ───────────────────────────────────────────────────────

function packageBaseName(input: string): string {
  if (input.startsWith("@")) {
    return "@" + input.slice(1).split("@")[0]!; // @scope/name@version → @scope/name
  }
  return input.split("@")[0]!; // name@version → name
}

const DEV_PACKAGES = new Set([
  "typescript", "eslint", "prettier", "vite", "turbo", "tsx", "esbuild",
  "rollup", "webpack", "parcel", "jest", "vitest", "playwright", "cypress",
  "tailwindcss", "postcss", "autoprefixer", "husky", "lint-staged", "cross-env",
  "prettier-plugin-tailwindcss", "@vitejs/plugin-react", "@vitejs/plugin-react-swc",
  "eslint-config-next",
]);

function inferDepType(pkg: string, isRoot: boolean): "dev" | "dep" {
  if (isRoot) return "dev";
  const name = packageBaseName(pkg);
  if (name.startsWith("@types/")) return "dev";
  if (DEV_PACKAGES.has(name)) return "dev";
  if (name.includes("eslint-") || name.includes("-eslint") || name.startsWith("prettier-plugin-")) return "dev";
  return "dep";
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function install(cwd: string, args: string[]): Promise<void> {
  p.intro(pc.bgCyan(pc.black(" monokit install ")));

  const pm = await detectProjectPackageManager(cwd);

  // ── Package name ──────────────────────────────────────────────────────────

  const pkgArg = args.find((a) => !a.startsWith("-"));
  let packageName: string;

  if (pkgArg) {
    packageName = pkgArg;
  } else {
    const input = await p.text({
      message: "Package to install?",
      placeholder: "e.g. lucide-react or zod@3.22.0",
      validate: (v) => (!v.trim() ? "Package name is required" : undefined),
    });
    if (p.isCancel(input)) { p.cancel("Cancelled."); process.exit(0); }
    packageName = input as string;
  }

  // ── Destination ───────────────────────────────────────────────────────────

  const destinations = await buildDestinations(cwd);

  const destValue = await p.select({
    message: "Install where?",
    options: destinations.map((d) => ({
      value: d.dir,
      label: d.label,
      hint: d.isRoot
        ? "scripts & tooling only — NOT importable by app code"
        : d.dir.includes("packages/ui")
          ? "importable by all apps via @repo/ui"
          : "only available in this app",
    })),
  });
  if (p.isCancel(destValue)) { p.cancel("Cancelled."); process.exit(0); }

  const chosen = destinations.find((d) => d.dir === destValue)!;

  // ── Dependency type ───────────────────────────────────────────────────────

  const defaultDev = inferDepType(packageName, chosen.isRoot) === "dev";

  const depType = await p.select({
    message: `${packageName} looks like a ${defaultDev ? "dev dependency" : "dependency"} — confirm or change:`,
    options: [
      {
        value: "dep",
        label: "Dependency",
        hint: "goes in dependencies — needed at runtime",
      },
      {
        value: "dev",
        label: "Dev dependency  (-D)",
        hint: "goes in devDependencies — build/tooling only",
      },
    ],
    initialValue: defaultDev ? "dev" : "dep",
  });
  if (p.isCancel(depType)) { p.cancel("Cancelled."); process.exit(0); }

  const isDev = depType === "dev";

  // ── Summary + confirm ─────────────────────────────────────────────────────

  const rel = chosen.isRoot ? "root workspace" : relative(cwd, chosen.dir);

  p.note(
    [
      `Package     ${pc.cyan(packageName)}`,
      `Install to  ${pc.cyan(rel)}`,
      `Type        ${pc.cyan(isDev ? "devDependency" : "dependency")}`,
      `PM          ${pc.cyan(pm)}`,
    ].join("\n"),
    "Summary",
  );

  const proceed = await p.confirm({ message: "Proceed?", initialValue: true });
  if (p.isCancel(proceed) || !proceed) { p.cancel("Cancelled."); process.exit(0); }

  // ── Install ───────────────────────────────────────────────────────────────

  const s = p.spinner();
  s.start(`Installing ${packageName}`);

  await runInstall(pm, packageName, chosen.dir, isDev, chosen.isRoot, cwd);

  s.stop(`${packageName} installed`);

  p.outro(
    pc.green("Done!") +
      (chosen.dir === join(cwd, "packages/ui")
        ? pc.dim(`  Re-export from packages/ui/src/index.ts if needed.`)
        : ""),
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export async function buildDestinations(cwd: string): Promise<Destination[]> {
  const destinations: Destination[] = [
    {
      label: "Shared (packages/ui)",
      dir: join(cwd, "packages/ui"),
      isRoot: false,
    },
  ];

  // Add each app
  const appsDir = join(cwd, "apps");
  const entries = await fs.readdir(appsDir).catch(() => [] as string[]);
  for (const entry of entries) {
    if (entry === ".gitkeep") continue;
    const stat = await fs.stat(join(appsDir, entry)).catch(() => null);
    if (stat?.isDirectory()) {
      destinations.push({
        label: `apps/${entry}`,
        dir: join(appsDir, entry),
        isRoot: false,
      });
    }
  }

  // Root last — less common, mostly for dev tooling
  destinations.push({
    label: "Root workspace",
    dir: cwd,
    isRoot: true,
  });

  return destinations;
}

async function runInstall(
  pm: PackageManager,
  pkg: string,
  targetDir: string,
  isDev: boolean,
  isRoot: boolean,
  projectDir: string,
): Promise<void> {
  const dev = isDev ? ["-D"] : [];

  if (pm === "pnpm") {
    if (isRoot) {
      await run("pnpm", ["add", ...dev, pkg, "-w"], projectDir);
    } else {
      const rel = relative(projectDir, targetDir);
      await run("pnpm", ["add", ...dev, pkg, `--filter=./${rel}`], projectDir);
    }
    return;
  }

  if (pm === "bun") {
    if (isRoot) {
      await run("bun", ["add", ...dev, pkg], projectDir);
    } else {
      await run("bun", ["add", ...dev, pkg], targetDir);
    }
    return;
  }

  if (pm === "yarn") {
    if (isRoot) {
      await run("yarn", ["add", ...dev, "-W", pkg], projectDir);
    } else {
      const wsName = await getWorkspaceName(targetDir);
      await run("yarn", ["workspace", wsName, "add", ...dev, pkg], projectDir);
    }
    return;
  }

  // npm
  if (isRoot) {
    await run("npm", ["install", ...dev, pkg], projectDir);
  } else {
    const rel = relative(projectDir, targetDir);
    await run("npm", ["install", ...dev, pkg, `-w`, rel], projectDir);
  }
}

export async function getWorkspaceName(dir: string): Promise<string> {
  const pkg = await fs.readJson(join(dir, "package.json")).catch(() => ({}));
  return (pkg.name as string | undefined) ?? dir;
}

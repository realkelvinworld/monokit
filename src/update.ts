import * as p from "@clack/prompts";
import fs from "fs-extra";
import { join, relative } from "path";
import pc from "picocolors";

import { buildDestinations, getWorkspaceName } from "./install.js";
import { run } from "./utils/exec.js";
import { type PackageManager, detectProjectPackageManager } from "./utils/pm.js";

export async function update(cwd: string, args: string[]): Promise<void> {
  p.intro(pc.bgCyan(pc.black(" monokit update ")));

  const pm = await detectProjectPackageManager(cwd);

  // ── Package name ──────────────────────────────────────────────────────────

  const pkgArg = args.find((a) => !a.startsWith("-"));
  let packageName: string;

  if (pkgArg) {
    packageName = pkgArg;
  } else {
    const input = await p.text({
      message: "Package to update?",
      placeholder: "e.g. lucide-react or zod@3.22.0",
      validate: (v) => (!v.trim() ? "Package name is required" : undefined),
    });
    if (p.isCancel(input)) { p.cancel("Cancelled."); process.exit(0); }
    packageName = input as string;
  }

  // ── Destination ───────────────────────────────────────────────────────────

  const destinations = await buildDestinations(cwd);

  const destValue = await p.select({
    message: "Update in which workspace?",
    options: destinations.map((d) => ({
      value: d.dir,
      label: d.label,
      hint: d.isRoot
        ? "root workspace"
        : d.dir.includes("packages/ui")
          ? "shared package"
          : "this app only",
    })),
  });
  if (p.isCancel(destValue)) { p.cancel("Cancelled."); process.exit(0); }

  const chosen = destinations.find((d) => d.dir === destValue)!;
  const rel = chosen.isRoot ? "root workspace" : relative(cwd, chosen.dir);

  // ── Check package exists in target workspace ──────────────────────────────

  const baseName = packageBaseName(packageName);
  const isInstalled = await isPackageInstalled(chosen.dir, baseName);

  if (!isInstalled) {
    p.log.warn(`${pc.cyan(baseName)} is not installed in ${pc.cyan(rel)}.`);
    const shouldInstall = await p.confirm({
      message: "Install it instead?",
      initialValue: true,
    });
    if (p.isCancel(shouldInstall) || !shouldInstall) { p.cancel("Cancelled."); process.exit(0); }

    const { install } = await import("./install.js");
    await install(cwd, [packageName]);
    return;
  }

  // ── Summary + confirm ─────────────────────────────────────────────────────

  p.note(
    [
      `Package    ${pc.cyan(packageName)}`,
      `Update in  ${pc.cyan(rel)}`,
      `PM         ${pc.cyan(pm)}`,
    ].join("\n"),
    "Summary",
  );

  const proceed = await p.confirm({ message: "Proceed?", initialValue: true });
  if (p.isCancel(proceed) || !proceed) { p.cancel("Cancelled."); process.exit(0); }

  // ── Update ────────────────────────────────────────────────────────────────

  const s = p.spinner();
  s.start(`Updating ${packageName}`);
  await runUpdate(pm, packageName, chosen.dir, chosen.isRoot, cwd);
  s.stop(`${packageName} updated`);

  p.outro(pc.green("Done!"));
}

async function runUpdate(
  pm: PackageManager,
  pkg: string,
  targetDir: string,
  isRoot: boolean,
  projectDir: string,
): Promise<void> {
  // If a specific version is requested (e.g. zod@3.22.0), use add/install instead of update
  const isVersioned = pkg.includes("@") && !pkg.startsWith("@");
  const isScopedVersioned = pkg.startsWith("@") && pkg.slice(1).includes("@");

  if (isVersioned || isScopedVersioned) {
    // Delegate to add/install with the version pinned
    if (pm === "pnpm") {
      if (isRoot) {
        await run("pnpm", ["add", pkg, "-w"], projectDir);
      } else {
        const rel = relative(projectDir, targetDir);
        await run("pnpm", ["add", pkg, `--filter=./${rel}`], projectDir);
      }
      return;
    }
    if (pm === "bun") {
      await run("bun", ["add", pkg], isRoot ? projectDir : targetDir);
      return;
    }
    if (pm === "yarn") {
      if (isRoot) {
        await run("yarn", ["add", pkg, "-W"], projectDir);
      } else {
        const wsName = await getWorkspaceName(targetDir);
        await run("yarn", ["workspace", wsName, "add", pkg], projectDir);
      }
      return;
    }
    if (isRoot) {
      await run("npm", ["install", pkg], projectDir);
    } else {
      const rel = relative(projectDir, targetDir);
      await run("npm", ["install", pkg, `-w`, rel], projectDir);
    }
    return;
  }

  // No version specified — update to latest
  if (pm === "pnpm") {
    if (isRoot) {
      await run("pnpm", ["update", pkg, "--latest", "-w"], projectDir);
    } else {
      const rel = relative(projectDir, targetDir);
      await run("pnpm", ["update", pkg, "--latest", `--filter=./${rel}`], projectDir);
    }
    return;
  }

  if (pm === "bun") {
    await run("bun", ["update", pkg], isRoot ? projectDir : targetDir);
    return;
  }

  if (pm === "yarn") {
    if (isRoot) {
      await run("yarn", ["upgrade", pkg, "--latest", "-W"], projectDir);
    } else {
      const wsName = await getWorkspaceName(targetDir);
      await run("yarn", ["workspace", wsName, "upgrade", pkg, "--latest"], projectDir);
    }
    return;
  }

  // npm
  if (isRoot) {
    await run("npm", ["update", pkg], projectDir);
  } else {
    const rel = relative(projectDir, targetDir);
    await run("npm", ["update", pkg, `-w`, rel], projectDir);
  }
}

function packageBaseName(input: string): string {
  if (input.startsWith("@")) return "@" + input.slice(1).split("@")[0]!;
  return input.split("@")[0]!;
}

async function isPackageInstalled(dir: string, pkgName: string): Promise<boolean> {
  const pkg = await fs.readJson(join(dir, "package.json")).catch(() => ({}));
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  return pkgName in deps;
}

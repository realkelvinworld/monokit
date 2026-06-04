import * as p from "@clack/prompts";
import fs from "fs-extra";
import { join, relative } from "path";
import pc from "picocolors";

import { buildDestinations, getWorkspaceName } from "./install.js";
import { run } from "./utils/exec.js";
import { type PackageManager, detectProjectPackageManager } from "./utils/pm.js";

export async function uninstall(cwd: string, args: string[]): Promise<void> {
  p.intro(pc.bgCyan(pc.black(" monokit uninstall ")));

  const pm = await detectProjectPackageManager(cwd);

  // ── Package name ──────────────────────────────────────────────────────────

  const pkgArg = args.find((a) => !a.startsWith("-"));
  let packageName: string;

  if (pkgArg) {
    packageName = pkgArg;
  } else {
    const input = await p.text({
      message: "Package to uninstall?",
      placeholder: "e.g. lucide-react",
      validate: (v) => (!v.trim() ? "Package name is required" : undefined),
    });
    if (p.isCancel(input)) { p.cancel("Cancelled."); process.exit(0); }
    packageName = input as string;
  }

  // ── Destination ───────────────────────────────────────────────────────────

  const destinations = await buildDestinations(cwd);

  const destValue = await p.select({
    message: "Remove from where?",
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

  // ── Summary + confirm ─────────────────────────────────────────────────────

  p.note(
    [
      `Package      ${pc.cyan(packageName)}`,
      `Remove from  ${pc.cyan(rel)}`,
      `PM           ${pc.cyan(pm)}`,
    ].join("\n"),
    "Summary",
  );

  const proceed = await p.confirm({ message: "Proceed?", initialValue: true });
  if (p.isCancel(proceed) || !proceed) { p.cancel("Cancelled."); process.exit(0); }

  // ── Uninstall ─────────────────────────────────────────────────────────────

  const s = p.spinner();
  s.start(`Removing ${packageName}`);
  await runUninstall(pm, packageName, chosen.dir, chosen.isRoot, cwd);
  s.stop(`${packageName} removed`);

  p.outro(pc.green("Done!"));
}

async function runUninstall(
  pm: PackageManager,
  pkg: string,
  targetDir: string,
  isRoot: boolean,
  projectDir: string,
): Promise<void> {
  if (pm === "pnpm") {
    if (isRoot) {
      await run("pnpm", ["remove", pkg, "-w"], projectDir);
    } else {
      const rel = relative(projectDir, targetDir);
      await run("pnpm", ["remove", pkg, `--filter=./${rel}`], projectDir);
    }
    return;
  }

  if (pm === "bun") {
    await run("bun", ["remove", pkg], isRoot ? projectDir : targetDir);
    return;
  }

  if (pm === "yarn") {
    if (isRoot) {
      await run("yarn", ["remove", pkg, "-W"], projectDir);
    } else {
      const wsName = await getWorkspaceName(targetDir);
      await run("yarn", ["workspace", wsName, "remove", pkg], projectDir);
    }
    return;
  }

  // npm
  if (isRoot) {
    await run("npm", ["uninstall", pkg], projectDir);
  } else {
    const rel = relative(projectDir, targetDir);
    await run("npm", ["uninstall", pkg, `-w`, rel], projectDir);
  }
}

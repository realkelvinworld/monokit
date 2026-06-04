import fs from "fs-extra";
import { join } from "path";
import pc from "picocolors";

export async function list(cwd: string): Promise<void> {
  const apps = await getApps(cwd);
  const packages = await getPackages(cwd);

  console.log();
  console.log(pc.bold("Apps"));

  if (apps.length === 0) {
    console.log(pc.dim("  No apps found in apps/"));
  } else {
    apps.forEach((app, i) => {
      const isLast = i === apps.length - 1;
      const prefix = isLast ? "  └──" : "  ├──";
      const type = pc.dim(`(${app.type})`);
      const port = app.port ? pc.dim(`port ${app.port}`) : pc.dim("no port configured");
      const version = app.version ? pc.dim(`v${app.version}`) : "";
      console.log(`${prefix} ${pc.cyan(app.name)}  ${type}  ${port}  ${version}`);
    });
  }

  console.log();
  console.log(pc.bold("Packages"));

  if (packages.length === 0) {
    console.log(pc.dim("  No packages found in packages/"));
  } else {
    packages.forEach((pkg, i) => {
      const isLast = i === packages.length - 1;
      const prefix = isLast ? "  └──" : "  ├──";
      const version = pkg.version ? pc.dim(`v${pkg.version}`) : pc.dim("no version");
      console.log(`${prefix} ${pc.cyan(pkg.name)}  ${version}`);
    });
  }

  console.log();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

type AppEntry = { name: string; type: "next" | "vite"; port: number | null; version: string | null };
type PkgEntry = { name: string; version: string | null };

async function getApps(cwd: string): Promise<AppEntry[]> {
  const appsDir = join(cwd, "apps");
  const entries = await fs.readdir(appsDir).catch(() => [] as string[]);
  const apps: AppEntry[] = [];

  for (const entry of entries) {
    if (entry === ".gitkeep") continue;
    const stat = await fs.stat(join(appsDir, entry)).catch(() => null);
    if (!stat?.isDirectory()) continue;

    const appDir = join(appsDir, entry);
    const pkg = await fs.readJson(join(appDir, "package.json")).catch(() => ({}));

    const isNext =
      (await fs.pathExists(join(appDir, "next.config.js"))) ||
      (await fs.pathExists(join(appDir, "next.config.ts"))) ||
      (await fs.pathExists(join(appDir, "next.config.mjs")));

    const devScript = (pkg.scripts?.dev as string | undefined) ?? "";
    const portMatch = devScript.match(/--port[= ](\d+)/);
    const port = portMatch ? parseInt(portMatch[1]!, 10) : await getVitePort(appDir);

    apps.push({
      name: entry,
      type: isNext ? "next" : "vite",
      port,
      version: (pkg.version as string | undefined) ?? null,
    });
  }

  return apps;
}

async function getVitePort(appDir: string): Promise<number | null> {
  const viteConfig = await fs.readFile(join(appDir, "vite.config.ts"), "utf-8").catch(() => "");
  const match = viteConfig.match(/port:\s*(\d+)/);
  return match ? parseInt(match[1]!, 10) : null;
}

async function getPackages(cwd: string): Promise<PkgEntry[]> {
  const pkgsDir = join(cwd, "packages");
  const entries = await fs.readdir(pkgsDir).catch(() => [] as string[]);
  const pkgs: PkgEntry[] = [];

  for (const entry of entries) {
    if (entry === ".gitkeep") continue;
    const stat = await fs.stat(join(pkgsDir, entry)).catch(() => null);
    if (!stat?.isDirectory()) continue;

    const pkg = await fs.readJson(join(pkgsDir, entry, "package.json")).catch(() => ({}));
    pkgs.push({
      name: (pkg.name as string | undefined) ?? entry,
      version: (pkg.version as string | undefined) ?? null,
    });
  }

  return pkgs;
}

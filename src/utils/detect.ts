import { existsSync } from "fs";
import { join } from "path";

export function isMonorepo(cwd: string = process.cwd()): boolean {
  return (
    existsSync(join(cwd, "turbo.json")) ||
    existsSync(join(cwd, "pnpm-workspace.yaml"))
  );
}

export function hasPackagesDir(cwd: string = process.cwd()): boolean {
  return existsSync(join(cwd, "packages"));
}

export function hasAppsDir(cwd: string = process.cwd()): boolean {
  return existsSync(join(cwd, "apps"));
}

import { join } from "path";
import fs from "fs-extra";

export async function addMissingPackageScripts(
  workspaceDir: string,
  scripts: Record<string, string>,
): Promise<string[]> {
  const pkgPath = join(workspaceDir, "package.json");
  const pkg = await fs.readJson(pkgPath);
  pkg.scripts = pkg.scripts ?? {};
  const added: string[] = [];

  for (const [name, command] of Object.entries(scripts)) {
    if (pkg.scripts[name]) continue;
    pkg.scripts[name] = command;
    added.push(name);
  }

  if (added.length > 0) await fs.writeJson(pkgPath, pkg, { spaces: 2 });
  return added;
}

import { join } from "node:path";

import { run } from "./exec.js";
import { type PackageManager } from "./pm.js";
import { inspectSharedUiPrimitiveImports } from "./shadcn-project.js";

type PrimitiveInstaller = (
  pm: PackageManager,
  packageNames: string[],
  cwd: string,
) => Promise<void>;

const installPrimitivePackages: PrimitiveInstaller = async (pm, packageNames, cwd) => {
  await run(pm, ["add", ...packageNames], cwd);
};

export async function ensureSharedUiPrimitiveDependencies(
  projectDir: string,
  pm: PackageManager,
  install: PrimitiveInstaller = installPrimitivePackages,
): Promise<string[]> {
  const audit = await inspectSharedUiPrimitiveImports(projectDir);
  if (audit.missingPackages.length === 0) return [];

  await install(pm, audit.missingPackages, join(projectDir, "packages/ui"));
  return audit.missingPackages;
}

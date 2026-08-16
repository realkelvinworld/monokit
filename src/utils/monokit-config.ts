import { join } from "node:path";
import fs from "fs-extra";

export type ShadcnOwnership = "none" | "per-app" | "shared";

export interface MonokitProjectConfig {
  schemaVersion: 1;
  shadcn: {
    apps: Record<string, ShadcnOwnership>;
  };
}

const configFileName = ".monokit.json";
const ownershipValues = new Set<ShadcnOwnership>(["none", "per-app", "shared"]);

export function createMonokitConfig(
  appNames: string[],
  mode: ShadcnOwnership,
): MonokitProjectConfig {
  return {
    schemaVersion: 1,
    shadcn: {
      apps: Object.fromEntries(appNames.map((appName) => [appName, mode])),
    },
  };
}

export async function readMonokitConfig(
  projectDir: string,
): Promise<MonokitProjectConfig | null> {
  const config = await fs.readJson(join(projectDir, configFileName)).catch(() => null);
  if (!config || config.schemaVersion !== 1 || typeof config.shadcn?.apps !== "object") {
    return null;
  }

  const apps = config.shadcn.apps as Record<string, unknown>;
  if (Object.values(apps).some((value) => !ownershipValues.has(value as ShadcnOwnership))) {
    return null;
  }

  return config as MonokitProjectConfig;
}

export async function writeMonokitConfig(
  projectDir: string,
  config: MonokitProjectConfig,
): Promise<void> {
  const targetPath = join(projectDir, configFileName);
  const temporaryPath = `${targetPath}.tmp`;
  await fs.writeJson(temporaryPath, config, { spaces: 2 });
  await fs.rename(temporaryPath, targetPath);
}

export async function setAppShadcnMode(
  projectDir: string,
  appName: string,
  mode: ShadcnOwnership,
): Promise<void> {
  const config = (await readMonokitConfig(projectDir)) ?? createMonokitConfig([], "none");
  config.shadcn.apps[appName] = mode;
  await writeMonokitConfig(projectDir, config);
}

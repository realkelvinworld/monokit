import { join } from "path";
import fs from "fs-extra";

export type AppType = "next" | "vite" | "unknown";

export async function detectAppType(appDir: string): Promise<AppType> {
  const pkg = await fs.readJson(join(appDir, "package.json")).catch(() => ({}));
  const dependencies = {
    ...(pkg.dependencies as Record<string, string> | undefined),
    ...(pkg.devDependencies as Record<string, string> | undefined),
  };

  if (dependencies.next) return "next";
  if (dependencies.vite) return "vite";
  return "unknown";
}

export async function detectAppPort(appDir: string, appType: AppType): Promise<number> {
  const pkg = await fs.readJson(join(appDir, "package.json")).catch(() => ({}));
  const devScript = (pkg.scripts?.dev as string | undefined) ?? "";
  const scriptPort =
    devScript.match(/(?:--port|-p)(?:=|\s+)(\d+)/)?.[1] ??
    devScript.match(/\bPORT=(\d+)/)?.[1];
  if (scriptPort) return Number(scriptPort);

  if (appType === "vite") {
    const configNames = [
      "vite.config.ts",
      "vite.config.js",
      "vite.config.mts",
      "vite.config.mjs",
    ];
    for (const configName of configNames) {
      const content = await fs.readFile(join(appDir, configName), "utf-8").catch(() => "");
      const configPort = content.match(/port:\s*(\d+)/)?.[1];
      if (configPort) return Number(configPort);
    }
    return 5173;
  }

  return 3000;
}

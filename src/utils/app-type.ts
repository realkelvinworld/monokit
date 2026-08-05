import fs from "fs-extra";
import { join } from "path";

// sveltekit is a planned addition — detection is wired but init/config generation is not yet implemented
export type AppType = "next" | "vite" | "sveltekit";

export async function detectAppType(appDir: string): Promise<AppType> {
  const pkg = await fs.readJson(join(appDir, "package.json")).catch(() => ({}));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };

  if (deps["next"]) return "next";
  if (deps["@sveltejs/kit"]) return "sveltekit";
  return "vite";
}

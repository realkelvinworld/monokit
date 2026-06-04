import * as p from "@clack/prompts";
import fs from "fs-extra";
import { join } from "path";
import pc from "picocolors";

import { detectProjectPackageManager, pmDlx } from "./utils/pm.js";

export async function addComponent(cwd: string, args: string[]): Promise<void> {
  p.intro(pc.bgCyan(pc.black(" monokit add ")));

  const pm = await detectProjectPackageManager(cwd);

  // Component name is the first positional arg (not a flag)
  const componentName = args.find((a) => !a.startsWith("--"));

  if (!componentName) {
    p.cancel("Component name is required.\nUsage: monokit add <component>");
    process.exit(1);
  }

  // Resolve destination — from flags or prompt interactively
  const isSharedFlag = args.includes("--shared");
  const appFlagIndex = args.indexOf("--app");
  const appFlagValue = appFlagIndex !== -1 ? args[appFlagIndex + 1] : undefined;

  let destination: "shared" | "app";
  let appName: string | undefined;

  if (isSharedFlag) {
    destination = "shared";
  } else if (appFlagValue) {
    destination = "app";
    appName = appFlagValue;
  } else {
    // No flags — prompt interactively
    const availableApps = await detectApps(cwd);

    const dest = await p.select({
      message: `Where should "${componentName}" be added?`,
      options: [
        {
          value: "shared",
          label: "Shared design system",
          hint: "packages/ui — available in all apps",
        },
        ...availableApps.map((name) => ({
          value: `app:${name}`,
          label: `apps/${name}`,
          hint: "Only in this app",
        })),
      ],
    });

    if (p.isCancel(dest)) {
      p.cancel("Cancelled.");
      process.exit(0);
    }

    if (dest === "shared") {
      destination = "shared";
    } else {
      destination = "app";
      appName = (dest as string).replace("app:", "");
    }
  }

  const s = p.spinner();

  if (destination === "shared") {
    const uiDir = join(cwd, "packages/ui");

    if (!fs.existsSync(uiDir)) {
      p.cancel("packages/ui not found. Make sure you're in the monorepo root.");
      process.exit(1);
    }

    s.start(`Adding ${componentName} to packages/ui`);
    await pmDlx(pm, ["shadcn@latest", "add", componentName, "--yes", "--overwrite"], uiDir);
    s.stop(`${componentName} added`);

    s.start("Fixing import paths");
    await fixCnImport(uiDir, componentName);
    s.stop("Import paths fixed");

    s.start("Updating barrel export");
    await addExportToIndex(uiDir, componentName);
    s.stop("Barrel export updated");
  } else {
    const appDir = join(cwd, "apps", appName!);

    if (!fs.existsSync(appDir)) {
      p.cancel(`apps/${appName} not found. Check the app name and try again.`);
      process.exit(1);
    }

    s.start(`Adding ${componentName} to apps/${appName}`);
    await pmDlx(pm, ["shadcn@latest", "add", componentName, "--yes", "--overwrite"], appDir);
    s.stop(`${componentName} added to apps/${appName}`);
  }

  p.outro(pc.green("Done!"));
}

async function detectApps(cwd: string): Promise<string[]> {
  const appsDir = join(cwd, "apps");
  const entries = await fs.readdir(appsDir).catch(() => [] as string[]);
  const apps: string[] = [];
  for (const entry of entries) {
    if (entry === ".gitkeep") continue;
    const stat = await fs.stat(join(appsDir, entry)).catch(() => null);
    if (stat?.isDirectory()) apps.push(entry);
  }
  return apps;
}

// shadcn writes "@/lib/utils" or similar — packages/ui always uses a relative import
async function fixCnImport(uiDir: string, componentName: string): Promise<void> {
  const componentFile = join(uiDir, "src", `${componentName}.tsx`);
  if (!fs.existsSync(componentFile)) return;

  const content = await fs.readFile(componentFile, "utf-8");
  const fixed = content
    .replace(/from "@\/lib\/utils"/g, 'from "./utils"')
    .replace(/from "src\/utils"/g, 'from "./utils"')
    .replace(/from "@\/utils"/g, 'from "./utils"')
    .replace(/from "@\/components\/ui\/([^"]+)"/g, 'from "./$1"');

  await fs.writeFile(componentFile, fixed, "utf-8");
}

async function addExportToIndex(uiDir: string, componentName: string): Promise<void> {
  const indexPath = join(uiDir, "src/index.ts");
  const componentFile = join(uiDir, "src", `${componentName}.tsx`);

  if (!fs.existsSync(componentFile)) return;

  const indexContent = await fs.readFile(indexPath, "utf-8");
  if (indexContent.includes(`./${componentName}`)) return;

  await fs.appendFile(indexPath, `export * from "./${componentName}";\n`, "utf-8");
}

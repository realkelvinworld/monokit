import * as p from "@clack/prompts";
import fs from "fs-extra";
import { join } from "path";
import pc from "picocolors";

import {
  getAppComponentCandidates,
  getShadcnAddArgs,
} from "./utils/component-overwrite.js";
import { readMonokitConfig } from "./utils/monokit-config.js";
import { detectProjectPackageManager, pmDlx } from "./utils/pm.js";
import { ensureSharedUiPrimitiveDependencies } from "./utils/shadcn-dependencies.js";
import {
  findSharedShadcnIssues,
  readSharedShadcnConfig,
} from "./utils/shadcn-project.js";

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

  const projectConfig = await readMonokitConfig(cwd);
  const appUsesSharedDesign =
    destination === "app" && appName
      ? projectConfig?.shadcn.apps[appName] === "shared"
      : false;

  if (destination === "shared" || appUsesSharedDesign) {
    if (destination === "shared" && !projectConfig) {
      p.cancel(
        "Monokit ownership metadata is missing. Run monokit upgrade --check before adding shared components.",
      );
      process.exit(1);
    }

    const sharedConfig = await readSharedShadcnConfig(cwd);
    if (!sharedConfig) {
      p.cancel(
        "Shared shadcn configuration is missing. Run monokit upgrade --check before adding components.",
      );
      process.exit(1);
    }

    const issues = (await findSharedShadcnIssues(cwd)).filter(
      (issue) => destination === "shared" || issue.appName === appName,
    );
    if (issues.length > 0) {
      const details = issues
        .map((issue) => `apps/${issue.appName}: ${issue.fields.join(", ")}`)
        .join("\n");
      p.cancel(
        `Shared shadcn configuration has drifted:\n${details}\nRun monokit upgrade --check before adding components.`,
      );
      process.exit(1);
    }
  }

  const s = p.spinner();

  if (destination === "shared") {
    const uiDir = join(cwd, "packages/ui");

    if (!fs.existsSync(uiDir)) {
      p.cancel("packages/ui not found. Make sure you're in the monorepo root.");
      process.exit(1);
    }

    const componentPath = join(uiDir, "src", `${componentName}.tsx`);
    const overwrite = await confirmComponentOverwrite(componentPath, componentName);

    s.start(`Adding ${componentName} to packages/ui`);
    await pmDlx(pm, getShadcnAddArgs(componentName, overwrite), uiDir);
    await ensureSharedUiPrimitiveDependencies(cwd, pm);
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

    const existingPath = getAppComponentCandidates(appDir, componentName).find((path) =>
      fs.existsSync(path),
    );
    const overwrite = existingPath
      ? await confirmComponentOverwrite(existingPath, componentName)
      : false;

    s.start(`Adding ${componentName} to apps/${appName}`);
    await pmDlx(pm, getShadcnAddArgs(componentName, overwrite), appDir);
    s.stop(`${componentName} added to apps/${appName}`);
  }

  p.outro(pc.green("Done!"));
}

async function confirmComponentOverwrite(
  componentPath: string,
  componentName: string,
): Promise<boolean> {
  if (!fs.existsSync(componentPath)) return false;

  const confirmed = await p.confirm({
    message: `${componentName} already exists and may contain custom changes. Overwrite it?`,
    initialValue: false,
  });
  if (p.isCancel(confirmed) || !confirmed) {
    p.cancel("Cancelled. Existing component was not changed.");
    process.exit(0);
  }
  return true;
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
    .replace(/from "@[^"]*\/utils"/g, 'from "./utils"')
    .replace(/from "src\/utils"/g, 'from "./utils"')
    .replace(/from "@[^"]*\/components\/ui\/([^"]+)"/g, 'from "./$1"')
    .replace(/from "src\/([^"]+)"/g, 'from "./$1"');

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

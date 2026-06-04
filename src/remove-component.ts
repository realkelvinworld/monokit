import * as p from "@clack/prompts";
import fs from "fs-extra";
import { join } from "path";
import pc from "picocolors";

export async function removeComponent(cwd: string, args: string[]): Promise<void> {
  p.intro(pc.bgCyan(pc.black(" monokit remove ")));

  const componentName = args.find((a) => !a.startsWith("--"));

  if (!componentName) {
    p.cancel("Component name is required.\nUsage: monokit remove <component>");
    process.exit(1);
  }

  // ── Destination ───────────────────────────────────────────────────────────

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
    const availableApps = await detectApps(cwd);

    const dest = await p.select({
      message: `Where should "${componentName}" be removed from?`,
      options: [
        { value: "shared", label: "Shared design system", hint: "packages/ui" },
        ...availableApps.map((name) => ({
          value: `app:${name}`,
          label: `apps/${name}`,
          hint: "Only in this app",
        })),
      ],
    });

    if (p.isCancel(dest)) { p.cancel("Cancelled."); process.exit(0); }

    if (dest === "shared") {
      destination = "shared";
    } else {
      destination = "app";
      appName = (dest as string).replace("app:", "");
    }
  }

  // ── Confirm ───────────────────────────────────────────────────────────────

  const location = destination === "shared" ? "packages/ui" : `apps/${appName}`;

  const proceed = await p.confirm({
    message: `Remove "${componentName}" from ${location}?`,
    initialValue: false,
  });
  if (p.isCancel(proceed) || !proceed) { p.cancel("Cancelled."); process.exit(0); }

  // ── Remove ────────────────────────────────────────────────────────────────

  const s = p.spinner();

  if (destination === "shared") {
    const uiDir = join(cwd, "packages/ui");
    const componentFile = join(uiDir, "src", `${componentName}.tsx`);

    if (!fs.existsSync(componentFile)) {
      p.cancel(`packages/ui/src/${componentName}.tsx not found.`);
      process.exit(1);
    }

    s.start(`Removing ${componentName} from packages/ui`);
    await fs.remove(componentFile);
    await removeFromIndex(uiDir, componentName);
    s.stop(`${componentName} removed`);
  } else {
    const appDir = join(cwd, "apps", appName!);

    if (!fs.existsSync(appDir)) {
      p.cancel(`apps/${appName} not found.`);
      process.exit(1);
    }

    const componentFile = await findComponentFile(appDir, componentName);

    if (!componentFile) {
      p.cancel(`Could not find ${componentName} component in apps/${appName}.`);
      process.exit(1);
    }

    s.start(`Removing ${componentName} from apps/${appName}`);
    await fs.remove(componentFile);
    s.stop(`${componentName} removed`);
  }

  p.outro(pc.green("Done!"));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

async function findComponentFile(appDir: string, componentName: string): Promise<string | null> {
  const candidates = [
    join(appDir, "src", "components", "ui", `${componentName}.tsx`),
    join(appDir, "components", "ui", `${componentName}.tsx`),
    join(appDir, "src", "components", `${componentName}.tsx`),
    join(appDir, "components", `${componentName}.tsx`),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

async function removeFromIndex(uiDir: string, componentName: string): Promise<void> {
  const indexPath = join(uiDir, "src/index.ts");
  if (!fs.existsSync(indexPath)) return;

  const content = await fs.readFile(indexPath, "utf-8");
  const lines = content.split("\n");
  const filtered = lines.filter((line) => !line.includes(`./${componentName}`));
  await fs.writeFile(indexPath, filtered.join("\n"), "utf-8");
}

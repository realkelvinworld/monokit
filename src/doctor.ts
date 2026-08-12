import { execa } from "execa";
import fs from "fs-extra";
import { join } from "path";
import pc from "picocolors";
import * as p from "@clack/prompts";

import { readMonokitConfig } from "./utils/monokit-config.js";
import { listShadcnPrimitiveDependencies } from "./utils/shadcn-config.js";
import {
  findSharedShadcnIssues,
  findSharedUiPrimitiveIssues,
  inspectSharedUiPrimitiveImports,
} from "./utils/shadcn-project.js";

interface Check {
  label: string;
  pass: boolean;
  hint?: string;
  warning?: boolean;
}

type FixableIssue =
  | { type: "broken-cn-import"; file: string }
  | { type: "missing-barrel-export"; componentName: string };

type AppInfo = { name: string; type: "next" | "vite"; hasSrc: boolean };

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function exists(dir: string, path: string): Promise<boolean> {
  return fs.pathExists(join(dir, path));
}

async function contains(dir: string, path: string, search: string): Promise<boolean> {
  const content = await fs.readFile(join(dir, path), "utf-8").catch(() => "");
  return content.includes(search);
}

async function readJson(dir: string, path: string): Promise<Record<string, unknown>> {
  return fs.readJson(join(dir, path)).catch(() => ({}));
}

async function getField(dir: string, path: string, dotKey: string): Promise<unknown> {
  const obj = await readJson(dir, path);
  return dotKey.split(".").reduce((acc: unknown, k) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[k];
    return undefined;
  }, obj);
}

async function detectApps(dir: string): Promise<AppInfo[]> {
  const entries = await fs.readdir(join(dir, "apps")).catch(() => [] as string[]);
  const apps: AppInfo[] = [];
  for (const entry of entries) {
    if (entry === ".gitkeep") continue;
    const stat = await fs.stat(join(dir, "apps", entry)).catch(() => null);
    if (!stat?.isDirectory()) continue;
    const isNext =
      (await fs.pathExists(join(dir, "apps", entry, "next.config.js"))) ||
      (await fs.pathExists(join(dir, "apps", entry, "next.config.ts"))) ||
      (await fs.pathExists(join(dir, "apps", entry, "next.config.mjs")));
    const hasSrc = await fs.pathExists(join(dir, "apps", entry, "src"));
    apps.push({ name: entry, type: isNext ? "next" : "vite", hasSrc });
  }
  return apps;
}

// ─── Output ──────────────────────────────────────────────────────────────────

function printSection(title: string, checks: Check[]): number {
  console.log(`\n${pc.bold(pc.cyan(title))}`);
  let failures = 0;
  for (const c of checks) {
    if (c.pass) {
      console.log(`  ${pc.green("✓")}  ${c.label}`);
    } else if (c.warning) {
      console.log(
        `  ${pc.yellow("!")}  ${pc.yellow(c.label)}${c.hint ? pc.dim(`  →  ${c.hint}`) : ""}`,
      );
    } else {
      console.log(
        `  ${pc.red("✗")}  ${pc.red(c.label)}${c.hint ? pc.dim(`  →  ${c.hint}`) : ""}`,
      );
      failures++;
    }
  }
  return failures;
}

// ─── Checks ──────────────────────────────────────────────────────────────────

async function checkRoot(dir: string, apps: AppInfo[]): Promise<Check[]> {
  const pkg = await readJson(dir, "package.json");
  const scripts = (pkg.scripts ?? {}) as Record<string, string>;
  const pmField = pkg.packageManager as string | undefined;
  const pm = pmField?.split("@")[0] ?? "unknown";

  const checks: Check[] = [
    { label: "package.json", pass: await exists(dir, "package.json") },
    {
      label: "packageManager field (e.g. pnpm@10.0.0)",
      pass: typeof pmField === "string" && pmField.includes("@"),
      hint: 'add "packageManager": "pm@x.y.z" to package.json — required by Turbo v2',
    },
    { label: "turbo.json", pass: await exists(dir, "turbo.json") },
    { label: ".gitignore", pass: await exists(dir, ".gitignore") },
    { label: ".prettierrc", pass: await exists(dir, ".prettierrc") },
    {
      label: ".monokit.json ownership metadata",
      pass: (await readMonokitConfig(dir)) !== null,
      hint: "run monokit upgrade --check to inspect the required migration",
    },
  ];
  const projectConfig = await readMonokitConfig(dir);
  if (projectConfig) {
    const detectedAppNames = new Set(apps.map((app) => app.name));
    const configuredAppNames = new Set(Object.keys(projectConfig.shadcn.apps));
    checks.push({
      label: ".monokit.json covers every detected app",
      pass:
        apps.every((app) => configuredAppNames.has(app.name)) &&
        [...configuredAppNames].every((appName) => detectedAppNames.has(appName)),
      hint: "run monokit upgrade to classify missing or stale app ownership entries",
    });
  }

  // Workspace config depends on PM
  if (pm === "pnpm") {
    checks.push({
      label: "pnpm-workspace.yaml",
      pass: await exists(dir, "pnpm-workspace.yaml"),
      hint: 'pnpm requires pnpm-workspace.yaml — add packages: ["apps/*", "packages/*"]',
    });
  } else {
    const hasWorkspaces = Array.isArray(pkg.workspaces);
    checks.push({
      label: `workspaces field in package.json (${pm})`,
      pass: hasWorkspaces,
      hint: 'add "workspaces": ["apps/*", "packages/*"] to package.json',
    });
  }

  // Per-app scripts
  for (const app of apps) {
    checks.push({
      label: `dev:${app.name} script`,
      pass: `dev:${app.name}` in scripts,
      hint: `add "dev:${app.name}": "turbo run dev --filter=${app.name}" to root scripts`,
    });
    checks.push({
      label: `build:${app.name} script`,
      pass: `build:${app.name}` in scripts,
      hint: `add "build:${app.name}": "turbo run build --filter=${app.name}" to root scripts`,
    });
  }

  return checks;
}

async function checkUi(dir: string): Promise<Check[]> {
  const projectConfig = await readMonokitConfig(dir);
  const hasSharedShadcn = Object.values(projectConfig?.shadcn.apps ?? {}).includes("shared");
  const checks: Check[] = [
    { label: "package.json", pass: await exists(dir, "packages/ui/package.json") },
    { label: "tsconfig.json", pass: await exists(dir, "packages/ui/tsconfig.json") },
    { label: "src/index.ts", pass: await exists(dir, "packages/ui/src/index.ts") },
    {
      label: "src/utils.ts exports cn()",
      pass: await contains(dir, "packages/ui/src/utils.ts", "export function cn"),
      hint: "packages/ui/src/utils.ts must export a cn() helper using clsx + tailwind-merge",
    },
  ];
  if (hasSharedShadcn) {
    checks.splice(2, 0, {
      label: "components.json",
      pass: await exists(dir, "packages/ui/components.json"),
    });
  }
  return checks;
}

async function checkShadcnSynchronization(dir: string): Promise<Check[]> {
  const projectConfig = await readMonokitConfig(dir);
  if (!projectConfig) return [];

  const sharedApps = Object.entries(projectConfig.shadcn.apps)
    .filter(([, mode]) => mode === "shared")
    .map(([appName]) => appName);
  const checks: Check[] = [];
  for (const [appName, mode] of Object.entries(projectConfig.shadcn.apps)) {
    if (mode !== "per-app") continue;
    checks.push({
      label: `apps/${appName} has its per-app shadcn configuration`,
      pass: await exists(dir, `apps/${appName}/components.json`),
      hint: `apps/${appName}/components.json is required for per-app ownership`,
    });
  }
  if (sharedApps.length === 0) return checks;

  const drift = await findSharedShadcnIssues(dir);
  const primitiveIssues = await findSharedUiPrimitiveIssues(dir);
  const primitiveImports = await inspectSharedUiPrimitiveImports(dir);
  checks.push(...sharedApps.map((appName) => {
    const issue = drift.find((candidate) => candidate.appName === appName);
    return {
      label: `apps/${appName} matches the shared shadcn design`,
      pass: !issue,
      hint: issue
        ? `drifted fields: ${issue.fields.join(", ")} — run monokit upgrade --check`
        : undefined,
    };
  }));

  checks.push({
    label: "packages/ui primitive dependencies match its shadcn style",
    pass: primitiveIssues.length === 0,
    hint:
      primitiveIssues.length > 0
        ? `conflicting packages: ${primitiveIssues.join(", ")} — run monokit upgrade --check`
        : undefined,
  });
  checks.push({
    label: "packages/ui source imports match its shadcn style",
    pass: primitiveImports.mismatchedPackages.length === 0,
    hint:
      primitiveImports.mismatchedPackages.length > 0
        ? `conflicting imports: ${primitiveImports.mismatchedPackages.join(", ")}`
        : undefined,
  });
  checks.push({
    label: "packages/ui does not mix primitive libraries",
    pass: !primitiveImports.mixed,
    hint: primitiveImports.mixed
      ? `found: ${primitiveImports.importedPrimitives.join(", ")}`
      : undefined,
  });
  checks.push({
    label: "packages/ui directly declares imported primitive packages",
    pass: primitiveImports.missingPackages.length === 0,
    hint:
      primitiveImports.missingPackages.length > 0
        ? `missing: ${primitiveImports.missingPackages.join(", ")}`
        : undefined,
  });

  for (const appName of sharedApps) {
    const packageJson = await readJson(dir, `apps/${appName}/package.json`);
    const appPrimitivePackages = listShadcnPrimitiveDependencies(packageJson);
    if (appPrimitivePackages.length === 0) continue;
    checks.push({
      label: `apps/${appName} still declares shared primitive packages`,
      pass: false,
      warning: true,
      hint: `${appPrimitivePackages.join(", ")} can be reviewed for cleanup if the app has no local components`,
    });
  }

  return checks;
}

async function checkTailwindConfig(dir: string): Promise<Check[]> {
  return [
    {
      label: "package.json",
      pass: await exists(dir, "packages/tailwind-config/package.json"),
    },
    {
      label: "globals.css exists",
      pass: await exists(dir, "packages/tailwind-config/globals.css"),
    },
    {
      label: 'globals.css has @import "tailwindcss"',
      pass: await contains(dir, "packages/tailwind-config/globals.css", '@import "tailwindcss"'),
      hint: "globals.css must start with @import \"tailwindcss\" for Tailwind v4",
    },
  ];
}

async function checkTsConfig(dir: string): Promise<Check[]> {
  return [
    { label: "base.json", pass: await exists(dir, "packages/typescript-config/base.json") },
    { label: "nextjs.json", pass: await exists(dir, "packages/typescript-config/nextjs.json") },
    { label: "vite.json", pass: await exists(dir, "packages/typescript-config/vite.json") },
  ];
}

async function checkEslintConfig(dir: string): Promise<Check[]> {
  return [
    {
      label: "package.json",
      pass: await exists(dir, "packages/eslint-config/package.json"),
    },
    { label: "base.js", pass: await exists(dir, "packages/eslint-config/base.js") },
  ];
}

async function checkApp(dir: string, app: AppInfo): Promise<Check[]> {
  const base = `apps/${app.name}`;
  const checks: Check[] = [];

  checks.push(
    { label: "package.json", pass: await exists(dir, `${base}/package.json`) },
    {
      label: "dev script",
      pass: (await getField(dir, `${base}/package.json`, "scripts.dev")) !== undefined,
    },
    {
      label: "build script",
      pass: (await getField(dir, `${base}/package.json`, "scripts.build")) !== undefined,
    },
    {
      label: "check-types script",
      pass: (await getField(dir, `${base}/package.json`, "scripts.check-types")) !== undefined,
      hint: 'add "check-types": "tsc --noEmit" to scripts',
    },
    {
      label: "@repo/ui in dependencies",
      pass: (await getField(dir, `${base}/package.json`, "dependencies.@repo/ui")) !== undefined,
      hint: "run monokit app and choose this app to rewire workspace deps",
    },
    {
      label: "@repo/tailwind-config in devDependencies",
      pass:
        (await getField(dir, `${base}/package.json`, "devDependencies.@repo/tailwind-config")) !==
        undefined,
    },
    {
      label: "@repo/eslint-config in devDependencies",
      pass:
        (await getField(dir, `${base}/package.json`, "devDependencies.@repo/eslint-config")) !==
        undefined,
    },
    {
      label: "eslint.config.js uses @repo/eslint-config",
      pass: await contains(dir, `${base}/eslint.config.js`, "@repo/eslint-config"),
      hint: "eslint.config.js should extend from @repo/eslint-config/base",
    },
  );

  if (app.type === "next") {
    const cssPath = app.hasSrc
      ? `${base}/src/app/globals.css`
      : `${base}/app/globals.css`;
    checks.push(
      {
        label: "globals.css imports @repo/tailwind-config",
        pass: await contains(dir, cssPath, "@repo/tailwind-config/globals.css"),
        hint: `${cssPath} must import @repo/tailwind-config/globals.css`,
      },
      {
        label: "dev script has --port",
        pass: ((await getField(dir, `${base}/package.json`, "scripts.dev")) as string ?? "").includes("--port"),
        hint: 'add --port 3000 to the dev script so apps don\'t conflict',
      },
    );
  }

  if (app.type === "vite") {
    checks.push(
      {
        label: "vite.config.ts exists",
        pass: await exists(dir, `${base}/vite.config.ts`),
      },
      {
        label: "vite.config.ts has server.port",
        pass: await contains(dir, `${base}/vite.config.ts`, "port:"),
        hint: "add server: { port: 3001 } to vite.config.ts",
      },
      {
        label: "src/index.css imports @repo/tailwind-config",
        pass: await contains(dir, `${base}/src/index.css`, "@repo/tailwind-config/globals.css"),
        hint: "src/index.css must import @repo/tailwind-config/globals.css",
      },
    );
  }

  return checks;
}

async function checkUiComponents(dir: string): Promise<{ checks: Check[]; fixable: FixableIssue[] }> {
  const srcDir = join(dir, "packages/ui/src");
  const checks: Check[] = [];
  const fixable: FixableIssue[] = [];

  const files = await fs.readdir(srcDir).catch(() => [] as string[]);
  const componentFiles = files.filter((f) => f.endsWith(".tsx"));

  if (componentFiles.length === 0) return { checks, fixable };

  const indexContent = await fs.readFile(join(srcDir, "index.ts"), "utf-8").catch(() => "");

  for (const file of componentFiles) {
    const filePath = join(srcDir, file);
    const content = await fs.readFile(filePath, "utf-8").catch(() => "");
    const componentName = file.replace(".tsx", "");

    const hasBrokenImport =
      /from "@[^"]*\/utils"/.test(content) ||
      content.includes('from "src/utils"') ||
      /from "@[^"]*\/components\/ui\//.test(content) ||
      /from "src\/(?!utils)[^"]+"/.test(content);

    checks.push({
      label: `src/${file} — cn import path`,
      pass: !hasBrokenImport,
      hint: hasBrokenImport ? "run monokit doctor --fix to auto-correct" : undefined,
    });

    if (hasBrokenImport) {
      fixable.push({ type: "broken-cn-import", file: filePath });
    }

    const isExported = indexContent.includes(`./${componentName}`);
    checks.push({
      label: `src/${file} — exported from index.ts`,
      pass: isExported,
      hint: !isExported ? "run monokit doctor --fix to add export automatically" : undefined,
    });

    if (!isExported) {
      fixable.push({ type: "missing-barrel-export", componentName });
    }
  }

  return { checks, fixable };
}

async function applyFixes(dir: string, fixable: FixableIssue[]): Promise<number> {
  let count = 0;

  for (const issue of fixable) {
    if (issue.type === "broken-cn-import") {
      const content = await fs.readFile(issue.file, "utf-8").catch(() => "");
      const fixed = content
        .replace(/from "@[^"]*\/utils"/g, 'from "./utils"')
        .replace(/from "src\/utils"/g, 'from "./utils"')
        .replace(/from "@[^"]*\/components\/ui\/([^"]+)"/g, 'from "./$1"')
        .replace(/from "src\/([^"]+)"/g, 'from "./$1"');
      await fs.writeFile(issue.file, fixed, "utf-8");
      count++;
    } else if (issue.type === "missing-barrel-export") {
      const indexPath = join(dir, "packages/ui/src/index.ts");
      const indexContent = await fs.readFile(indexPath, "utf-8").catch(() => "");
      if (!indexContent.includes(`./${issue.componentName}`)) {
        await fs.appendFile(indexPath, `export * from "./${issue.componentName}";\n`, "utf-8");
        count++;
      }
    }
  }

  return count;
}

async function checkTypes(dir: string, apps: AppInfo[]): Promise<Check[]> {
  const checks: Check[] = [];
  for (const app of apps) {
    const { exitCode, stderr } = await execa("npx", ["tsc", "--noEmit"], {
      cwd: join(dir, "apps", app.name),
      reject: false,
    });
    checks.push({
      label: `apps/${app.name} — tsc --noEmit`,
      pass: exitCode === 0,
      hint: exitCode !== 0 ? stderr?.split("\n")[0] : undefined,
    });
  }
  return checks;
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function doctor(cwd: string, opts: { checkTypes?: boolean; fix?: boolean } = {}): Promise<void> {
  p.intro(pc.bgCyan(pc.black(" monokit doctor ")));

  const apps = await detectApps(cwd);

  if (apps.length === 0) {
    p.log.warn("No apps found in apps/ — nothing to check.");
  }

  let totalFailures = 0;

  totalFailures += printSection("Root", await checkRoot(cwd, apps));
  totalFailures += printSection("packages/ui", await checkUi(cwd));

  const shadcnChecks = await checkShadcnSynchronization(cwd);
  if (shadcnChecks.length > 0) {
    totalFailures += printSection("shadcn synchronization", shadcnChecks);
  }

  const { checks: uiComponentChecks, fixable } = await checkUiComponents(cwd);
  if (uiComponentChecks.length > 0) {
    totalFailures += printSection("packages/ui components", uiComponentChecks);
  }

  totalFailures += printSection("packages/tailwind-config", await checkTailwindConfig(cwd));
  totalFailures += printSection("packages/typescript-config", await checkTsConfig(cwd));
  totalFailures += printSection("packages/eslint-config", await checkEslintConfig(cwd));

  for (const app of apps) {
    totalFailures += printSection(
      `apps/${app.name}  ${pc.dim(`(${app.type})`)}`,
      await checkApp(cwd, app),
    );
  }

  if (opts.checkTypes && apps.length > 0) {
    const s = p.spinner();
    s.start("Running tsc --noEmit across apps");
    const typeChecks = await checkTypes(cwd, apps);
    s.stop("TypeScript check complete");
    totalFailures += printSection("TypeScript", typeChecks);
  }

  console.log();

  if (opts.fix && fixable.length > 0) {
    const s = p.spinner();
    s.start("Applying fixes");
    const fixed = await applyFixes(cwd, fixable);
    s.stop(`${fixed} issue${fixed === 1 ? "" : "s"} fixed`);
    totalFailures = Math.max(0, totalFailures - fixed);
  }

  if (totalFailures === 0) {
    p.outro(pc.green("All checks passed — your monorepo looks healthy."));
  } else {
    p.outro(
      pc.red(`${totalFailures} issue${totalFailures === 1 ? "" : "s"} found.`) +
        (!opts.checkTypes ? pc.dim("  Run monokit doctor --types to also check TypeScript.") : ""),
    );
    process.exit(1);
  }
}

import { join } from "node:path";
import { tmpdir } from "node:os";
import * as p from "@clack/prompts";
import fs from "fs-extra";
import pc from "picocolors";

import { run } from "./utils/exec.js";
import { isGitWorkingTreeClean } from "./utils/git.js";
import {
  readMonokitConfig,
  type ShadcnOwnership,
  writeMonokitConfig,
} from "./utils/monokit-config.js";
import {
  findShadcnConfigDrift,
  findShadcnPrimitiveDependencyDrift,
  inferShadcnPrimitive,
  projectShadcnConfig,
  stripShadcnPrimitiveDependencies,
  type ShadcnConfig,
  type ShadcnPrimitive,
} from "./utils/shadcn-config.js";
import {
  findSharedShadcnIssues,
  inspectSharedUiPrimitiveImports,
  readSharedShadcnConfig,
} from "./utils/shadcn-project.js";
import { ensureSharedUiPrimitiveDependencies } from "./utils/shadcn-dependencies.js";
import {
  detectProjectPackageManager,
  pmDlx,
  pmInstall,
} from "./utils/pm.js";

export type ShadcnUpgradeStatus =
  | "ambiguous"
  | "current"
  | "primitive-migration"
  | "safe-repair";

export interface ShadcnUpgradePlan {
  status: ShadcnUpgradeStatus;
  appModes: Record<string, ShadcnOwnership>;
  targetStyle: string | null;
  targetPrimitive: ShadcnPrimitive;
  currentPrimitive: ShadcnPrimitive | "mixed";
  sharedComponents: string[];
  conflictingPackages: string[];
  missingPackages: string[];
  reasons: string[];
  targetConfig: ShadcnConfig | null;
}

async function detectAppConfigs(
  projectDir: string,
): Promise<Array<{ appName: string; config: ShadcnConfig | null }>> {
  const appsDir = join(projectDir, "apps");
  const entries = await fs.readdir(appsDir, { withFileTypes: true }).catch(() => []);
  const apps: Array<{ appName: string; config: ShadcnConfig | null }> = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const config = (await fs
      .readJson(join(appsDir, entry.name, "components.json"))
      .catch(() => null)) as ShadcnConfig | null;
    apps.push({ appName: entry.name, config });
  }

  return apps;
}

async function listSharedComponentNames(projectDir: string): Promise<string[]> {
  const entries = await fs
    .readdir(join(projectDir, "packages/ui/src"), { withFileTypes: true })
    .catch(() => []);
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".tsx"))
    .map((entry) => entry.name.replace(/\.tsx$/, ""))
    .sort();
}

async function findTargetPrimitiveDependencyConflicts(
  projectDir: string,
  targetConfig: ShadcnConfig | null,
): Promise<string[]> {
  if (!targetConfig) return [];
  const packageJson = (await fs
    .readJson(join(projectDir, "packages/ui/package.json"))
    .catch(() => ({}))) as Record<string, unknown>;
  return findShadcnPrimitiveDependencyDrift(targetConfig, packageJson);
}

function importedPrimitiveState(
  imported: Array<Exclude<ShadcnPrimitive, "unknown">>,
): ShadcnPrimitive | "mixed" {
  if (imported.length > 1) return "mixed";
  return imported[0] ?? "unknown";
}

export async function inspectShadcnUpgrade(projectDir: string): Promise<ShadcnUpgradePlan> {
  const metadata = await readMonokitConfig(projectDir);
  const apps = await detectAppConfigs(projectDir);
  const sharedComponents = await listSharedComponentNames(projectDir);
  const importAudit = await inspectSharedUiPrimitiveImports(projectDir);
  const currentPrimitive = importedPrimitiveState(importAudit.importedPrimitives);

  if (metadata) {
    const detectedAppNames = apps.map((app) => app.appName).sort();
    const configuredAppNames = Object.keys(metadata.shadcn.apps).sort();
    if (
      detectedAppNames.length !== configuredAppNames.length ||
      detectedAppNames.some((appName, index) => appName !== configuredAppNames[index])
    ) {
      return {
        status: "ambiguous",
        appModes: { ...metadata.shadcn.apps },
        targetStyle: null,
        targetPrimitive: "unknown",
        currentPrimitive,
        sharedComponents,
        conflictingPackages: [],
        missingPackages: importAudit.missingPackages,
        reasons: [
          ".monokit.json ownership does not match detected apps and must be classified again",
        ],
        targetConfig: null,
      };
    }

    const sharedAppNames = Object.entries(metadata.shadcn.apps)
      .filter(([, mode]) => mode === "shared")
      .map(([appName]) => appName);
    if (sharedAppNames.length === 0) {
      return {
        status: "current",
        appModes: { ...metadata.shadcn.apps },
        targetStyle: null,
        targetPrimitive: "unknown",
        currentPrimitive,
        sharedComponents,
        conflictingPackages: [],
        missingPackages: [],
        reasons: [],
        targetConfig: null,
      };
    }

    const missingSharedAppConfigs = sharedAppNames.filter(
      (appName) => !apps.find((app) => app.appName === appName)?.config,
    );
    if (missingSharedAppConfigs.length > 0) {
      return {
        status: "ambiguous",
        appModes: { ...metadata.shadcn.apps },
        targetStyle: null,
        targetPrimitive: "unknown",
        currentPrimitive,
        sharedComponents,
        conflictingPackages: [],
        missingPackages: importAudit.missingPackages,
        reasons: missingSharedAppConfigs.map(
          (appName) =>
            `apps/${appName}/components.json is missing, so workspace-specific paths cannot be preserved`,
        ),
        targetConfig: null,
      };
    }

    let targetConfig = await readSharedShadcnConfig(projectDir);
    if (!targetConfig) {
      const sharedAppConfigs = apps.filter(
        (app): app is { appName: string; config: ShadcnConfig } =>
          metadata.shadcn.apps[app.appName] === "shared" && app.config !== null,
      );
      if (
        sharedAppConfigs.length === 0 ||
        sharedAppConfigs
          .slice(1)
          .some(({ config }) =>
            findShadcnConfigDrift(sharedAppConfigs[0]!.config, config).length > 0,
          )
      ) {
        return {
          status: "ambiguous",
          appModes: { ...metadata.shadcn.apps },
          targetStyle: null,
          targetPrimitive: "unknown",
          currentPrimitive,
          sharedComponents,
          conflictingPackages: [],
          missingPackages: importAudit.missingPackages,
          reasons: [
            "packages/ui/components.json is missing and shared app designs do not provide one unambiguous replacement",
          ],
          targetConfig: null,
        };
      }
      targetConfig = sharedAppConfigs[0]!.config;
    }
    const targetPrimitive = inferShadcnPrimitive(targetConfig?.style);
    const conflictingPackages = await findTargetPrimitiveDependencyConflicts(
      projectDir,
      targetConfig,
    );
    const drift = await findSharedShadcnIssues(projectDir);
    const primitiveMismatch =
      currentPrimitive === "mixed" ||
      (currentPrimitive !== "unknown" &&
        targetPrimitive !== "unknown" &&
        currentPrimitive !== targetPrimitive);
    const reasons = [
      ...drift.map((issue) => `apps/${issue.appName}: ${issue.fields.join(", ")}`),
      ...importAudit.missingPackages.map((packageName) => `missing dependency: ${packageName}`),
      ...conflictingPackages.map((packageName) => `conflicting dependency: ${packageName}`),
    ];

    return {
      status: primitiveMismatch
        ? "primitive-migration"
        : reasons.length > 0
          ? "safe-repair"
          : "current",
      appModes: { ...metadata.shadcn.apps },
      targetStyle: typeof targetConfig?.style === "string" ? targetConfig.style : null,
      targetPrimitive,
      currentPrimitive,
      sharedComponents,
      conflictingPackages,
      missingPackages: importAudit.missingPackages,
      reasons,
      targetConfig,
    };
  }

  if (sharedComponents.length === 0) {
    const appModes = Object.fromEntries(
      apps.map(({ appName, config }) => [appName, config ? "per-app" : "none"]),
    ) as Record<string, ShadcnOwnership>;
    return {
      status: "safe-repair",
      appModes,
      targetStyle: null,
      targetPrimitive: "unknown",
      currentPrimitive,
      sharedComponents,
      conflictingPackages: [],
      missingPackages: importAudit.missingPackages,
      reasons: ["missing .monokit.json ownership metadata"],
      targetConfig: null,
    };
  }

  const configuredApps = apps.filter(
    (app): app is { appName: string; config: ShadcnConfig } => app.config !== null,
  );
  if (configuredApps.length === 0) {
    return {
      status: "ambiguous",
      appModes: {},
      targetStyle: null,
      targetPrimitive: "unknown",
      currentPrimitive,
      sharedComponents,
      conflictingPackages: [],
      missingPackages: importAudit.missingPackages,
      reasons: ["shared components exist but no app configuration identifies the intended design"],
      targetConfig: null,
    };
  }

  return {
    status: "ambiguous",
    appModes: {},
    targetStyle: null,
    targetPrimitive: "unknown",
    currentPrimitive,
    sharedComponents,
    conflictingPackages: [],
    missingPackages: importAudit.missingPackages,
    reasons: [
      configuredApps.length > 1 &&
      configuredApps
        .slice(1)
        .some(({ config }) =>
          findShadcnConfigDrift(configuredApps[0]!.config, config).length > 0,
        )
        ? "legacy app shadcn designs disagree and ownership is missing"
        : "legacy app ownership cannot be inferred safely from matching shadcn designs",
    ],
    targetConfig: null,
  };
}

export async function createClassifiedShadcnUpgradePlan(
  projectDir: string,
  appModes: Record<string, ShadcnOwnership>,
  canonicalAppName?: string,
): Promise<ShadcnUpgradePlan> {
  const sharedApps = Object.entries(appModes)
    .filter(([, mode]) => mode === "shared")
    .map(([appName]) => appName);
  const sharedComponents = await listSharedComponentNames(projectDir);
  const importAudit = await inspectSharedUiPrimitiveImports(projectDir);
  const currentPrimitive = importedPrimitiveState(importAudit.importedPrimitives);

  if (sharedApps.length === 0) {
    return {
      status: "safe-repair",
      appModes,
      targetStyle: null,
      targetPrimitive: "unknown",
      currentPrimitive,
      sharedComponents,
      conflictingPackages: [],
      missingPackages: importAudit.missingPackages,
      reasons: ["record explicit app ownership metadata"],
      targetConfig: null,
    };
  }

  if (!canonicalAppName || !sharedApps.includes(canonicalAppName)) {
    throw new Error("Choose one shared app as the canonical shadcn design source.");
  }
  const targetConfig = (await fs
    .readJson(join(projectDir, "apps", canonicalAppName, "components.json"))
    .catch(() => null)) as ShadcnConfig | null;
  if (!targetConfig) {
    throw new Error(`apps/${canonicalAppName}/components.json is missing.`);
  }

  const targetPrimitive = inferShadcnPrimitive(targetConfig.style);
  const conflictingPackages = await findTargetPrimitiveDependencyConflicts(
    projectDir,
    targetConfig,
  );
  const needsPrimitiveMigration =
    currentPrimitive === "mixed" ||
    (currentPrimitive !== "unknown" &&
      targetPrimitive !== "unknown" &&
      currentPrimitive !== targetPrimitive);

  return {
    status: needsPrimitiveMigration ? "primitive-migration" : "safe-repair",
    appModes: { ...appModes },
    targetStyle: typeof targetConfig.style === "string" ? targetConfig.style : null,
    targetPrimitive,
    currentPrimitive,
    sharedComponents,
    conflictingPackages,
    missingPackages: importAudit.missingPackages,
    reasons: [`apps/${canonicalAppName} selected as the canonical shared design`],
    targetConfig,
  };
}

function workspaceString(config: ShadcnConfig, field: "config" | "css"): string | undefined {
  const value = config.tailwind?.[field];
  return typeof value === "string" ? value : undefined;
}

async function writeSynchronizedShadcnConfig(
  projectDir: string,
  plan: ShadcnUpgradePlan,
): Promise<void> {
  if (plan.targetConfig) {
    const currentShared = (await readSharedShadcnConfig(projectDir)) ?? {};
    const sharedConfig = projectShadcnConfig(plan.targetConfig, {
      rsc: typeof currentShared.rsc === "boolean" ? currentShared.rsc : false,
      tailwindCss:
        workspaceString(currentShared, "css") || "../tailwind-config/globals.css",
      tailwindConfig: workspaceString(currentShared, "config"),
      aliases: currentShared.aliases ?? {
        components: "src",
        utils: "src/utils",
        ui: "src",
        lib: "src",
        hooks: "src/hooks",
      },
    });
    await fs.writeJson(join(projectDir, "packages/ui/components.json"), sharedConfig, {
      spaces: 2,
    });

    for (const [appName, mode] of Object.entries(plan.appModes)) {
      if (mode !== "shared") continue;
      const appPath = join(projectDir, "apps", appName, "components.json");
      const currentApp = (await fs.readJson(appPath).catch(() => null)) as ShadcnConfig | null;
      if (!currentApp) continue;
      const appConfig = projectShadcnConfig(plan.targetConfig, {
        rsc: typeof currentApp.rsc === "boolean" ? currentApp.rsc : false,
        tailwindCss: workspaceString(currentApp, "css") ?? "",
        tailwindConfig: workspaceString(currentApp, "config"),
        aliases: currentApp.aliases ?? {},
      });
      await fs.writeJson(appPath, appConfig, { spaces: 2 });
    }
  }

  await writeMonokitConfig(projectDir, {
    schemaVersion: 1,
    shadcn: { apps: { ...plan.appModes } },
  });
}

export async function applySafeShadcnRepair(
  projectDir: string,
  plan: ShadcnUpgradePlan,
  repairDependencies: (
    projectDir: string,
    changes: { add: string[]; remove: string[] },
  ) => Promise<void> = repairSharedDependencies,
): Promise<void> {
  if (plan.status !== "safe-repair") {
    throw new Error(`Cannot apply a safe repair to a ${plan.status} plan.`);
  }
  if (plan.missingPackages.length > 0 || plan.conflictingPackages.length > 0) {
    await repairDependencies(projectDir, {
      add: plan.missingPackages,
      remove: plan.conflictingPackages,
    });
  }
  await writeSynchronizedShadcnConfig(projectDir, plan);
}

async function repairSharedDependencies(
  projectDir: string,
  changes: { add: string[]; remove: string[] },
): Promise<void> {
  const pm = await detectProjectPackageManager(projectDir);
  const uiDir = join(projectDir, "packages/ui");
  if (changes.remove.length > 0) {
    await run(pm, ["remove", ...changes.remove], uiDir);
  }
  if (changes.add.length > 0) {
    await run(pm, ["add", ...changes.add], uiDir);
  }
}

export async function assertPrimitiveMigrationReady(
  projectDir: string,
  plan: ShadcnUpgradePlan,
): Promise<void> {
  if (plan.status !== "primitive-migration") {
    throw new Error(`Cannot prepare a primitive migration for a ${plan.status} plan.`);
  }
  if (plan.currentPrimitive === "mixed") {
    throw new Error("Shared components mix primitive libraries and require a manual migration.");
  }
  if (plan.sharedComponents.length === 0) {
    throw new Error("No registry-backed shared components were found to regenerate.");
  }
  if (!(await isGitWorkingTreeClean(projectDir))) {
    throw new Error("Primitive migration requires a clean Git working tree.");
  }
}

function buildTargetSharedConfig(
  plan: ShadcnUpgradePlan,
  currentShared: ShadcnConfig,
): ShadcnConfig {
  if (!plan.targetConfig) throw new Error("Primitive migration has no target shadcn config.");
  return projectShadcnConfig(plan.targetConfig, {
    rsc: typeof currentShared.rsc === "boolean" ? currentShared.rsc : false,
    tailwindCss: workspaceString(currentShared, "css") || "../tailwind-config/globals.css",
    tailwindConfig: workspaceString(currentShared, "config"),
    aliases: currentShared.aliases ?? {
      components: "src",
      utils: "src/utils",
      ui: "src",
      lib: "src",
      hooks: "src/hooks",
    },
  });
}

export async function previewPrimitiveMigration(
  projectDir: string,
  plan: ShadcnUpgradePlan,
): Promise<void> {
  await assertPrimitiveMigrationReady(projectDir, plan);
  const previewDir = await fs.mkdtemp(join(tmpdir(), "monokit-shadcn-preview-"));
  const previewUiDir = join(previewDir, "ui");

  try {
    await fs.copy(join(projectDir, "packages/ui"), previewUiDir, {
      filter: (source) => !source.includes(`${join("packages", "ui", "node_modules")}`),
    });
    const currentShared = (await readSharedShadcnConfig(projectDir)) ?? {};
    await fs.writeJson(
      join(previewUiDir, "components.json"),
      buildTargetSharedConfig(plan, currentShared),
      { spaces: 2 },
    );
    const pm = await detectProjectPackageManager(projectDir);
    await pmDlx(
      pm,
      ["shadcn@latest", "add", ...plan.sharedComponents, "--dry-run"],
      previewUiDir,
    );
  } finally {
    await fs.remove(previewDir);
  }
}

async function normalizeSharedComponents(projectDir: string, componentNames: string[]): Promise<void> {
  const uiDir = join(projectDir, "packages/ui");
  const indexPath = join(uiDir, "src/index.ts");
  let indexContent = await fs.readFile(indexPath, "utf-8").catch(() => "");

  for (const componentName of componentNames) {
    const componentPath = join(uiDir, "src", `${componentName}.tsx`);
    if (!(await fs.pathExists(componentPath))) continue;
    const content = await fs.readFile(componentPath, "utf-8");
    const fixed = content
      .replace(/from "src\/utils"/g, 'from "./utils"')
      .replace(/from "@[^"]*\/utils"/g, 'from "./utils"')
      .replace(/from "@[^"]*\/components\/ui\/([^"]+)"/g, 'from "./$1"')
      .replace(/from "src\/([^"]+)"/g, 'from "./$1"');
    await fs.writeFile(componentPath, fixed, "utf-8");

    if (!indexContent.includes(`./${componentName}`)) {
      indexContent += `export * from "./${componentName}";\n`;
    }
  }

  await fs.writeFile(indexPath, indexContent, "utf-8");
}

export async function applyPrimitiveShadcnMigration(
  projectDir: string,
  plan: ShadcnUpgradePlan,
): Promise<void> {
  await assertPrimitiveMigrationReady(projectDir, plan);
  const uiPackagePath = join(projectDir, "packages/ui/package.json");
  const uiPackage = (await fs.readJson(uiPackagePath)) as Record<string, unknown>;
  await fs.writeJson(uiPackagePath, stripShadcnPrimitiveDependencies(uiPackage), { spaces: 2 });

  const currentShared = (await readSharedShadcnConfig(projectDir)) ?? {};
  await fs.writeJson(
    join(projectDir, "packages/ui/components.json"),
    buildTargetSharedConfig(plan, currentShared),
    { spaces: 2 },
  );

  const pm = await detectProjectPackageManager(projectDir);
  await pmDlx(
    pm,
    ["shadcn@latest", "add", ...plan.sharedComponents, "--yes", "--overwrite"],
    join(projectDir, "packages/ui"),
  );
  await ensureSharedUiPrimitiveDependencies(projectDir, pm);
  await normalizeSharedComponents(projectDir, plan.sharedComponents);
  await writeSynchronizedShadcnConfig(projectDir, plan);
  await pmInstall(pm, projectDir);
  await run(pm, ["run", "check-types"], projectDir);
}

function printUpgradePlan(plan: ShadcnUpgradePlan): void {
  p.note(
    [
      `Status: ${plan.status}`,
      `Target style: ${plan.targetStyle ?? "not applicable"}`,
      `Primitive: ${plan.currentPrimitive} → ${plan.targetPrimitive}`,
      `Shared components: ${plan.sharedComponents.join(", ") || "none"}`,
      ...plan.reasons.map((reason) => `- ${reason}`),
    ].join("\n"),
    "Shadcn upgrade plan",
  );
}

export async function upgrade(cwd: string, options: { check?: boolean } = {}): Promise<void> {
  p.intro(pc.bgCyan(pc.black(" monokit upgrade ")));
  let plan = await inspectShadcnUpgrade(cwd);
  printUpgradePlan(plan);

  if (options.check || plan.status === "current") {
    p.outro(
      plan.status === "current"
        ? pc.green("Shadcn configuration is already synchronized.")
        : pc.cyan("Check complete. No files were changed."),
    );
    return;
  }

  if (plan.status === "ambiguous") {
    p.log.info("Legacy ownership is ambiguous. Classify each app before continuing.");
    const apps = await detectAppConfigs(cwd);
    const appModes: Record<string, ShadcnOwnership> = {};
    for (const app of apps) {
      const mode = await p.select({
        message: `How does apps/${app.appName} own shadcn components?`,
        options: [
          { value: "shared", label: "Shared design system" },
          { value: "per-app", label: "Independent per-app design" },
          { value: "none", label: "No shadcn" },
        ],
      });
      if (p.isCancel(mode)) {
        p.outro(pc.yellow("Cancelled. No files were changed."));
        return;
      }
      appModes[app.appName] = mode as ShadcnOwnership;
    }

    const sharedSourceApps = apps.filter(
      (app) => appModes[app.appName] === "shared" && app.config !== null,
    );
    let canonicalAppName: string | undefined;
    if (Object.values(appModes).includes("shared")) {
      if (sharedSourceApps.length === 0) {
        p.outro(pc.red("A shared app must have components.json to seed the canonical design."));
        process.exit(1);
      }
      if (sharedSourceApps.length === 1) {
        canonicalAppName = sharedSourceApps[0]!.appName;
      } else {
        const source = await p.select({
          message: "Which shared app has the intended canonical shadcn design?",
          options: sharedSourceApps.map((app) => ({
            value: app.appName,
            label: `apps/${app.appName}`,
          })),
        });
        if (p.isCancel(source)) {
          p.outro(pc.yellow("Cancelled. No files were changed."));
          return;
        }
        canonicalAppName = source as string;
      }
    }

    plan = await createClassifiedShadcnUpgradePlan(cwd, appModes, canonicalAppName);
    printUpgradePlan(plan);
  }

  if (plan.status === "safe-repair") {
    const confirmed = await p.confirm({
      message: "Apply this safe metadata and configuration repair?",
      initialValue: false,
    });
    if (p.isCancel(confirmed) || !confirmed) {
      p.outro(pc.yellow("Cancelled. No files were changed."));
      return;
    }

    await applySafeShadcnRepair(cwd, plan);
    p.outro(pc.green("Shadcn configuration and ownership metadata synchronized."));
    return;
  }

  try {
    p.log.step("Running shadcn dry-run against a temporary copy of packages/ui");
    await previewPrimitiveMigration(cwd, plan);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    p.outro(pc.red(`${message} No project files were changed.`));
    process.exit(1);
  }

  const confirmed = await p.confirm({
    message: `Overwrite ${plan.sharedComponents.length} shared component${plan.sharedComponents.length === 1 ? "" : "s"} using ${plan.targetStyle ?? "the selected style"}?`,
    initialValue: false,
  });
  if (p.isCancel(confirmed) || !confirmed) {
    p.outro(pc.yellow("Cancelled. No project files were changed."));
    return;
  }

  try {
    await applyPrimitiveShadcnMigration(cwd, plan);
    p.outro(pc.green("Shared components migrated and type checking passed."));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    p.outro(
      pc.red(
        `Migration stopped: ${message}\nReview "git status", restore tracked files under packages/ui and apps from HEAD, and remove only the untracked migration files shown by Git.`,
      ),
    );
    process.exit(1);
  }
}

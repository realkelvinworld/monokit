import { join } from "path";
import * as p from "@clack/prompts";
import pc from "picocolors";

import {
  addWorkspaceDeps,
  initShadcnNext,
  initShadcnVite,
  scaffoldNextApp,
  scaffoldViteApp,
  wireNextCss,
  wireViteCss,
} from "./utils/apps.js";
import { writeFile, writeJson } from "./utils/files.js";
import { type PackageManager, detectPackageManager, detectPackageManagerField, pmInstall, workspaceDep } from "./utils/pm.js";
import {
  eslintBase,
  eslintConfigPackageJson,
  eslintNext,
  eslintReactLibrary,
  tailwindConfigCss,
  tailwindConfigPackageJson,
  tsConfigBase,
  tsConfigNextJs,
  tsConfigPackageJson,
  tsConfigReactLibrary,
  tsConfigVite,
  uiComponentsJson,
  uiIndex,
  uiPackageJson,
  uiTsConfig,
  uiUtils,
} from "./templates/packages.js";
import { gitIgnore, pnpmWorkspace, prettierConfig, prettierIgnore, rootPackageJson, turboJson } from "./templates/root.js";

type ShadcnMode = "shared" | "per-app" | "no";

export async function scaffold(cwd: string): Promise<void> {
  p.intro(pc.bgCyan(pc.black(" create-monokit ")));

  const onCancel = () => {
    p.cancel("Cancelled.");
    process.exit(0);
  };

  const options = await p.group(
    {
      pm: () =>
        p.select({
          message: "Package manager?",
          initialValue: detectPackageManager() as string,
          options: [
            { value: "pnpm", label: "pnpm" },
            { value: "npm", label: "npm" },
            { value: "yarn", label: "yarn" },
            { value: "bun", label: "bun" },
          ],
        }),
      name: () =>
        p.text({
          message: "Project name?",
          placeholder: "my-project",
          validate: (v) => (!v ? "Name is required" : undefined),
        }),
      apps: () =>
        p.multiselect({
          message: "Which apps do you want?",
          options: [
            { value: "next", label: "Next.js", hint: "App Router + Turbopack" },
            { value: "vite", label: "Vite + React" },
          ],
          required: true,
        }),
      nextName: ({ results }) => {
        if (!(results.apps as string[])?.includes("next")) return;
        return p.text({
          message: "Next.js app name?",
          placeholder: "web",
          validate: (v) => (!v ? "Name is required" : undefined),
        });
      },
      nextSrcDir: ({ results }) => {
        if (!(results.apps as string[])?.includes("next")) return;
        return p.confirm({ message: "Use src/ directory for Next.js?", initialValue: false });
      },
      viteName: ({ results }) => {
        if (!(results.apps as string[])?.includes("vite")) return;
        return p.text({
          message: "Vite app name?",
          placeholder: "dashboard",
          validate: (v) => (!v ? "Name is required" : undefined),
        });
      },
      shadcn: () =>
        p.select({
          message: "Add shadcn/ui?",
          options: [
            {
              value: "shared",
              label: "Shared design system",
              hint: "One init, components in packages/ui — recommended",
            },
            {
              value: "per-app",
              label: "Per app",
              hint: "Each app manages its own components",
            },
            { value: "no", label: "No shadcn" },
          ],
        }),
    },
    { onCancel },
  );

  // --- Summary + confirm ---
  const pm = options.pm as PackageManager;
  const apps = options.apps as string[];
  const shadcnMode = options.shadcn as ShadcnMode;
  const useSrcDir = (options.nextSrcDir as boolean | undefined) ?? false;
  const nextAppName = (options.nextName as string | undefined) ?? "web";
  const viteAppName = (options.viteName as string | undefined) ?? "dashboard";

  const appLines = apps.map((app) => {
    if (app === "next") return `Next.js  → apps/${nextAppName}  (${useSrcDir ? "src/app/" : "app/"})`;
    return `Vite     → apps/${viteAppName}`;
  });

  const shadcnLabel: Record<ShadcnMode, string> = {
    shared: "Shared design system → packages/ui",
    "per-app": "Per app (each app manages its own components)",
    no: "None",
  };

  p.note(
    [...appLines, `shadcn   → ${shadcnLabel[shadcnMode]}`].join("\n"),
    options.name as string,
  );

  const proceed = await p.confirm({ message: "Proceed?", initialValue: true });
  if (p.isCancel(proceed) || !proceed) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  // --- Scaffold ---
  const s = p.spinner();
  const projectDir = `${cwd}/${options.name}`;

  s.start("Creating project structure");
  const pmField = await detectPackageManagerField(pm);
  const appNames = [
    ...(apps.includes("next") ? [nextAppName] : []),
    ...(apps.includes("vite") ? [viteAppName] : []),
  ];
  await writeJson(cwd, `${options.name}/package.json`, rootPackageJson(options.name as string, pm, pmField, appNames));
  await writeJson(cwd, `${options.name}/turbo.json`, turboJson);
  if (pm === "pnpm") {
    await writeFile(cwd, `${options.name}/pnpm-workspace.yaml`, pnpmWorkspace);
  }
  await writeFile(cwd, `${options.name}/.gitignore`, gitIgnore);
  await writeJson(cwd, `${options.name}/.prettierrc`, prettierConfig);
  await writeFile(cwd, `${options.name}/.prettierignore`, prettierIgnore);
  await writeJson(cwd, `${options.name}/.vscode/settings.json`, {
    "tailwindCSS.experimental.configFile": {
      "packages/tailwind-config/globals.css": ["**"],
    },
  });
  s.stop("Project structure created");

  s.start("Setting up shared packages");
  await writeJson(cwd, `${options.name}/packages/eslint-config/package.json`, eslintConfigPackageJson);
  await writeFile(cwd, `${options.name}/packages/eslint-config/base.js`, eslintBase);
  await writeFile(cwd, `${options.name}/packages/eslint-config/next.js`, eslintNext);
  await writeFile(cwd, `${options.name}/packages/eslint-config/react-library.js`, eslintReactLibrary);
  await writeJson(cwd, `${options.name}/packages/tailwind-config/package.json`, tailwindConfigPackageJson);
  await writeFile(cwd, `${options.name}/packages/tailwind-config/globals.css`, tailwindConfigCss);
  await writeJson(cwd, `${options.name}/packages/ui/package.json`, uiPackageJson(workspaceDep(pm)));
  await writeJson(cwd, `${options.name}/packages/ui/tsconfig.json`, uiTsConfig);
  await writeJson(cwd, `${options.name}/packages/ui/components.json`, uiComponentsJson);
  await writeFile(cwd, `${options.name}/packages/ui/src/utils.ts`, uiUtils);
  await writeFile(cwd, `${options.name}/packages/ui/src/index.ts`, uiIndex);
  await writeJson(cwd, `${options.name}/packages/typescript-config/package.json`, tsConfigPackageJson);
  await writeJson(cwd, `${options.name}/packages/typescript-config/base.json`, tsConfigBase);
  await writeJson(cwd, `${options.name}/packages/typescript-config/nextjs.json`, tsConfigNextJs);
  await writeJson(cwd, `${options.name}/packages/typescript-config/react-library.json`, tsConfigReactLibrary);
  await writeJson(cwd, `${options.name}/packages/typescript-config/vite.json`, tsConfigVite);
  s.stop("Shared packages ready");

  await writeFile(cwd, `${options.name}/apps/.gitkeep`, "");

  if (apps.includes("next")) {
    s.start(`Scaffolding Next.js app → apps/${nextAppName}`);
    await scaffoldNextApp(projectDir, nextAppName, useSrcDir, pm, 3000);
    s.stop(`Next.js app scaffolded → apps/${nextAppName}`);
  }

  if (apps.includes("vite")) {
    s.start(`Scaffolding Vite app → apps/${viteAppName}`);
    await scaffoldViteApp(projectDir, viteAppName, pm, apps.includes("next") ? 3001 : 3000);
    s.stop(`Vite app scaffolded → apps/${viteAppName}`);
  }

  s.start("Installing dependencies");
  await pmInstall(pm, projectDir);
  s.stop("Dependencies installed");

  // --- shadcn setup ---
  let shadcnConfig: Record<string, unknown> | undefined;
  let shadcnSourceDir: string | undefined;

  if (apps.includes("next")) {
    if (shadcnMode !== "no") {
      if (shadcnMode === "shared") {
        p.log.step(`Setting up shadcn/ui for apps/${nextAppName} — choose your style and color:`);
      } else {
        p.log.step(`Setting up shadcn/ui for apps/${nextAppName} — choose your style and color:`);
      }
      shadcnConfig = await initShadcnNext(projectDir, nextAppName, {
        shared: shadcnMode === "shared",
        useSrcDir,
        pm,
      });
      if (shadcnMode === "shared") {
        shadcnSourceDir = join(projectDir, "apps", nextAppName);
      }
    } else {
      await wireNextCss(projectDir, nextAppName, useSrcDir);
    }
    p.log.success(`apps/${nextAppName} ready`);
  }

  if (apps.includes("vite")) {
    if (shadcnMode !== "no") {
      const isShared = shadcnMode === "shared";
      if (!isShared || !shadcnConfig) {
        p.log.step(`Setting up shadcn/ui for apps/${viteAppName} — choose your style and color:`);
      }
      shadcnConfig = await initShadcnVite(projectDir, viteAppName, {
        shared: isShared,
        config: isShared ? shadcnConfig : undefined,
        sourceAppDir: isShared ? shadcnSourceDir : undefined,
        pm,
      });
    } else {
      await wireViteCss(projectDir, viteAppName);
    }
    p.log.success(`apps/${viteAppName} ready`);
  }

  // Wire workspace deps now — adding them before shadcn init breaks pnpm v10 resolution
  s.start("Adding workspace packages");
  if (apps.includes("next")) await addWorkspaceDeps(projectDir, nextAppName, "next", pm);
  if (apps.includes("vite")) await addWorkspaceDeps(projectDir, viteAppName, "vite", pm);
  await pmInstall(pm, projectDir);
  s.stop("Workspace packages linked");

  const runCmd = pm === "npm" ? "npm run" : pm;
  p.outro(pc.green(`Done! cd ${options.name as string} && ${runCmd} dev`));
}

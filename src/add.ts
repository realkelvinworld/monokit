import * as p from "@clack/prompts";
import fs from "fs-extra";
import pc from "picocolors";
import { join } from "path";

import {
  addWorkspaceDeps,
  initShadcnNext,
  initShadcnVite,
  scaffoldNextApp,
  scaffoldViteApp,
  wireNextCss,
  wireNextToSharedShadcn,
  wireViteCss,
  wireViteToSharedShadcn,
} from "./utils/apps.js";
import { detectProjectPackageManager, pmInstall, type PackageManager } from "./utils/pm.js";
import { mergeJson } from "./utils/files.js";
import { getWorkspaceNameError } from "./utils/workspace-name.js";
import { setAppShadcnMode } from "./utils/monokit-config.js";
import { readMonokitConfig } from "./utils/monokit-config.js";
import { type ShadcnConfig } from "./utils/shadcn-config.js";

type ShadcnMode = "shared" | "per-app" | "no";

export async function add(cwd: string): Promise<void> {
  p.intro(pc.bgCyan(pc.black(" create-monokit — add ")));

  if (!(await readMonokitConfig(cwd))) {
    p.cancel(
      "Monokit ownership metadata is missing. Run monokit upgrade before adding another app.",
    );
    process.exit(1);
  }

  const onCancel = () => {
    p.cancel("Cancelled.");
    process.exit(0);
  };

  const options = await p.group(
    {
      type: () =>
        p.select({
          message: "What do you want to add?",
          options: [
            { value: "next", label: "Next.js app", hint: "App Router + Turbopack" },
            { value: "vite", label: "Vite + React app" },
          ],
        }),
      appName: ({ results }) =>
        p.text({
          message: `${results.type === "next" ? "Next.js" : "Vite"} app name?`,
          placeholder: results.type === "next" ? "web" : "dashboard",
          validate: getWorkspaceNameError,
        }),
      nextSrcDir: ({ results }) => {
        if (results.type !== "next") return;
        return p.confirm({ message: "Use src/ directory?", initialValue: false });
      },
      shadcn: () =>
        p.select({
          message: "Add shadcn/ui?",
          options: [
            {
              value: "shared",
              label: "Shared design system",
              hint: "Components in packages/ui — recommended",
            },
            {
              value: "per-app",
              label: "Per app",
              hint: "Components stay in this app",
            },
            { value: "no", label: "No shadcn" },
          ],
        }),
    },
    { onCancel },
  );

  const pm: PackageManager = await detectProjectPackageManager(cwd);
  const s = p.spinner();
  const appName = options.appName as string;
  const shadcnMode = options.shadcn as ShadcnMode;
  const useSrcDir = (options.nextSrcDir as boolean | undefined) ?? false;

  if (options.type === "next") {
    s.start(`Scaffolding Next.js app → apps/${appName}`);
    await scaffoldNextApp(cwd, appName, useSrcDir, pm);
    s.stop(`Next.js app scaffolded → apps/${appName}`);
  } else {
    s.start(`Scaffolding Vite app → apps/${appName}`);
    await scaffoldViteApp(cwd, appName, pm);
    s.stop(`Vite app scaffolded → apps/${appName}`);
  }

  s.start("Installing dependencies");
  await pmInstall(pm, cwd);
  s.stop("Dependencies installed");

  // Detect whether the monorepo already has a shared shadcn setup
  const sharedConfig = (await fs
    .readJson(join(cwd, "packages/ui/components.json"))
    .catch(() => null)) as ShadcnConfig | null;
  const sharedAlreadySetUp = sharedConfig !== null;

  if (options.type === "next") {
    if (shadcnMode === "shared" && sharedAlreadySetUp) {
      s.start("Wiring shadcn/ui from shared packages");
      await wireNextToSharedShadcn(cwd, appName, sharedConfig, useSrcDir);
      s.stop("shadcn/ui wired");
    } else if (shadcnMode !== "no") {
      p.log.step(`Setting up shadcn/ui for apps/${appName} — choose your style and color:`);
      await initShadcnNext(cwd, appName, { shared: shadcnMode === "shared", useSrcDir, pm });
    } else {
      await wireNextCss(cwd, appName, useSrcDir);
    }
  } else {
    if (shadcnMode === "shared" && sharedAlreadySetUp) {
      s.start("Wiring shadcn/ui from shared packages");
      await wireViteToSharedShadcn(cwd, appName);
      s.stop("shadcn/ui wired");
    } else if (shadcnMode !== "no") {
      p.log.step(`Setting up shadcn/ui for apps/${appName} — choose your style and color:`);
      await initShadcnVite(cwd, appName, { shared: shadcnMode === "shared", pm });
    } else {
      await wireViteCss(cwd, appName);
    }
  }

  // Wire workspace deps after shadcn — adding them before breaks pnpm v10 resolution
  s.start("Adding workspace packages");
  const appType = options.type === "next" ? "next" : "vite";
  await addWorkspaceDeps(cwd, appName, appType, pm);
  // Register per-app dev/build scripts in the monorepo root so the convention stays visible
  await mergeJson(cwd, "package.json", {
    scripts: {
      [`dev:${appName}`]: `turbo run dev --filter=${appName}`,
      [`build:${appName}`]: `turbo run build --filter=${appName}`,
    },
  });
  await pmInstall(pm, cwd);
  s.stop("Workspace packages linked");
  await setAppShadcnMode(cwd, appName, shadcnMode === "no" ? "none" : shadcnMode);

  const runCmd = pm === "npm" ? "npm run" : pm;
  p.log.success(`apps/${appName} ready`);
  p.outro(pc.green(`Done! cd apps/${appName} && ${runCmd} dev`));
}

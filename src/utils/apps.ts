import { join } from "path";
import fs from "fs-extra";

import { mergeJson, replaceInFile, writeFile, writeJson } from "./files.js";
import { assertGeneratedAppTargetAvailable, removeGeneratedAppGitMetadata } from "./git.js";
import { type PackageManager, pmCreate, pmCreateNonInteractive, pmDlx, workspaceDep } from "./pm.js";
import {
  type ShadcnConfig,
  projectShadcnConfig,
} from "./shadcn-config.js";
import { ensureSharedUiPrimitiveDependencies } from "./shadcn-dependencies.js";

const appShadcnAliases = {
  components: "@/components",
  utils: "@/lib/utils",
  ui: "@/components/ui",
  lib: "@/lib",
  hooks: "@/hooks",
};

const sharedUiShadcnAliases = {
  components: "src",
  utils: "src/utils",
  ui: "src",
  lib: "src",
  hooks: "src/hooks",
};

export function getNextAppCreateArgs(
  appName: string,
  useSrcDir: boolean,
  pm: PackageManager,
): string[] {
  return [
    "next-app@latest",
    `apps/${appName}`,
    "--typescript",
    "--eslint",
    "--tailwind",
    useSrcDir ? "--src-dir" : "--no-src-dir",
    "--app",
    "--turbopack",
    "--import-alias",
    "@/*",
    `--use-${pm}`,
    "--disable-git",
  ];
}

export async function scaffoldNextApp(
  projectDir: string,
  appName: string,
  useSrcDir = false,
  pm: PackageManager = "pnpm",
  port = 3000,
): Promise<void> {
  await assertGeneratedAppTargetAvailable(projectDir, appName);

  // --use-${pm} forces create-next-app to use the chosen PM regardless of how this CLI was invoked
  await pmCreate(pm, getNextAppCreateArgs(appName, useSrcDir, pm), projectDir);

  // This app was created by the command above, so cleanup cannot affect a pre-existing repository.
  await removeGeneratedAppGitMetadata(projectDir, appName);

  // create-next-app v16 creates its own pnpm-workspace.yaml inside the app — remove it
  // or Next.js will find two workspace files and fail to determine the root correctly.
  await fs.remove(join(projectDir, `apps/${appName}/pnpm-workspace.yaml`)).catch(() => null);

  // Workspace deps (@repo/*) are added separately after shadcn init.
  // If added here, shadcn's internal `pnpm add` fails to resolve workspace:* in pnpm v10.
  await mergeJson(projectDir, `apps/${appName}/package.json`, {
    scripts: {
      dev: `next dev --turbo --port ${port}`,
      lint: "next lint",
      "check-types": "tsc --noEmit",
    },
    devDependencies: {
      "@eslint/eslintrc": "^3.0.0",
    },
  });

  // Overwrite create-next-app's default eslint config with shared base + next rules
  await writeFile(
    projectDir,
    `apps/${appName}/eslint.config.js`,
    `import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";
import baseConfig from "@repo/eslint-config/base";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const compat = new FlatCompat({ baseDirectory: __dirname });

/** @type {import('eslint').Linter.Config[]} */
export default [
  ...baseConfig,
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];
`,
  );
}

export async function scaffoldViteApp(
  projectDir: string,
  appName: string,
  pm: PackageManager = "pnpm",
  port = 3001,
): Promise<void> {
  await assertGeneratedAppTargetAvailable(projectDir, appName);

  await pmCreateNonInteractive(
    pm,
    ["vite@latest", `apps/${appName}`, "--template", "react-ts"],
    projectDir,
  );

  // Keep the same single-root Git invariant if another app generator changes its defaults.
  await removeGeneratedAppGitMetadata(projectDir, appName);

  // Workspace deps (@repo/*) are added separately after shadcn init.
  await mergeJson(projectDir, `apps/${appName}/package.json`, {
    scripts: {
      lint: "eslint .",
      test: "vitest run",
      "test:watch": "vitest",
      "check-types": "tsc --noEmit",
    },
    dependencies: {
      "@fontsource-variable/geist": "^5.1.1",
      // clsx and tailwind-merge are used in src/lib/utils.ts (the cn() helper).
      // pnpm strict isolation means packages/ui's deps are NOT available to this app.
      clsx: "^2.1.1",
      "tailwind-merge": "^3.0.0",
    },
    devDependencies: {
      "@tailwindcss/vite": "^4.3.0",
      tailwindcss: "^4",
      vitest: "^3.0.0",
      "@testing-library/react": "^16.0.0",
      "@testing-library/jest-dom": "^6.0.0",
      "@vitejs/plugin-react": "^5.0.0",
    },
  });

  await writeFile(
    projectDir,
    `apps/${appName}/vitest.config.ts`,
    `import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
`,
  );

  await writeFile(
    projectDir,
    `apps/${appName}/src/test/setup.ts`,
    `import "@testing-library/jest-dom";\n`,
  );


  await writeFile(
    projectDir,
    `apps/${appName}/vite.config.ts`,
    `import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: { port: ${port} },
});
`,
  );

  await writeJson(projectDir, `apps/${appName}/tsconfig.app.json`, {
    extends: "@repo/typescript-config/vite.json",
    compilerOptions: {
      paths: { "@/*": ["./src/*"] },
      noUnusedLocals: true,
      noUnusedParameters: true,
      noFallthroughCasesInSwitch: true,
    },
    include: ["src"],
  });

  await writeFile(
    projectDir,
    `apps/${appName}/eslint.config.js`,
    `import reactLibraryConfig from "@repo/eslint-config/react-library";

/** @type {import('eslint').Linter.Config[]} */
export default reactLibraryConfig;
`,
  );

  // Seed src/index.css so shadcn can validate Tailwind is configured during init
  await writeFile(projectDir, `apps/${appName}/src/index.css`, '@import "tailwindcss";\n');

  // Vite's composite tsconfig puts paths only in tsconfig.app.json — shadcn reads tsconfig.json
  // and never finds @/* → src/*. We add the mapping to the root tsconfig to fix that.
  await writeJson(projectDir, `apps/${appName}/tsconfig.json`, {
    compilerOptions: {
      baseUrl: ".",
      paths: { "@/*": ["./src/*"] },
    },
    files: [],
    references: [{ path: "./tsconfig.app.json" }, { path: "./tsconfig.node.json" }],
  });
}

// Runs shadcn init interactively — user picks library/preset once.
export async function initShadcnInteractive(
  appDir: string,
  cssFile: string,
  pm: PackageManager = "pnpm",
): Promise<ShadcnConfig> {
  await pmDlx(pm, ["shadcn@latest", "init", "--no-monorepo"], appDir);
  const config = (await fs.readJson(join(appDir, "components.json"))) as ShadcnConfig;
  config.tailwind = { ...config.tailwind, css: cssFile };
  return config;
}

export async function initShadcnSilent(
  appDir: string,
  config: ShadcnConfig,
  cssFile: string,
  rsc: boolean,
  pm: PackageManager = "pnpm",
): Promise<void> {
  const appConfig = projectShadcnConfig(config, {
    rsc,
    tailwindCss: cssFile,
    aliases: appShadcnAliases,
  });
  await fs.writeJson(join(appDir, "components.json"), appConfig, { spaces: 2 });
  await pmDlx(pm, ["shadcn@latest", "init", "--yes", "--no-monorepo", "--force"], appDir);
}

// Promotes shadcn's generated CSS to packages/tailwind-config/globals.css and simplifies
// the app CSS to just the import. Skips the theme write if globals already has content
// (e.g. when adding an app to an existing monorepo that's already set up).
// tw-animate-css and shadcn/tailwind.css are filtered from the shared config because shadcn
// is only installed in the app that ran `shadcn init`, not in packages/tailwind-config.
async function moveThemeToGlobals(
  appCssPath: string,
  globalsCssPath: string,
  isVite: boolean,
): Promise<void> {
  const appCss = await fs.readFile(appCssPath, "utf-8");
  const existingGlobals = await fs.readFile(globalsCssPath, "utf-8");

  if (!existingGlobals.includes(":root {")) {
    const linesToSkip = new Set([
      '@import "@repo/tailwind-config/globals.css";',
      '@import "@fontsource-variable/geist";',
      '@import "shadcn/tailwind.css";',
      '@import "tw-animate-css";',
    ]);
    const themeContent = appCss
      .split("\n")
      .filter((line) => !linesToSkip.has(line.trim()))
      .join("\n")
      // shadcn sometimes comments out --color-background; uncomment all --color-* vars
      .replace(/\/\*\s*(--color-[^:]+:[^;]+;)\s*\*\//g, "$1")
      .trim();
    await fs.writeFile(
      globalsCssPath,
      `@import "tailwindcss";\n\n@source "../ui/src";\n\n${themeContent}\n`,
      "utf-8",
    );
  }

  // shadcn and tw-animate-css stay at the app level where shadcn is installed
  const newAppCss = isVite
    ? `@import "tw-animate-css";\n@import "shadcn/tailwind.css";\n@import "@repo/tailwind-config/globals.css";\n@import "@fontsource-variable/geist";\n\n:root {\n  /* Swap @fontsource-variable/geist for any @fontsource-variable/* variable font */\n  --font-geist-sans: "Geist Variable", sans-serif;\n  /* Add @fontsource-variable/geist-mono to deps to use Geist Mono */\n  --font-geist-mono: ui-monospace, "Cascadia Code", "Source Code Pro", monospace;\n}\n`
    : `@import "tw-animate-css";\n@import "shadcn/tailwind.css";\n@import "@repo/tailwind-config/globals.css";\n`;
  await fs.writeFile(appCssPath, newAppCss, "utf-8");
}

// The shared package runs shadcn itself so generated source and primitive dependencies have
// the same owner. Copying a component from an app leaves its Base/Radix/Aria dependency behind.
export async function initializeSharedUi(
  appDir: string,
  projectDir: string,
  config: ShadcnConfig,
  pm: PackageManager,
  isVite: boolean,
  useSrcDir = false,
  runShadcn = pmDlx,
  reconcileDependencies = ensureSharedUiPrimitiveDependencies,
): Promise<void> {
  const uiDir = join(projectDir, "packages/ui");
  const appCssFile = isVite
    ? "src/index.css"
    : useSrcDir
      ? "src/app/globals.css"
      : "app/globals.css";
  const appConfig = projectShadcnConfig(config, {
    rsc: !isVite,
    tailwindCss: appCssFile,
    aliases: appShadcnAliases,
  });
  const uiConfig = projectShadcnConfig(config, {
    rsc: false,
    tailwindCss: "../tailwind-config/globals.css",
    aliases: sharedUiShadcnAliases,
  });
  await fs.writeJson(join(appDir, "components.json"), appConfig, { spaces: 2 });
  await fs.writeJson(join(uiDir, "components.json"), uiConfig, { spaces: 2 });
  await runShadcn(
    pm,
    ["shadcn@latest", "add", "button", "--yes", "--overwrite"],
    uiDir,
  );
  await reconcileDependencies(projectDir, pm);

  const buttonPath = join(uiDir, "src/button.tsx");
  if (await fs.pathExists(buttonPath)) {
    const content = await fs.readFile(buttonPath, "utf-8");
    const fixed = content
      .replace(/from "src\/utils"/g, 'from "./utils"')
      .replace(/from "@[^\"]*\/utils"/g, 'from "./utils"');
    await fs.writeFile(buttonPath, fixed, "utf-8");

    const indexPath = join(uiDir, "src/index.ts");
    const indexContent = await fs.readFile(indexPath, "utf-8");
    if (!indexContent.includes("./button")) {
      await fs.appendFile(indexPath, 'export * from "./button";\n');
    }
  }

  const inSrc = isVite || useSrcDir;
  await fs.remove(join(appDir, inSrc ? "src/components/ui" : "components/ui"));
}

async function fixCssImport(cssPath: string, isVite: boolean): Promise<void> {
  const css = await fs.readFile(cssPath, "utf-8");
  const replacement = isVite
    ? `@import "@repo/tailwind-config/globals.css";\n@import "@fontsource-variable/geist";`
    : `@import "@repo/tailwind-config/globals.css";`;
  await fs.writeFile(cssPath, css.replace(`@import "tailwindcss";`, replacement), "utf-8");
}

export async function initShadcnNext(
  projectDir: string,
  appName: string,
  options: {
    shared: boolean;
    useSrcDir?: boolean;
    config?: ShadcnConfig;
    pm?: PackageManager;
  },
): Promise<ShadcnConfig> {
  const pm = options.pm ?? "pnpm";
  const appDir = join(projectDir, "apps", appName);
  const cssFile = options.useSrcDir ? "src/app/globals.css" : "app/globals.css";
  const appCssPath = join(appDir, cssFile);
  const globalsCssPath = join(projectDir, "packages/tailwind-config/globals.css");

  if (options.config) {
    await initShadcnSilent(appDir, options.config, cssFile, true, pm);
    await fixCssImport(appCssPath, false);
    if (options.shared) {
      await moveThemeToGlobals(appCssPath, globalsCssPath, false);
    }
    return options.config;
  }

  const result = await initShadcnInteractive(appDir, cssFile, pm);
  await fixCssImport(appCssPath, false);

  if (options.shared) {
    await moveThemeToGlobals(appCssPath, globalsCssPath, false);
    await initializeSharedUi(appDir, projectDir, result, pm, false, options.useSrcDir);
  }

  return result;
}

export async function initShadcnVite(
  projectDir: string,
  appName: string,
  options: {
    shared: boolean;
    config?: ShadcnConfig;
    pm?: PackageManager;
  },
): Promise<ShadcnConfig> {
  const pm = options.pm ?? "pnpm";
  const appDir = join(projectDir, "apps", appName);
  const cssFile = "src/index.css";
  const appCssPath = join(appDir, cssFile);
  const globalsCssPath = join(projectDir, "packages/tailwind-config/globals.css");

  if (options.shared && options.config) {
    await silentInitVite(appDir, projectDir, options.config, cssFile);
    return options.config;
  }

  const result = await initShadcnInteractive(appDir, cssFile, pm);
  await fixCssImport(appCssPath, true);

  if (options.shared) {
    await moveThemeToGlobals(appCssPath, globalsCssPath, true);
    await initializeSharedUi(appDir, projectDir, result, pm, true);
  } else {
    // Per-app mode: shadcn keeps its own :root block — inject the font variable into it
    const css = await fs.readFile(appCssPath, "utf-8");
    await fs.writeFile(
      appCssPath,
      css.replace(":root {", ':root {\n  /* Swap @fontsource-variable/geist for any @fontsource-variable/* variable font */\n  --font-geist-sans: "Geist Variable", sans-serif;\n  /* Add @fontsource-variable/geist-mono to deps to use Geist Mono */\n  --font-geist-mono: ui-monospace, "Cascadia Code", "Source Code Pro", monospace;'),
      "utf-8",
    );
  }

  return result;
}

// Silently wires a Vite app using config captured from the first interactive init.
// Theme already lives in globals.css at this point — just write imports and utils.
async function silentInitVite(
  appDir: string,
  projectDir: string,
  config: ShadcnConfig,
  cssFile: string,
): Promise<void> {
  await fs.writeJson(
    join(appDir, "components.json"),
    projectShadcnConfig(config, {
      rsc: false,
      tailwindCss: cssFile,
      aliases: appShadcnAliases,
    }),
    { spaces: 2 },
  );

  await fs.ensureDir(join(appDir, "src/lib"));
  await fs.copy(join(projectDir, "packages/ui/src/utils.ts"), join(appDir, "src/lib/utils.ts"));

  await fs.writeFile(
    join(appDir, cssFile),
    `@import "@repo/tailwind-config/globals.css";\n@import "@fontsource-variable/geist";\n\n:root {\n  /* Swap @fontsource-variable/geist for any @fontsource-variable/* variable font */\n  --font-geist-sans: "Geist Variable", sans-serif;\n  /* Add @fontsource-variable/geist-mono to deps to use Geist Mono */\n  --font-geist-mono: ui-monospace, "Cascadia Code", "Source Code Pro", monospace;\n}\n`,
    "utf-8",
  );
}

// Wires a Next.js app into an existing shared shadcn setup without running shadcn init.
// The theme is already in packages/tailwind-config — just write components.json and CSS.
export async function wireNextToSharedShadcn(
  projectDir: string,
  appName: string,
  existingConfig: ShadcnConfig,
  useSrcDir = false,
): Promise<void> {
  const appDir = join(projectDir, "apps", appName);
  const cssFile = useSrcDir ? "src/app/globals.css" : "app/globals.css";
  const appCssPath = join(appDir, cssFile);

  await fs.writeJson(
    join(appDir, "components.json"),
    projectShadcnConfig(existingConfig, {
      rsc: true,
      tailwindCss: cssFile,
      aliases: appShadcnAliases,
    }),
    { spaces: 2 },
  );

  const appLibDir = join(appDir, useSrcDir ? "src/lib" : "lib");
  await fs.ensureDir(appLibDir);
  await fs.copy(join(projectDir, "packages/ui/src/utils.ts"), join(appLibDir, "utils.ts"));

  // shadcn and tw-animate-css must be in the app's deps for their CSS imports to resolve
  await mergeJson(projectDir, `apps/${appName}/package.json`, {
    dependencies: {
      shadcn: "latest",
      "tw-animate-css": "latest",
    },
  });

  await fs.writeFile(
    appCssPath,
    `@import "tw-animate-css";\n@import "shadcn/tailwind.css";\n@import "@repo/tailwind-config/globals.css";\n`,
    "utf-8",
  );
}

// Wires a Vite app into an existing shared shadcn setup without running shadcn init.
// Used by `add` when the monorepo already has the theme in packages/tailwind-config.
export async function wireViteToSharedShadcn(
  projectDir: string,
  appName: string,
): Promise<void> {
  const appDir = join(projectDir, "apps", appName);

  // Copy the cn utility from the shared ui package
  await fs.ensureDir(join(appDir, "src/lib"));
  await fs.copy(join(projectDir, "packages/ui/src/utils.ts"), join(appDir, "src/lib/utils.ts"));

  // Read existing config from packages/ui so components.json is consistent
  const uiConfig = (await fs
    .readJson(join(projectDir, "packages/ui/components.json"))
    .catch(() => null)) as ShadcnConfig | null;
  if (uiConfig) {
    await fs.writeJson(
      join(appDir, "components.json"),
      projectShadcnConfig(uiConfig, {
        rsc: false,
        tailwindCss: "src/index.css",
        aliases: appShadcnAliases,
      }),
      { spaces: 2 },
    );
  }

  // Theme is already in shared globals — just wire up the CSS imports
  await fs.writeFile(
    join(appDir, "src/index.css"),
    `@import "@repo/tailwind-config/globals.css";\n@import "@fontsource-variable/geist";\n\n:root {\n  /* Swap @fontsource-variable/geist for any @fontsource-variable/* variable font */\n  --font-geist-sans: "Geist Variable", sans-serif;\n  /* Add @fontsource-variable/geist-mono to deps to use Geist Mono */\n  --font-geist-mono: ui-monospace, "Cascadia Code", "Source Code Pro", monospace;\n}\n`,
    "utf-8",
  );
}

// Adds workspace:* deps after shadcn init to avoid pnpm v10 resolution failures.
export async function addWorkspaceDeps(
  projectDir: string,
  appName: string,
  type: "next" | "vite",
  pm: PackageManager,
): Promise<void> {
  const w = workspaceDep(pm);
  if (type === "next") {
    await mergeJson(projectDir, `apps/${appName}/package.json`, {
      dependencies: { "@repo/ui": w },
      devDependencies: {
        "@repo/tailwind-config": w,
        // eslint-config wired here so it resolves after shadcn init
        "@repo/eslint-config": w,
      },
    });
  } else {
    await mergeJson(projectDir, `apps/${appName}/package.json`, {
      dependencies: { "@repo/ui": w },
      devDependencies: {
        "@repo/tailwind-config": w,
        "@repo/typescript-config": w,
        "@repo/eslint-config": w,
      },
    });
  }
}

export async function wireNextCss(
  projectDir: string,
  appName: string,
  useSrcDir = false,
): Promise<void> {
  const cssPath = useSrcDir
    ? `apps/${appName}/src/app/globals.css`
    : `apps/${appName}/app/globals.css`;
  await replaceInFile(
    projectDir,
    cssPath,
    `@import "tailwindcss";`,
    `@import "@repo/tailwind-config/globals.css";`,
  );
}

export async function wireViteCss(
  projectDir: string,
  appName: string,
): Promise<void> {
  await writeFile(
    projectDir,
    `apps/${appName}/src/index.css`,
    `@import "@repo/tailwind-config/globals.css";\n@import "@fontsource-variable/geist";\n\n:root {\n  /* Swap @fontsource-variable/geist for any @fontsource-variable/* variable font */\n  --font-geist-sans: "Geist Variable", sans-serif;\n  /* Add @fontsource-variable/geist-mono to deps to use Geist Mono */\n  --font-geist-mono: ui-monospace, "Cascadia Code", "Source Code Pro", monospace;\n}\n`,
  );
}

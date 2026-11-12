import { join } from "path";
import fs from "fs-extra";

import { addMissingPackageScripts } from "./package-json.js";

const VITEST_CONFIG_NAMES = [
  "vitest.config.ts",
  "vitest.config.js",
  "vitest.config.mts",
  "vitest.config.mjs",
  "vitest.config.cts",
  "vitest.config.cjs",
];

const VITE_CONFIG_NAMES = [
  "vite.config.ts",
  "vite.config.js",
  "vite.config.mts",
  "vite.config.mjs",
  "vite.config.cts",
  "vite.config.cjs",
];

const IGNORED_TEST_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".turbo",
  "coverage",
  "dist",
  "e2e",
  "node_modules",
  "playwright-report",
  "test-results",
]);

export const VITEST_DEV_DEPENDENCIES = {
  "@testing-library/jest-dom": "^6.0.0",
  "@testing-library/react": "^16.0.0",
  "@vitejs/plugin-react": "^5.0.0",
  "@vitest/coverage-v8": "^3.0.0",
  jsdom: "^26.0.0",
  "vite-tsconfig-paths": "^5.0.0",
  vitest: "^3.0.0",
};

export const VITEST_PACKAGES = Object.keys(VITEST_DEV_DEPENDENCIES);

interface PackageJsonLike {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export function getVitestPackageSpecs(
  pkg: PackageJsonLike,
  packages: string[] = VITEST_PACKAGES,
): string[] {
  const installed = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
  };
  const vitestVersion = installed.vitest ?? VITEST_DEV_DEPENDENCIES.vitest;

  return packages.flatMap((packageName) => {
    if (packageName === "@vitest/coverage-v8") {
      return installed[packageName] === vitestVersion
        ? []
        : [`${packageName}@${vitestVersion}`];
    }

    if (installed[packageName]) return [];

    const version = VITEST_DEV_DEPENDENCIES[
      packageName as keyof typeof VITEST_DEV_DEPENDENCIES
    ];
    return version ? [`${packageName}@${version}`] : [packageName];
  });
}

export function createVitestConfig(setupFile: string): string {
  return `import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: "jsdom",
    exclude: [...configDefaults.exclude, "tests/e2e/**"],
    globals: true,
    setupFiles: ["${setupFile}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
});
`;
}

export async function hasVitestSetup(workspaceDir: string): Promise<boolean> {
  const pkg = await fs.readJson(join(workspaceDir, "package.json")).catch(() => ({}));
  if ((pkg.scripts?.test as string | undefined)?.includes("vitest")) return true;

  const checks = await Promise.all(
    VITEST_CONFIG_NAMES.map((configName) => fs.pathExists(join(workspaceDir, configName))),
  );
  if (checks.some(Boolean)) return true;

  for (const configName of VITE_CONFIG_NAMES) {
    const content = await fs.readFile(join(workspaceDir, configName), "utf-8").catch(() => "");
    if (/\btest\s*:/.test(content) || content.includes('from "vitest/config"')) return true;
  }

  return false;
}

export async function hasTestFiles(workspaceDir: string): Promise<boolean> {
  return findTestFile(workspaceDir);
}

export async function ensureVitestSample(workspaceDir: string): Promise<boolean> {
  if (await hasTestFiles(workspaceDir)) return false;

  const testDir = await getTestDirectory(workspaceDir);
  await fs.ensureDir(testDir);
  await fs.writeFile(join(testDir, "example.test.ts"), sampleTest, "utf-8");
  return true;
}

export async function writeVitestSetup(workspaceDir: string): Promise<{
  configCreated: boolean;
  sampleCreated: boolean;
}> {
  const testDir = await getTestDirectory(workspaceDir);
  const relativeTestDir = (await fs.pathExists(join(workspaceDir, "src"))) ? "src/test" : "test";
  const configPath = join(workspaceDir, "vitest.config.ts");
  const setupPath = join(testDir, "setup.ts");
  const configCreated = !(await fs.pathExists(configPath));

  await fs.ensureDir(testDir);
  if (configCreated) {
    await fs.writeFile(
      configPath,
      createVitestConfig(`./${relativeTestDir}/setup.ts`),
      "utf-8",
    );
  }
  if (!(await fs.pathExists(setupPath))) {
    await fs.writeFile(setupPath, 'import "@testing-library/jest-dom/vitest";\n', "utf-8");
  }

  const sampleCreated = await ensureVitestSample(workspaceDir);
  await addMissingPackageScripts(workspaceDir, {
    test: "vitest run",
    "test:coverage": "vitest run --coverage",
    "test:watch": "vitest",
  });

  return { configCreated, sampleCreated };
}

async function getTestDirectory(workspaceDir: string): Promise<string> {
  const sourceDir = (await fs.pathExists(join(workspaceDir, "src"))) ? "src" : ".";
  return join(workspaceDir, sourceDir, "test");
}

async function findTestFile(directory: string): Promise<boolean> {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_TEST_DIRECTORIES.has(entry.name)) continue;
      if (await findTestFile(join(directory, entry.name))) return true;
      continue;
    }

    if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) return true;
  }

  return false;
}

const sampleTest = `import { describe, expect, it } from "vitest";

describe("test setup", () => {
  it("runs Vitest", () => {
    expect(true).toBe(true);
  });
});
`;

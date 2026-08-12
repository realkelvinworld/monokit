import { join } from "node:path";
import fs from "fs-extra";

import { readMonokitConfig } from "./monokit-config.js";
import {
  findShadcnConfigDrift,
  findShadcnPrimitiveDependencyDrift,
  inferShadcnPrimitive,
  inferShadcnPrimitiveFromPackageName,
  type ShadcnConfig,
  type ShadcnPrimitive,
} from "./shadcn-config.js";

export interface SharedShadcnIssue {
  appName: string;
  fields: string[];
}

export interface SharedUiPrimitiveImportAudit {
  expected: ShadcnPrimitive;
  importedPrimitives: Array<Exclude<ShadcnPrimitive, "unknown">>;
  mismatchedPackages: string[];
  missingPackages: string[];
  mixed: boolean;
}

async function listSourceFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return listSourceFiles(path);
      return /\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : [];
    }),
  );
  return files.flat();
}

function dependencyPackageName(specifier: string): string {
  if (specifier.startsWith("@base-ui/react")) return "@base-ui/react";
  if (specifier.startsWith("@radix-ui/")) return specifier.split("/").slice(0, 2).join("/");
  if (specifier.startsWith("radix-ui")) return "radix-ui";
  return "react-aria-components";
}

export async function readSharedShadcnConfig(
  projectDir: string,
): Promise<ShadcnConfig | null> {
  return fs
    .readJson(join(projectDir, "packages/ui/components.json"))
    .catch(() => null) as Promise<ShadcnConfig | null>;
}

export async function findSharedShadcnIssues(
  projectDir: string,
): Promise<SharedShadcnIssue[]> {
  const projectConfig = await readMonokitConfig(projectDir);
  if (!projectConfig) return [];

  const sharedApps = Object.entries(projectConfig.shadcn.apps)
    .filter(([, mode]) => mode === "shared")
    .map(([appName]) => appName);
  if (sharedApps.length === 0) return [];

  const canonical = await readSharedShadcnConfig(projectDir);
  if (!canonical) {
    return sharedApps.map((appName) => ({
      appName,
      fields: ["packages/ui/components.json"],
    }));
  }

  const issues: SharedShadcnIssue[] = [];
  for (const appName of sharedApps) {
    const appConfig = (await fs
      .readJson(join(projectDir, "apps", appName, "components.json"))
      .catch(() => null)) as ShadcnConfig | null;
    const fields = appConfig
      ? findShadcnConfigDrift(canonical, appConfig)
      : ["components.json"];
    if (fields.length > 0) issues.push({ appName, fields });
  }

  return issues;
}

export async function findSharedUiPrimitiveIssues(projectDir: string): Promise<string[]> {
  const canonical = await readSharedShadcnConfig(projectDir);
  if (!canonical) return [];

  const packageJson = (await fs
    .readJson(join(projectDir, "packages/ui/package.json"))
    .catch(() => null)) as Record<string, unknown> | null;
  if (!packageJson) return [];

  return findShadcnPrimitiveDependencyDrift(canonical, packageJson);
}

export async function inspectSharedUiPrimitiveImports(
  projectDir: string,
): Promise<SharedUiPrimitiveImportAudit> {
  const canonical = await readSharedShadcnConfig(projectDir);
  const expected = inferShadcnPrimitive(canonical?.style);
  const packageJson = (await fs
    .readJson(join(projectDir, "packages/ui/package.json"))
    .catch(() => ({}))) as Record<string, unknown>;
  const declaredPackages = new Set(
    ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].flatMap(
      (field) => {
        const dependencies = packageJson[field];
        return dependencies && typeof dependencies === "object" && !Array.isArray(dependencies)
          ? Object.keys(dependencies)
          : [];
      },
    ),
  );

  const importedPackages = new Map<string, Exclude<ShadcnPrimitive, "unknown">>();
  for (const file of await listSourceFiles(join(projectDir, "packages/ui/src"))) {
    const content = await fs.readFile(file, "utf-8");
    const importPattern = /(?:from\s+|import\s+)["']([^"']+)["']/g;
    for (const match of content.matchAll(importPattern)) {
      const specifier = match[1];
      if (!specifier) continue;
      const primitive = inferShadcnPrimitiveFromPackageName(specifier);
      if (primitive) importedPackages.set(dependencyPackageName(specifier), primitive);
    }
  }

  const importedPrimitives = [...new Set(importedPackages.values())].sort();
  const mismatchedPackages = [...importedPackages]
    .filter(([, primitive]) => expected !== "unknown" && primitive !== expected)
    .map(([packageName]) => packageName)
    .sort();
  const missingPackages = [...importedPackages.keys()]
    .filter((packageName) => !declaredPackages.has(packageName))
    .sort();

  return {
    expected,
    importedPrimitives,
    mismatchedPackages,
    missingPackages,
    mixed: importedPrimitives.length > 1,
  };
}

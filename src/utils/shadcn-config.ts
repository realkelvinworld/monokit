import { isDeepStrictEqual } from "node:util";

export type ShadcnPrimitive = "aria" | "base" | "radix" | "unknown";

export interface ShadcnConfig {
  $schema?: string;
  style?: string;
  rsc?: boolean;
  tsx?: boolean;
  tailwind?: Record<string, unknown>;
  iconLibrary?: string;
  aliases?: Record<string, string>;
  rtl?: boolean;
  menuColor?: string;
  menuAccent?: string;
  registries?: unknown;
  [key: string]: unknown;
}

const synchronizedDesignFields = [
  "style",
  "iconLibrary",
  "tailwind.baseColor",
  "tailwind.cssVariables",
  "tailwind.prefix",
  "rtl",
  "menuColor",
  "menuAccent",
  "registries",
] as const;

function readPath(config: ShadcnConfig, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => {
    if (!value || typeof value !== "object") return undefined;
    return (value as Record<string, unknown>)[key];
  }, config);
}

export function findShadcnConfigDrift(
  canonical: ShadcnConfig,
  candidate: ShadcnConfig,
): string[] {
  return synchronizedDesignFields.filter(
    (field) => !isDeepStrictEqual(readPath(canonical, field), readPath(candidate, field)),
  );
}

export function inferShadcnPrimitive(style: unknown): ShadcnPrimitive {
  if (typeof style !== "string") return "unknown";
  if (style.startsWith("base-")) return "base";
  if (style.startsWith("radix-")) return "radix";
  if (style.startsWith("aria-")) return "aria";
  if (style === "new-york" || style === "default") return "radix";
  return "unknown";
}

export function inferShadcnPrimitiveFromPackageName(
  packageName: string,
): Exclude<ShadcnPrimitive, "unknown"> | null {
  if (packageName === "@base-ui/react" || packageName.startsWith("@base-ui/react/")) return "base";
  if (
    packageName === "radix-ui" ||
    packageName.startsWith("radix-ui/") ||
    packageName.startsWith("@radix-ui/")
  ) {
    return "radix";
  }
  if (
    packageName === "react-aria-components" ||
    packageName.startsWith("react-aria-components/")
  ) {
    return "aria";
  }
  return null;
}

function dependencyEntries(packageJson: Record<string, unknown>): Array<[string, unknown]> {
  return ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].flatMap(
    (field) => {
      const dependencies = packageJson[field];
      if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) {
        return [];
      }
      return Object.entries(dependencies);
    },
  );
}

export function findShadcnPrimitiveDependencyDrift(
  config: ShadcnConfig,
  packageJson: Record<string, unknown>,
): string[] {
  const expected = inferShadcnPrimitive(config.style);
  if (expected === "unknown") return [];

  return dependencyEntries(packageJson)
    .filter(([packageName]) => {
      const primitive = inferShadcnPrimitiveFromPackageName(packageName);
      return primitive !== null && primitive !== expected;
    })
    .map(([packageName]) => packageName)
    .sort();
}

export function listShadcnPrimitiveDependencies(
  packageJson: Record<string, unknown>,
): string[] {
  return [
    ...new Set(
      dependencyEntries(packageJson)
        .map(([packageName]) => packageName)
        .filter((packageName) => inferShadcnPrimitiveFromPackageName(packageName) !== null),
    ),
  ].sort();
}

export function stripShadcnPrimitiveDependencies(
  packageJson: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...packageJson };

  for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    const dependencies = packageJson[field];
    if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) continue;

    result[field] = Object.fromEntries(
      Object.entries(dependencies).filter(
        ([packageName]) => inferShadcnPrimitiveFromPackageName(packageName) === null,
      ),
    );
  }

  return result;
}

interface ShadcnWorkspaceProjection {
  rsc: boolean;
  tailwindCss: string;
  tailwindConfig?: string;
  aliases: Record<string, string>;
}

export function projectShadcnConfig(
  source: ShadcnConfig,
  workspace: ShadcnWorkspaceProjection,
): ShadcnConfig {
  return {
    ...source,
    rsc: workspace.rsc,
    tsx: true,
    tailwind: {
      ...source.tailwind,
      config: workspace.tailwindConfig ?? source.tailwind?.config ?? "",
      css: workspace.tailwindCss,
    },
    aliases: { ...workspace.aliases },
  };
}

import { join } from "node:path";

export function getShadcnAddArgs(componentName: string, overwrite: boolean): string[] {
  return [
    "shadcn@latest",
    "add",
    componentName,
    "--yes",
    ...(overwrite ? ["--overwrite"] : []),
  ];
}

export function getAppComponentCandidates(appDir: string, componentName: string): string[] {
  return [
    join(appDir, "components/ui", `${componentName}.tsx`),
    join(appDir, "src/components/ui", `${componentName}.tsx`),
  ];
}

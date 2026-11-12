import { join } from "path";
import fs from "fs-extra";

import { getWorkspaceNameError } from "./workspace-name.js";

export type TestingWorkspace = {
  dir: string;
  label: string;
  name: string;
  packageName: string;
  type: "app" | "shared";
};

export type TestingTargetOptions = {
  all: boolean;
  appName?: string;
  passthrough: string[];
  shared: boolean;
};

export function parseTestingTargetArgs(args: string[]): TestingTargetOptions {
  const options: TestingTargetOptions = {
    all: false,
    passthrough: [],
    shared: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;

    if (arg === "--") {
      options.passthrough.push(...args.slice(index + 1));
      break;
    }

    if (arg === "--app") {
      const appName = args[index + 1];
      if (!appName || appName.startsWith("-")) {
        throw new Error("--app requires an app name.");
      }
      options.appName = appName;
      index += 1;
      continue;
    }

    if (arg === "--shared") {
      options.shared = true;
      continue;
    }

    if (arg === "--all") {
      options.all = true;
      continue;
    }

    options.passthrough.push(arg);
  }

  const targetCount =
    Number(Boolean(options.appName)) + Number(options.shared) + Number(options.all);
  if (targetCount > 1) {
    throw new Error("Choose only one target: --app, --shared, or --all.");
  }

  if (options.appName) {
    const nameError = getWorkspaceNameError(options.appName);
    if (nameError) throw new Error(`Invalid app name. ${nameError}.`);
  }

  return options;
}

export async function listTestingWorkspaces(
  projectDir: string,
  includeShared = true,
): Promise<TestingWorkspace[]> {
  const workspaces: TestingWorkspace[] = [];
  const appsDir = join(projectDir, "apps");
  const entries = await fs.readdir(appsDir, { withFileTypes: true }).catch(() => []);

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const workspace = await readWorkspace(
      join(appsDir, entry.name),
      `apps/${entry.name}`,
      "app",
    );
    if (workspace) workspaces.push(workspace);
  }

  if (includeShared) {
    const shared = await readWorkspace(
      join(projectDir, "packages/ui"),
      "packages/ui",
      "shared",
    );
    if (shared) workspaces.push(shared);
  }

  return workspaces;
}

export function findTestingWorkspace(
  workspaces: TestingWorkspace[],
  options: Pick<TestingTargetOptions, "appName" | "shared">,
): TestingWorkspace | undefined {
  if (options.shared) return workspaces.find((workspace) => workspace.type === "shared");
  if (options.appName) {
    return workspaces.find(
      (workspace) => workspace.type === "app" && workspace.name === options.appName,
    );
  }
  return undefined;
}

async function readWorkspace(
  dir: string,
  label: string,
  type: TestingWorkspace["type"],
): Promise<TestingWorkspace | undefined> {
  const pkg = await fs.readJson(join(dir, "package.json")).catch(() => null);
  if (!pkg) return undefined;

  const name = type === "shared" ? "ui" : label.slice("apps/".length);
  return {
    dir,
    label,
    name,
    packageName: (pkg.name as string | undefined) ?? name,
    type,
  };
}

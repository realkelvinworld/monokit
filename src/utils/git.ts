import { execa } from "execa";
import { dirname, join, resolve } from "path";
import fs from "fs-extra";

type GitInitializationResult =
  | { initialized: true; warning?: never }
  | { initialized: false; warning: string };

export async function initializeGitRepository(
  projectDir: string,
): Promise<GitInitializationResult> {
  try {
    await execa("git", ["init", "-b", "main"], { cwd: projectDir });
    return { initialized: true };
  } catch {
    return {
      initialized: false,
      warning: "Git repository was not initialized. From the project root, run: git init -b main",
    };
  }
}

function resolveGeneratedAppDirectory(projectDir: string, appName: string): string {
  const appsDir = resolve(projectDir, "apps");
  const appDir = resolve(appsDir, appName);

  if (dirname(appDir) !== appsDir) {
    throw new Error("Generated apps must stay inside the apps directory.");
  }

  return appDir;
}

export async function assertGeneratedAppTargetAvailable(
  projectDir: string,
  appName: string,
): Promise<string> {
  const appDir = resolveGeneratedAppDirectory(projectDir, appName);
  if (await fs.pathExists(appDir)) {
    throw new Error(`Cannot create apps/${appName}: that directory already exists.`);
  }

  return appDir;
}

export async function removeGeneratedAppGitMetadata(
  projectDir: string,
  appName: string,
): Promise<void> {
  const appDir = resolveGeneratedAppDirectory(projectDir, appName);
  await fs.remove(join(appDir, ".git"));
}

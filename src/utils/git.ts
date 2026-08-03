import { execa } from "execa";
import { join } from "path";
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

export async function removeGeneratedAppGitMetadata(appDir: string): Promise<void> {
  await fs.remove(join(appDir, ".git"));
}

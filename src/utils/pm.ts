import { execa } from "execa";
import fs from "fs-extra";
import { join, relative } from "path";

import { run, runNonInteractive } from "./exec.js";

export type PackageManager = "pnpm" | "npm" | "yarn" | "bun";

export function detectPackageManager(): PackageManager {
  const agent = process.env.npm_config_user_agent ?? "";
  if (agent.startsWith("pnpm")) return "pnpm";
  if (agent.startsWith("yarn")) return "yarn";
  if (agent.startsWith("bun")) return "bun";
  return "npm";
}

// Reads the "packageManager" field from the project's package.json (e.g. "bun@1.2.21" → "bun").
// Used by `monokit app/add` so the CLI always uses the PM the project was scaffolded with,
// regardless of which PM the user ran this CLI with.
export async function detectProjectPackageManager(cwd: string): Promise<PackageManager> {
  try {
    const pkg = await fs.readJson(join(cwd, "package.json"));
    const field = pkg.packageManager as string | undefined;
    if (field) {
      const name = field.split("@")[0] as PackageManager;
      if (["pnpm", "npm", "yarn", "bun"].includes(name)) return name;
    }
  } catch {
    // fall through to env detection
  }
  return detectPackageManager();
}

// Returns the "packageManager" field value for package.json (required by Turbo v2).
// Turbo requires the exact format: pm@X.X.X
// Tries npm_config_user_agent first (fast), falls back to running `pm --version` if the
// invoked PM differs from the chosen one (e.g. user picks bun but ran via pnpm dlx).
export async function detectPackageManagerField(pm: PackageManager): Promise<string> {
  const agent = process.env.npm_config_user_agent ?? "";
  const match = agent.match(/^(\w+)\/([\d.]+)/);
  if (match && match[1] === pm) return `${pm}@${match[2]}`;

  try {
    const { stdout } = await execa(pm, ["--version"]);
    return `${pm}@${stdout.trim()}`;
  } catch {
    return `${pm}@0.0.0`;
  }
}

export function pmInstall(pm: PackageManager, cwd: string): Promise<void> {
  return run(pm, ["install"], cwd);
}

// pnpm dlx / npx / yarn dlx / bunx
// yarn v1 has no dlx command — npx is universally available and works for all yarn versions
export function pmDlx(pm: PackageManager, pkg: string[], cwd: string): Promise<void> {
  if (pm === "pnpm") return run("pnpm", ["dlx", ...pkg], cwd);
  if (pm === "bun") return run("bunx", pkg, cwd);
  return run("npx", pkg, cwd); // npm and yarn (all versions)
}

// Yarn v1 create doesn't accept @version in the package name (e.g. "next-app@latest" →
// tries to find binary "create-next-app@latest" which doesn't exist). Strip it for yarn.
function yarnSafeTemplate(template: string[]): string[] {
  return [template[0]!.replace(/@(latest|\d[\d.]*)$/, ""), ...template.slice(1)];
}

// npm create parses flags as npm config before passing them to the package.
// Using npx --yes create-<pkg> directly bypasses this and auto-confirms the install prompt.
// "next-app@latest" → "create-next-app@latest", "vite@latest" → "create-vite@latest"
function npmNpxArgs(template: string[]): string[] {
  const [pkg, ...rest] = template;
  return ["--yes", `create-${pkg!}`, ...rest];
}

// pnpm create / npm (npx) / yarn create / bun create
export function pmCreate(pm: PackageManager, template: string[], cwd: string): Promise<void> {
  if (pm === "npm") return run("npx", npmNpxArgs(template), cwd);
  if (pm === "yarn") return run("yarn", ["create", ...yarnSafeTemplate(template)], cwd);
  if (pm === "bun") return run("bun", ["create", ...template], cwd);
  return run("pnpm", ["create", ...template], cwd);
}

// Non-interactive variant for vite (suppresses project-name prompt)
export function pmCreateNonInteractive(pm: PackageManager, template: string[], cwd: string): Promise<void> {
  if (pm === "npm") return runNonInteractive("npx", npmNpxArgs(template), cwd);
  if (pm === "yarn") return runNonInteractive("yarn", ["create", ...yarnSafeTemplate(template)], cwd);
  if (pm === "bun") return runNonInteractive("bun", ["create", ...template], cwd);
  return runNonInteractive("pnpm", ["create", ...template], cwd);
}

// workspace:* protocol is only supported by pnpm and bun.
// yarn v1 does NOT understand "workspace:" prefix — it hits the npm registry and fails.
// yarn v2+ and npm resolve plain "*" from the workspace when the package name matches,
// which is the same pattern used by Turborepo's own create-turbo for these PMs.
export function workspaceDep(pm: PackageManager): string {
  return pm === "pnpm" || pm === "bun" ? "workspace:*" : "*";
}

export function pmRunScript(pm: PackageManager): string {
  return pm === "npm" ? "npm run" : pm;
}

export function pmScriptCommand(
  pm: PackageManager,
  script: string,
  args: string[] = [],
): { command: string; args: string[] } {
  if (pm === "npm" || pm === "pnpm" || pm === "bun") {
    return {
      command: pm,
      args: ["run", script, ...(args.length > 0 ? ["--", ...args] : [])],
    };
  }

  return { command: "yarn", args: ["run", script, ...args] };
}

export function pmBinaryCommand(
  pm: PackageManager,
  binary: string,
  args: string[] = [],
): { command: string; args: string[] } {
  if (pm === "pnpm") return { command: "pnpm", args: ["exec", binary, ...args] };
  if (pm === "bun") return { command: "bunx", args: [binary, ...args] };
  if (pm === "yarn") return { command: "yarn", args: [binary, ...args] };
  return { command: "npm", args: ["exec", "--", binary, ...args] };
}

export async function pmAddWorkspaceDevDependencies(
  pm: PackageManager,
  packages: string[],
  targetDir: string,
  projectDir: string,
): Promise<void> {
  if (packages.length === 0) return;

  if (pm === "pnpm") {
    await run(
      "pnpm",
      ["add", "-D", ...packages, `--filter=./${relative(projectDir, targetDir)}`],
      projectDir,
    );
    return;
  }

  if (pm === "bun") {
    await run("bun", ["add", "-D", ...packages], targetDir);
    return;
  }

  if (pm === "yarn") {
    const pkg = await fs.readJson(join(targetDir, "package.json"));
    const workspaceName = pkg.name as string | undefined;
    if (!workspaceName) {
      throw new Error(
        `Missing package name in ${relative(projectDir, targetDir)}/package.json.`,
      );
    }
    await run("yarn", ["workspace", workspaceName, "add", "-D", ...packages], projectDir);
    return;
  }

  await run(
    "npm",
    ["install", "-D", ...packages, "-w", relative(projectDir, targetDir)],
    projectDir,
  );
}

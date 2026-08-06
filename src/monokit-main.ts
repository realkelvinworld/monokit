import { fileURLToPath } from "url";
import { dirname, join } from "path";
import fs from "fs-extra";
import pc from "picocolors";

import { add } from "./add.js";
import { addComponent } from "./add-component.js";
import { doctor } from "./doctor.js";
import { install } from "./install.js";
import { list } from "./list.js";
import { removeComponent } from "./remove-component.js";
import { uninstall } from "./uninstall.js";
import { update } from "./update.js";
import { isMonorepo } from "./utils/detect.js";

const [, , command, ...rest] = process.argv;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function getVersion(): Promise<string> {
  const pkg = await fs.readJson(join(__dirname, "../package.json")).catch(() => ({}));
  return (pkg.version as string | undefined) ?? "0.0.0";
}

function printHelp(version: string): void {
  console.log(`
${pc.bold("monokit")} ${pc.dim(`v${version}`)}  ${pc.dim("—")}  Turborepo monorepo toolkit

${pc.bold("Usage")}
  monokit <command> [options]

${pc.bold("Commands")}
  ${pc.cyan("app")}                      Add a new app to the monorepo
  ${pc.cyan("add")} <component>          Add a shadcn/ui component to shared or an app
  ${pc.cyan("remove")} <component>       Remove a shadcn/ui component
  ${pc.cyan("install")} [package]        Install an npm package into any workspace
  ${pc.cyan("uninstall")} [package]      Remove an npm package from any workspace
  ${pc.cyan("update")} [package]         Update an npm package to latest (or a specific version)
  ${pc.cyan("list")}                     List all apps and packages in the monorepo
  ${pc.cyan("doctor")}                   Check monorepo health (--fix to auto-fix, --types for TypeScript)

${pc.bold("Options")}
  ${pc.cyan("-h")}, ${pc.cyan("--help")}             Show this help message
  ${pc.cyan("-v")}, ${pc.cyan("--version")}          Show version number

${pc.bold("Examples")}
  ${pc.dim("$")} monokit app
  ${pc.dim("$")} monokit add button --shared
  ${pc.dim("$")} monokit remove button --shared
  ${pc.dim("$")} monokit install lucide-react
  ${pc.dim("$")} monokit uninstall lucide-react
  ${pc.dim("$")} monokit update zod
  ${pc.dim("$")} monokit update zod@3.22.0
  ${pc.dim("$")} monokit list
  ${pc.dim("$")} monokit doctor --fix
  ${pc.dim("$")} monokit doctor --types
`);
}

export async function runMonokit(): Promise<void> {
  const cwd = process.cwd();

  // Handle global flags before any monorepo check
  if (!command || command === "--help" || command === "-h" || rest.includes("--help") || rest.includes("-h")) {
    const version = await getVersion();
    printHelp(version);
    return;
  }

  if (command === "--version" || command === "-v") {
    const version = await getVersion();
    console.log(`monokit v${version}`);
    return;
  }

  if (!isMonorepo(cwd)) {
    console.error(pc.red("No monorepo detected.") + " Run this command from your project root.");
    console.error(pc.dim('Hint: use "pnpm dlx monokit-cli" to scaffold a new monorepo.'));
    process.exit(1);
  }

  if (command === "app") {
    await add(cwd);
    return;
  }

  if (command === "add") {
    await addComponent(cwd, rest);
    return;
  }

  if (command === "install") {
    await install(cwd, rest);
    return;
  }

  if (command === "remove") {
    await removeComponent(cwd, rest);
    return;
  }

  if (command === "uninstall") {
    await uninstall(cwd, rest);
    return;
  }

  if (command === "update") {
    await update(cwd, rest);
    return;
  }

  if (command === "list") {
    await list(cwd);
    return;
  }

  if (command === "doctor") {
    await doctor(cwd, { checkTypes: rest.includes("--types"), fix: rest.includes("--fix") });
    return;
  }

  // Unknown command — show help
  console.error(pc.red(`Unknown command: ${command}\n`));
  const version = await getVersion();
  printHelp(version);
  process.exit(1);
}

<div align="center">

# Monokit

**An opinionated CLI for creating and maintaining Turborepo monorepos.**

Build with Next.js, Vite + React, Tailwind CSS v4, and your choice of shared or per-app shadcn/ui—without wiring every workspace by hand.

[![npm version](https://img.shields.io/npm/v/monokit-cli?style=flat-square&color=CB3837)](https://www.npmjs.com/package/monokit-cli)
[![npm downloads](https://img.shields.io/npm/dm/monokit-cli?style=flat-square&color=3178C6)](https://www.npmjs.com/package/monokit-cli)
[![Node.js requirement](https://img.shields.io/node/v/monokit-cli?style=flat-square&color=339933)](https://nodejs.org/)
[![license](https://img.shields.io/npm/l/monokit-cli?style=flat-square&color=111827)](https://www.npmjs.com/package/monokit-cli)

</div>

## Quick start

> Monokit requires **Node.js 22.12.0 or newer**.

Run the scaffolder with your preferred launcher:

```bash
pnpm dlx monokit-cli

# or
npx monokit-cli

# or
bunx monokit-cli
```

The interactive setup asks you to choose:

- A package manager: pnpm, npm, yarn, or Bun
- A project name
- Next.js, Vite + React, or both
- App names and whether Next.js should use a `src/` directory
- Shared shadcn/ui, per-app shadcn/ui, or no shadcn initialization

Monokit then creates the workspace, installs dependencies, wires the apps to the shared packages, and initializes one root Git repository.

If you run the `monokit-cli` launcher from an existing Monokit repository, it opens the add-app flow instead of creating another repository.

## What Monokit supports

| Area | Released behavior |
| --- | --- |
| Frameworks | Next.js App Router, Vite + React, or both |
| Styling | Tailwind CSS v4 through a shared `@repo/tailwind-config` package |
| shadcn/ui | Shared design system, per-app setup, or no initialization |
| Components | Add or remove a component from `packages/ui` or a selected app |
| Dependencies | Install, uninstall, or update packages in the root, `packages/ui`, or a selected app |
| Package managers | pnpm, npm, yarn, and Bun |
| Git | One root repository on `main`; no automatic staging, commit, remote, or push |
| Health checks | Workspace, configuration, component, app, and optional TypeScript checks |
| Runtime | Node.js 22.12.0 or newer |

Monokit is intentionally focused. It is a good fit when you want an opinionated TypeScript monorepo with shared tooling and optional shadcn/ui workflows. If you want an unconfigured Turborepo or use a different ecosystem, [`create-turbo`](https://www.npmjs.com/package/create-turbo) may be a better starting point.

## What gets generated

A project containing both supported app types follows this shape:

```text
my-monorepo/
├── .git/                         # One repository for the whole monorepo
├── .vscode/
│   └── settings.json             # Tailwind CSS editor configuration
├── apps/
│   ├── web/                      # Next.js App Router
│   └── dashboard/                # Vite + React
├── packages/
│   ├── ui/                       # Shared UI package and shadcn config
│   ├── tailwind-config/          # Shared Tailwind v4 CSS
│   ├── typescript-config/        # Base, Next.js, React library, and Vite presets
│   └── eslint-config/            # Shared ESLint configurations
├── .gitignore
├── .prettierignore
├── .prettierrc
├── package.json
├── pnpm-workspace.yaml           # pnpm only; other PMs use package.json workspaces
└── turbo.json
```

Every generated app is linked to the relevant `@repo/*` packages. Root scripts are also created so you can run the entire workspace or target one app. For example, with pnpm:

```bash
pnpm dev
pnpm dev:web
pnpm build:dashboard
pnpm check-types
```

Vite apps also receive Vitest, Testing Library, a test setup file, and `test`/`test:watch` scripts. Next.js apps receive App Router, Turbopack, TypeScript, ESLint, and Tailwind through `create-next-app@latest`.

### Port behavior

Ports are configured automatically, but Monokit does **not** search your machine for an available port.

| Creation path | Configured port |
| --- | --- |
| Initial Next.js app | `3000` |
| Initial Vite-only app | `3000` |
| Initial Vite app alongside Next.js | `3001` |
| Next.js app added later with `monokit app` | `3000` |
| Vite app added later with `monokit app` | `3001` |

If one of those ports is already used by another app, update the Next.js `dev` script or the Vite `server.port` value after generation.

### Git behavior

Monokit initializes the generated project with:

```bash
git init -b main
```

It prevents generated apps from keeping their own nested Git repositories, so the complete monorepo is tracked from the root. Monokit does **not** run `git add`, create a commit, configure a remote, or push code. Generated files remain unstaged for you to review.

If Git initialization fails, scaffolding continues with a warning and tells you to run `git init -b main` from the project root.

## shadcn/ui workflows

Monokit does not force one component strategy. You choose the mode when creating a repository and again whenever you add an app.

| Mode | Where components live | Best suited for |
| --- | --- | --- |
| Shared design system | `packages/ui` | Reusable components consumed by multiple apps through `@repo/ui` |
| Per app | Inside each selected app | Components that belong to one app or need independent configuration |
| No shadcn | No app-level shadcn initialization | Projects that only need the generated workspace and Tailwind setup |

The `packages/ui` workspace shell and its configuration files are generated in every project, even when you choose no shadcn initialization. Choosing **No shadcn** means Monokit skips the interactive shadcn setup for the apps.

### Add components

```bash
monokit add button               # choose packages/ui or an app interactively
monokit add button --shared      # add to packages/ui
monokit add button --app web     # add only to apps/web
```

Monokit delegates component generation to `shadcn@latest` in the selected workspace.

- For a shared component, Monokit runs shadcn in `packages/ui`, normalizes imports in the expected `packages/ui/src/<component>.tsx` entry file, and exports that file from `packages/ui/src/index.ts`.
- For an app component, Monokit runs shadcn inside that app and leaves the generated component there.

The destination must already have a usable `components.json`. Apps created with the shared or per-app shadcn modes are configured for this; an app created with **No shadcn** may need shadcn initialization before app-local components can be added.

> Some shadcn registry items generate multiple files or directories instead of one `src/<component>.tsx` file. Review those shared additions and add any required barrel exports manually.

### Remove components

```bash
monokit remove button               # choose the destination interactively
monokit remove button --shared      # remove packages/ui/src/button.tsx and its export
monokit remove button --app web     # remove the matching component from apps/web
```

Removal always asks for confirmation. It removes the matching component file; it does not uninstall dependencies or automatically remove every companion file created by a multi-file registry item.

### Use shared components

Components exported by `packages/ui/src/index.ts` can be imported through the shared workspace package:

```tsx
import { Button } from "@repo/ui";
```

Third-party libraries should be installed in the workspace that imports them:

- Install a dependency in `packages/ui` when shared components import it.
- Install it in an individual app when only that app imports it.

Avoid re-exporting an entire third-party library from `packages/ui/src/index.ts`. Broad exports can introduce name collisions with your own components; export the specific shared API you intend apps to consume.

## Install the management CLI

For the shortest commands inside a generated monorepo, install the package globally:

```bash
npm install -g monokit-cli@latest
monokit --version
```

This package exposes two executables:

| Executable | Purpose |
| --- | --- |
| `monokit-cli` | Create a repository, or open the add-app flow when run inside a detected Monokit repository |
| `monokit` | Run management commands from a Monokit repository root |

You can also run the management executable without a global installation:

```bash
pnpm dlx --package=monokit-cli monokit list
```

## CLI reference

Run management commands from the monorepo root. Monokit detects a repository by its `turbo.json` or `pnpm-workspace.yaml`.

### `monokit app`

Add one Next.js or Vite app to the current monorepo.

The command asks for the framework, app name, optional Next.js `src/` directory, and shadcn mode. It then scaffolds the app, installs dependencies, links the shared workspace packages, and adds `dev:<app>` and `build:<app>` scripts to the root `package.json`.

```bash
monokit app
```

App names must start with a lowercase letter or number and may contain lowercase letters, numbers, hyphens, or underscores. Monokit rejects an app path that already exists.

New apps use the fixed port defaults documented in [Port behavior](#port-behavior); the command does not detect conflicts with existing apps.

### `monokit add <component>`

Add one shadcn/ui registry item to the shared UI package or an app. Without a destination flag, Monokit asks where to add it.

```bash
monokit add button
monokit add button --shared
monokit add button --app dashboard
```

See [shadcn/ui workflows](#shadcnui-workflows) for shared post-processing and multi-file registry-item behavior.

### `monokit remove <component>`

Remove a matching component file from `packages/ui` or an app after confirmation.

```bash
monokit remove button
monokit remove button --shared
monokit remove button --app dashboard
```

Shared removal also removes the matching export from `packages/ui/src/index.ts`.

### `monokit install [package]`

Install a package into `packages/ui`, a selected app, or the root workspace.

```bash
monokit install                 # ask for the package name
monokit install lucide-react
monokit install zod@3.22.0
```

Monokit suggests whether the package looks like a dependency or dev dependency, then lets you confirm or change that choice. Root installs default to dev dependencies because the root is intended for scripts and tooling, not application imports.

There are no destination flags for this command; select the target workspace from the prompt.

### `monokit uninstall [package]`

Remove a package from a prompted workspace using the package manager recorded by the project.

```bash
monokit uninstall
monokit uninstall lucide-react
```

There are no destination flags; Monokit asks whether to remove from `packages/ui`, an app, or the root.

### `monokit update [package]`

Update an installed package in a prompted workspace. A package without a requested version is updated using the selected package manager's latest-version behavior; a versioned package request installs that version.

```bash
monokit update
monokit update zod
monokit update zod@3.22.0
```

If the package is not installed in the selected workspace, Monokit offers to open the install workflow instead. There are no destination flags.

### `monokit list`

List the first-level directories under `apps/` and `packages/`. For apps, Monokit reports the detected Next.js or Vite type, configured port when found, and package version.

```bash
monokit list
```

Example output:

```text
Apps
  ├── web        (next)  port 3000  v0.1.0
  └── dashboard  (vite)  port 3001  v0.0.0

Packages
  ├── @repo/eslint-config      v0.0.0
  ├── @repo/tailwind-config    v0.0.0
  ├── @repo/typescript-config  v0.0.0
  └── @repo/ui                 v0.0.0
```

### `monokit doctor`

Audit the generated monorepo structure and configuration.

```bash
monokit doctor           # audit and offer available fixes interactively
monokit doctor --fix     # audit and apply supported fixes without asking
monokit doctor --types   # audit and run tsc --noEmit in every detected app
```

The audit checks:

- Root `package.json`, package-manager metadata, workspace configuration, `turbo.json`, `.gitignore`, and `.prettierrc`
- Root `dev:<app>` and `build:<app>` scripts
- `packages/ui` metadata, TypeScript config, shadcn config, barrel file, and `cn()` helper
- Shared component import paths and barrel exports
- Shared Tailwind, TypeScript, and ESLint package files
- App scripts, `@repo/*` dependencies, ESLint configuration, shared CSS import, and configured port
- Per-app TypeScript compilation when `--types` is passed

Supported automatic fixes are intentionally limited to:

- Normalizing broken shared-component import paths
- Adding missing shared-component exports to `packages/ui/src/index.ts`

The command exits with a non-zero status when failures remain.

### Global options

```bash
monokit --help       # show commands and examples
monokit --version    # show the installed version
monokit -h
monokit -v
```

Passing `--help` or `-h` after a command also displays the global help screen.

## Node.js requirements and upgrades

Monokit requires **Node.js 22.12.0 or newer**. The published package and newly generated repositories declare the same minimum runtime.

Upgrade the globally installed CLI with:

```bash
npm install -g monokit-cli@latest
monokit --version
```

Upgrading the global CLI does not automatically modify an existing generated monorepo. Changes happen only when you run a management command that performs them.

If you must remain on Node.js 18, reinstall the final compatible legacy CLI:

```bash
npm install -g monokit-cli@0.1.5
```

The Node.js compatibility check runs before the rest of the CLI loads and exits with upgrade and rollback guidance when the runtime is unsupported.

## Upstream generators

Monokit currently delegates parts of generation to these upstream CLIs:

- [`create-next-app@latest`](https://nextjs.org/docs/app/api-reference/cli/create-next-app)
- [`create-vite@latest`](https://vite.dev/guide/)
- [`shadcn@latest`](https://ui.shadcn.com/docs/cli)

Using their `latest` releases keeps newly generated projects current, but upstream output and prompts can change independently of Monokit. Review generated changes before committing them, and use `monokit doctor` to check the workspace conventions Monokit can verify.

## Roadmap

Released framework support is limited to **Next.js App Router** and **Vite + React**.

SvelteKit, Astro, Remix, and Expo are under consideration. They are not implemented or guaranteed in the current release.

Have a framework request or compatibility report? [Open a GitHub issue](https://github.com/realkelvinworld/monokit/issues).

## Contributing

Contributions are welcome. The local validation flow is:

```bash
git clone https://github.com/realkelvinworld/monokit.git
cd monokit
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

Open an issue before a large behavioral change so the scope and compatibility impact can be aligned first. Pull requests should keep the README synchronized with any user-facing CLI change.

## License

[MIT](./LICENSE)

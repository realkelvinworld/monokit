# monokit-cli

A CLI toolkit for scaffolding and managing production-ready Turborepo monorepos — with Next.js, Vite, Tailwind CSS v4, and shadcn/ui wired up out of the box.

No boilerplate hunting. No copy-pasting configs. Just run one command and start building.

---

## Why monokit?

Setting up a Turborepo monorepo from scratch is tedious. The official `create-turbo` gives you a bare scaffold — you still have to:

- Manually configure Tailwind v4 for each app
- Install and initialize shadcn/ui per app
- Wire up shared packages (`@repo/ui`, `@repo/tailwind-config`, etc.)
- Set up workspace dependencies across apps
- Add TypeScript path aliases, ESLint configs, and tsconfig presets
- Figure out port conflicts between apps
- Debug broken import paths when shadcn writes `@/lib/utils` inside a package

**monokit handles all of that for you** — and keeps handling it as your monorepo grows.

| Without monokit | With monokit |
| --- | --- |
| Manually configure each app | Interactive wizard does it all |
| Tailwind v4 setup per app | Shared config, one source of truth |
| shadcn/ui init per app | Auto-initialized with broken paths fixed |
| Copy workspace deps by hand | Auto-wired via `@repo/*` packages |
| No safety net after setup | `monokit doctor` audits everything |
| Manual installs per workspace | `monokit install` routes to the right place |

---

## Who is monokit for?

monokit is **opinionated by design**. It targets frontend teams building with:

- Next.js (App Router) and/or Vite + React — with more frameworks on the way
- Tailwind CSS v4
- shadcn/ui as the component foundation

If that matches your stack, monokit will save you hours of setup and keep saving you time as your monorepo grows.

If you need a blank slate without Tailwind or shadcn, or you're working outside the JS/TS ecosystem, [`create-turbo`](https://turbo.build/repo/docs/getting-started/create-a-new-monorepo) is the better starting point — monokit is built on top of it, not a replacement for it.

---

## Requirements

Monokit requires **Node.js 22.12.0 or newer**. New repositories scaffolded by Monokit declare the same minimum version so the CLI, Next.js, Vite, and testing tools share one supported runtime baseline.

Upgrading the global CLI does not modify existing monorepos. Users upgrading from a Node.js 18-compatible Monokit release should upgrade Node.js first, then install the new CLI:

```bash
npm install -g monokit-cli@latest
monokit -v
```

To restore the final legacy release if needed:

```bash
npm install -g monokit-cli@0.1.5
```

---

## Quick Start

```bash
pnpm dlx monokit-cli
# or
npx monokit-cli
# or
bunx monokit-cli
```

This launches an interactive scaffolder. You pick your apps (Next.js, Vite, or both), your package manager, and monokit builds out the full monorepo structure — shared packages included.

---

## What Gets Scaffolded

```text
my-monorepo/
├── .git/               # One Git repository for the complete monorepo
├── apps/
│   ├── client/          # Next.js (App Router) — port 3000
│   └── dashboard/       # Vite + React — port 3001
├── packages/
│   ├── ui/              # Shared shadcn/ui design system
│   ├── tailwind-config/ # Shared Tailwind v4 config + globals.css
│   ├── typescript-config/ # tsconfig presets (base, nextjs, vite)
│   └── eslint-config/   # Shared ESLint rules
├── turbo.json
├── .prettierrc
└── pnpm-workspace.yaml  # (or workspaces field for other PMs)
```

Monokit initializes the repository on the `main` branch. Generated files remain unstaged and uncommitted so you can review them before creating the first commit.

Every app comes pre-wired:

- `@repo/ui` in dependencies
- `@repo/tailwind-config` and `@repo/eslint-config` in devDependencies
- Tailwind v4 importing from the shared config
- eslint extending from the shared config
- Per-app `dev:*` and `build:*` scripts at the root

Supports **pnpm**, **bun**, **yarn**, and **npm**.

---

## monokit CLI

Once inside your monorepo, use `monokit` to keep managing it:

```bash
# if installed globally
monokit <command>

# or via dlx (no install needed)
pnpm --package=monokit-cli dlx monokit <command>
```

> **Tip:** Install globally once for the cleanest experience:

```bash
npm install -g monokit-cli
```

To update to the latest version at any time:

```bash
npm install -g monokit-cli@latest
```

---

### `monokit app`

Add a new app to an existing monorepo. Prompts for type (Next.js or Vite), name, and whether to set up shadcn/ui. Automatically wires all workspace dependencies.

```bash
monokit app
```

---

### `monokit add <component>`

Add a shadcn/ui component to the shared design system or a specific app. Automatically fixes import paths (shadcn writes `@/lib/utils` — monokit corrects it to `./utils`) and updates the barrel export in `packages/ui/src/index.ts`.

```bash
monokit add button              # prompts where to add
monokit add button --shared     # adds to packages/ui
monokit add button --app client # adds to apps/client
```

---

### `monokit remove <component>`

Remove a shadcn/ui component and clean up its export from `index.ts`.

```bash
monokit remove button
monokit remove button --shared
monokit remove button --app client
```

---

### `monokit install [package]`

Install an npm package into any workspace. Smart defaults auto-detect whether a package should be a dev dependency — `@types/*`, `eslint-*`, `typescript`, `vitest`, and other tooling packages are pre-selected as devDependencies.

```bash
monokit install                  # full wizard
monokit install lucide-react     # skip the name prompt
monokit install zod@3.22.0       # install a specific version
```

---

### `monokit uninstall [package]`

Remove an npm package from any workspace.

```bash
monokit uninstall lucide-react
```

---

### `monokit update [package]`

Update a package to its latest version. If the package isn't installed in the chosen workspace, monokit offers to install it instead.

```bash
monokit update zod           # update to latest
monokit update zod@3.22.0    # pin to a specific version
```

---

### `monokit list`

Show all apps and packages in the monorepo — type, port, and version at a glance.

```bash
monokit list
```

```text
Apps
  ├── client      (next)  port 3000  v0.1.0
  └── dashboard   (vite)  port 3001  v0.0.0

Packages
  ├── @repo/eslint-config        v0.0.0
  ├── @repo/tailwind-config      v0.0.0
  ├── @repo/typescript-config    v0.0.0
  └── @repo/ui                   v0.0.0
```

---

### `monokit doctor`

Audit your entire monorepo health. Checks every layer — root config, shared packages, and each app — and reports issues with clear, actionable hints. Can auto-fix the most common problems.

```bash
monokit doctor           # full audit
monokit doctor --fix     # audit + auto-fix issues
monokit doctor --types   # audit + run tsc --noEmit across all apps
```

What doctor checks:

- Root `package.json`, `turbo.json`, `pnpm-workspace.yaml`, `.prettierrc`, `.gitignore`
- `packageManager` field (required by Turbo v2)
- Per-app `dev:*` and `build:*` root scripts
- `packages/ui` — structure, `utils.ts`, `components.json`, barrel export
- Every component in `packages/ui/src/` — correct import paths, exported from `index.ts`
- `packages/tailwind-config` — globals.css, Tailwind v4 import
- `packages/typescript-config` — all preset files
- `packages/eslint-config` — config files
- Each app — workspace deps, ESLint config, Tailwind import, port config, `check-types` script

Auto-fixable issues:

- Wrong `cn` import paths in `packages/ui` components (e.g. `@/lib/utils` → `./utils`)
- Missing barrel exports in `packages/ui/src/index.ts`

---

### Options

```bash
monokit --help       # show all commands
monokit --version    # show version
```

---

## Shared Design System

Components added to `packages/ui` via `monokit add` are automatically:

1. Installed via shadcn/ui into `packages/ui/src/`
2. Import paths corrected for the monorepo structure
3. Re-exported from `packages/ui/src/index.ts`

Apps consume them through the `@repo/ui` workspace package:

```tsx
import { Button, Card, Sheet } from "@repo/ui";
```

No per-app shadcn setup needed. One component, available everywhere.

> **Note:** Avoid re-exporting entire third-party libraries from `packages/ui/src/index.ts` (e.g. `export * from "lucide-react"`). Name conflicts with shadcn components can occur. Install icon libraries directly in the apps that need them.

---

## Roadmap

monokit currently supports **Next.js** and **Vite + React**. More frameworks are on the way:

- SvelteKit
- Astro
- Remix
- Expo (React Native)

Have a framework you'd like to see? [Open an issue](https://github.com/realkelvinworld/monokit/issues).

---

## Contributing

Contributions are welcome. Open an issue or submit a pull request on [GitHub](https://github.com/realkelvinworld/monokit).

---

## License

MIT

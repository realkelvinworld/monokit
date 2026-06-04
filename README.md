# monokit-cli

Scaffold and manage a production-ready Turborepo monorepo with Next.js, Vite, Tailwind CSS v4, and shadcn/ui — in one command.

## Quick Start

```bash
pnpm dlx monokit-cli
# or
bunx monokit-cli
# or
npx monokit-cli
```

This runs the interactive scaffolder and sets up a full monorepo with your chosen apps, shared packages, and Tailwind + shadcn/ui wired across everything.

---

## What Gets Scaffolded

- **apps/** — Next.js (App Router) and/or Vite + React apps
- **packages/ui** — Shared shadcn/ui design system, importable by all apps via `@repo/ui`
- **packages/tailwind-config** — Shared Tailwind v4 config and global CSS
- **packages/typescript-config** — Shared `tsconfig` presets (base, nextjs, vite)
- **packages/eslint-config** — Shared ESLint config
- Root `turbo.json`, `.prettierrc`, `.gitignore`, and per-app `dev:*` / `build:*` scripts

Supports **pnpm**, **bun**, **yarn**, and **npm**.

---

## monokit CLI

Once inside a scaffolded monorepo, use the `monokit` CLI to manage it:

```bash
pnpm dlx monokit <command>
# or run directly if installed
monokit <command>
```

### Commands

#### `monokit app`
Add a new app to an existing monorepo. Prompts for app type (Next.js or Vite), name, and shadcn/ui setup.

```bash
monokit app
```

---

#### `monokit add <component>`
Add a shadcn/ui component to the shared design system or a specific app. Fixes import paths and updates the barrel export automatically.

```bash
monokit add button              # prompts where to add
monokit add button --shared     # adds to packages/ui
monokit add button --app client # adds to apps/client
```

---

#### `monokit remove <component>`
Remove a shadcn/ui component and clean up its export from `index.ts`.

```bash
monokit remove button              # prompts where to remove from
monokit remove button --shared     # removes from packages/ui
monokit remove button --app client # removes from apps/client
```

---

#### `monokit install [package]`
Install an npm package into any workspace. Interactive wizard guides you through the destination and dependency type — with smart defaults (e.g. `@types/*` auto-selects dev dependency).

```bash
monokit install                  # full wizard
monokit install lucide-react     # skips package name prompt
monokit install zod@3.22.0       # installs a specific version
```

---

#### `monokit uninstall [package]`
Remove an npm package from any workspace.

```bash
monokit uninstall lucide-react
```

---

#### `monokit update [package]`
Update a package to its latest version, or pin to a specific version. If the package isn't installed in the chosen workspace, offers to install it instead.

```bash
monokit update zod           # updates to latest
monokit update zod@3.22.0    # pins to a specific version
```

---

#### `monokit list`
Show all apps and packages in the monorepo with their type, port, and version.

```bash
monokit list
```

```
Apps
  ├── client   (next)  port 3000  v0.1.0
  └── dash     (vite)  port 3001  v0.0.0

Packages
  ├── @repo/eslint-config        v0.0.0
  ├── @repo/tailwind-config      v0.0.0
  ├── @repo/typescript-config    v0.0.0
  └── @repo/ui                   v0.0.0
```

---

#### `monokit doctor`
Audit your monorepo health. Checks root config, all shared packages, and every app. Reports issues with actionable hints.

```bash
monokit doctor           # full audit
monokit doctor --fix     # audit + auto-fix what it can (broken imports, missing exports)
monokit doctor --types   # audit + run tsc --noEmit across all apps
```

Auto-fixable issues:
- Wrong `cn` import paths in `packages/ui` components (e.g. `@/lib/utils` → `./utils`)
- Missing barrel exports in `packages/ui/src/index.ts`

---

### Options

```bash
monokit --help       # show help
monokit --version    # show version
```

---

## Shared Design System

Components added to `packages/ui` via `monokit add` are automatically:
1. Installed via shadcn/ui into `packages/ui/src/`
2. Import paths corrected for the monorepo structure
3. Re-exported from `packages/ui/src/index.ts`

Apps consume them via the `@repo/ui` workspace package:

```tsx
import { Button, Sheet } from "@repo/ui";
```

To add a package that components in `packages/ui` depend on (e.g. an icon library):

```bash
monokit install lucide-react
# choose: Shared (packages/ui)
```

Then re-export from `packages/ui/src/index.ts`:

```ts
export * from "lucide-react";
export * from "./button";
```

> **Note:** If you re-export an entire library (`export * from "lucide-react"`), name conflicts with shadcn components can occur. Install icon libraries directly in the apps that need them to avoid this.

---

## Requirements

- Node.js >= 18
- One of: pnpm, bun, yarn, or npm

---

## License

MIT

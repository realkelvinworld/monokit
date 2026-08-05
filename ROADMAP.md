# monokit Roadmap

This document tracks what has been built and what is planned next. Items are grouped into phases — each phase is blocked on the previous one being tested and merged.

---

## Phase 1 — Testing Commands
**Branch:** `feat/testing` | **Status:** Built, pending real-world test before merge

### What was built

| File | What it does |
|---|---|
| `src/utils/app-type.ts` | Detects whether a workspace is `next`, `vite`, or `sveltekit` by reading its `package.json` deps |
| `src/test-command.ts` | Powers `monokit test init` (scaffolds vitest) and `monokit test` (runs tests) |
| `src/e2e-command.ts` | Powers `monokit e2e init` (scaffolds Playwright) and `monokit e2e` (runs e2e specs) |
| `src/monokit.ts` | Registered both commands, updated help text and examples |
| `README.md` | Documented `monokit add` with third-party registries (e.g. `@magicui/dot-pattern`) and all test/e2e commands |

### Test checklist — must pass before merging

#### `monokit test init`
```bash
monokit test init --app <name>   # scaffold in a specific app
monokit test init --shared       # scaffold in packages/ui
monokit test init                # interactive prompt
```

- [ ] Installs `vitest`, `jsdom`, `@vitejs/plugin-react` as devDeps in the correct workspace
- [ ] Writes `vitest.config.ts` in the workspace root
- [ ] Adds `test`, `test:watch`, `test:coverage` scripts to the workspace `package.json`
- [ ] Creates `src/__tests__/example.test.ts` with a passing sample test
- [ ] Running `monokit test --app <name>` after init runs and passes the sample test
- [ ] Does NOT overwrite an existing `test` script
- [ ] Next.js config includes `@/` path alias; Vite config does not

#### `monokit test`
```bash
monokit test --app <name>
monokit test --shared
monokit test --all
monokit test --app <name> -- --watch
monokit test --app <name> -- --coverage
```

- [ ] Runs tests in the correct workspace
- [ ] `--all` runs `turbo run test` from the repo root
- [ ] Fails with a clear message if no `test` script exists (tells user to run `monokit test init`)
- [ ] Passthrough args after `--` reach vitest correctly
- [ ] Interactive prompt appears when no flags are given

#### `monokit e2e init`
```bash
monokit e2e init
```

- [ ] Installs `@playwright/test` at repo root as a devDep
- [ ] Downloads Chromium via `playwright install chromium --with-deps`
- [ ] Writes `playwright.config.ts` at repo root
- [ ] Creates `tests/e2e/example.spec.ts`
- [ ] Adds `e2e`, `e2e:ui`, `e2e:report` scripts to root `package.json`
- [ ] Does NOT overwrite existing `playwright.config.ts`
- [ ] Does NOT overwrite existing `example.spec.ts`

#### `monokit e2e`
```bash
monokit e2e
monokit e2e --ui
monokit e2e tests/e2e/example.spec.ts
```

- [ ] Fails with a clear message if `playwright.config.ts` is not found at repo root
- [ ] Runs Playwright tests from repo root
- [ ] Passthrough args reach `playwright test` correctly

---

## Phase 2 — SvelteKit Support
**Branch:** `feat/sveltekit` | **Status:** Not started — blocked on Phase 1 merge

### Background

SvelteKit uses `shadcn-svelte` (not the React `shadcn/ui`) — same concept, different primitives, `.svelte` components instead of `.tsx`. They are incompatible. The solution is a separate `packages/ui-svelte` (`@repo/ui-svelte`) that mirrors `packages/ui` for Svelte apps.

`packages/ui-svelte` is created **lazily** — it does not exist until the first SvelteKit app is added via `monokit app`. Subsequent SvelteKit apps reuse it. Both packages share `packages/tailwind-config` for visual consistency.

### Build list

| # | File | What it does |
|---|---|---|
| 1 | `src/templates/sveltekit.ts` | New file. All SvelteKit app templates: `svelte.config.js`, `vite.config.ts`, `src/app.css`, `tsconfig.json` |
| 2 | `src/templates/packages.ts` | Add `packages/ui-svelte` templates: `package.json`, `components.json` (shadcn-svelte config), `src/utils.ts`, `src/index.ts`, `tsconfig.json` |
| 3 | `src/scaffold-ui-svelte.ts` | New file. Creates `packages/ui-svelte` on first SvelteKit app add. Reused by all subsequent SvelteKit apps |
| 4 | `src/add.ts` | Add `sveltekit` to the app type prompt. Trigger lazy `packages/ui-svelte` scaffold. Wire `@repo/ui-svelte` as a workspace dep in the new app |
| 5 | `src/add-component.ts` | Fork React/Svelte CLI routing (`shadcn@latest` vs `shadcn-svelte@latest`). Add `fixSvelteImport` (`$lib/utils` → `./utils`). Handle `.svelte` barrel exports. Add `--svelte` flag |
| 6 | `src/remove-component.ts` | Detect `.svelte` component files for Svelte workspaces alongside existing `.tsx` detection |
| 7 | `src/test-command.ts` | Remove the "coming soon" SvelteKit block. Install `@testing-library/svelte` instead of `@testing-library/react`. Use `@sveltejs/kit/vite` in vitest config |
| 8 | `src/doctor.ts` | Add `packages/ui-svelte` health checks. Per-SvelteKit-app checks: workspace deps, `svelte.config.js`, Tailwind import in `src/app.css`, `@repo/ui-svelte` dep |
| 9 | `src/list.ts` | Detect and display `(sveltekit)` app type alongside `(next)` and `(vite)` |

### Key decisions

- `monokit add --shared` routes React components to `packages/ui`, Svelte components to `packages/ui-svelte`
- New `--svelte` flag on `monokit add` as a shorthand for targeting `packages/ui-svelte`
- shadcn-svelte writes `$lib/utils` paths — a new `fixSvelteImport` handles this (parallel to the existing `fixCnImport`)
- Tailwind config is framework-agnostic — `packages/tailwind-config` is shared with no changes

---

## Phase 3 — DX Improvements
**Branch:** `feat/dx` | **Status:** Not started — blocked on Phase 2 merge

### Build list

| # | File | What it does |
|---|---|---|
| 10 | `src/utils/version-check.ts` | New file. Fetches latest monokit version from npm registry. Caches result for 24h in a temp file. Returns an update notice if the running version is behind |
| 11 | `src/monokit.ts` | Wire version check into every command run. Show update notice at the bottom of output when a newer version is available |
| 12 | `src/outdated.ts` | New file. Checks every workspace's packages against the npm registry. Displays a colour-coded table grouped by workspace, labelled by severity (major / minor / patch) |
| 13 | `src/monokit.ts` | Register `outdated` command, add to help text and examples |
| 14 | `src/install.ts` | Multi-workspace install — replace single-select destination with a checkbox (multi-select). One `monokit install react-hook-form` installs into every selected workspace simultaneously |

### How the version notifier will look

```
  ... normal command output ...

  ╭──────────────────────────────────────────────╮
  │  Update available: 0.1.5 → 0.1.8             │
  │  Run: npm install -g monokit-cli@latest       │
  ╰──────────────────────────────────────────────╯
```

### How `monokit outdated` will look

```
apps/client
  next             14.2.0  →  15.1.0   major
  @types/react     18.2.0  →  19.0.0   major

apps/dashboard
  vite              4.5.0  →   6.0.0   major
  @vitejs/plugin-react  3.1.0  →  4.3.0  minor

packages/ui
  All packages up to date ✓

Root
  turbo            1.13.0  →   2.9.0   major
```

### How multi-workspace install will look

```
monokit install react-hook-form

Install where? (Space to select, Enter to confirm)
  ✅ apps/admin
  ✅ apps/web
  ☐  apps/dashboard
  ☐  packages/ui
  ☐  Root workspace
```

---

## Branch strategy

```
main
├── feat/testing    ← Phase 1 (current)
├── feat/sveltekit  ← Phase 2 (branch from main after Phase 1 merges)
└── feat/dx         ← Phase 3 (branch from main after Phase 2 merges)
```

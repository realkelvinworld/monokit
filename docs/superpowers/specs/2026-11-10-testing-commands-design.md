# Monokit testing commands

## Goal

Give Monokit repositories a small, consistent testing interface without rebuilding Turborepo's task runner.

## Commands

- `monokit test init --app <name>` configures Vitest in one app.
- `monokit test init --shared` configures Vitest in `packages/ui`.
- `monokit test --app <name>` runs that app's test task through the root Turbo pipeline.
- `monokit test --shared` runs the shared UI test task through Turbo.
- `monokit test --all` runs every test task through the repository's local Turbo binary.
- `monokit e2e init --app <name>` configures Playwright for one app.
- `monokit e2e --app <name>` runs that app's Playwright script.

When a target is omitted, Monokit asks the user to select one. Arguments after `--` are passed to Vitest or Playwright.

## App creation

- Initial monorepo creation asks separately whether to include unit testing in each selected app.
- `monokit app` asks the same question for the new app.
- Each testing prompt defaults to Yes.
- Selecting Yes configures Vitest, Testing Library, scripts, setup, and a passing starter test.
- Selecting No leaves the app without Vitest dependencies, scripts, configuration, setup, or starter tests.
- Next.js and Vite + React use the same shared setup implementation so their generated testing behaviour stays aligned.

## Behaviour

- Only first-level workspaces under `apps/` and `packages/ui` are valid targets.
- Next.js and Vite + React are supported. Other frameworks receive an actionable error.
- Existing Vitest and Playwright configuration files are never overwritten.
- Missing scripts and dependencies are added without replacing user-owned entries.
- `monokit test init` adds a starter test when a configured workspace has no test files, repairing older generated Vite apps without replacing their configuration.
- New Vitest configuration uses Testing Library, jsdom, TypeScript path aliases, and V8 coverage.
- New Playwright configuration contains an app-aware `webServer`, inferred port, and Chromium project.
- Playwright starts the selected app automatically and reuses an existing local server outside CI.
- Dependency installation uses the package manager recorded in the repository.
- Turbo remains responsible for unit-test scheduling and caching.

## Feedback

Show one concise message for target selection, dependency installation, configuration completion, failure, and the next runnable command. Do not print generated file contents or repetitive success messages.

## Verification

Automated tests cover argument parsing, target containment, framework and port detection, generated configuration, preservation of existing scripts, and CLI help. Final verification runs the complete test suite, typecheck, production build, and `git diff --check`.

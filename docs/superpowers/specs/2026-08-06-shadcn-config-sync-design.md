# Shadcn Configuration Synchronization Design

## Status

Approved on 2026-08-06.

## Context

Monokit currently initializes shadcn interactively inside an app, but it prewrites `packages/ui/components.json` with `style: "new-york"` and preinstalls `radix-ui` in `packages/ui/package.json`. In shared mode, Monokit then moves the generated button source into `packages/ui` without moving or reinstalling the primitive dependency that source requires.

This creates a real split-brain design system. An app can correctly select `base-nova` while the shared UI package still declares the older Radix configuration. Components added later can therefore use a different primitive API from the components already consumed by the apps.

The current shadcn CLI supports Base UI, Radix, and React Aria. Its official monorepo output keeps the design fields synchronized across every `components.json` and installs primitive dependencies in the shared UI workspace that owns the components.

## Decision

Monokit will follow the official shadcn monorepo ownership model in shared mode:

- `packages/ui/components.json` is the canonical shared design-system configuration;
- the first interactive shared-app initialization seeds that canonical configuration;
- every app marked as shared receives a workspace-specific projection of the canonical configuration;
- shared component source and primitive dependencies belong to `packages/ui`;
- per-app shadcn configurations remain intentionally independent;
- existing projects receive an auditable, explicit repair path through `monokit upgrade`;
- Monokit never silently changes a project's primitive library or overwrites customized components.

The implementation must support any style accepted by the installed shadcn CLI. It must not contain Base UI-only branches or assume that Radix and Base UI are the only available primitives.

## Canonical and Workspace-Specific Fields

The following design fields are synchronized from `packages/ui/components.json` to every shared app:

- `style`;
- `iconLibrary`;
- `tailwind.baseColor`;
- `tailwind.cssVariables`;
- `tailwind.prefix` when present;
- `rtl` when present;
- `menuColor` when present;
- `menuAccent` when present;
- `registries` when present.

The following fields remain workspace-specific and must not be copied blindly:

- `aliases`;
- `tailwind.css`;
- `tailwind.config`;
- `rsc`;
- filesystem-resolved paths.

`tsx` remains true in generated Monokit workspaces. Unknown valid fields from the canonical configuration are preserved rather than discarded, but they are not automatically synchronized unless shadcn documents them as design-system fields.

## Project Metadata

New projects will include `.monokit.json` with a numeric project schema version and the shadcn ownership mode for each app:

```json
{
  "schemaVersion": 1,
  "shadcn": {
    "apps": {
      "web": "shared",
      "dashboard": "per-app"
    }
  }
}
```

Valid app modes are `shared`, `per-app`, and `none`. The marker records ownership only; it does not duplicate the shadcn preset or style. `packages/ui/components.json` remains the single source of truth for shared design values.

When `monokit app` adds an app, it updates only that app's marker entry. Existing marker entries are preserved.

## New Project Flow

For the first app using shared mode:

1. Monokit runs the current shadcn interactive initialization in the app and reads the resulting `components.json`.
2. Monokit extracts the canonical design fields selected by the user.
3. Monokit writes `packages/ui/components.json` using those fields plus package-specific aliases and the shared CSS path.
4. Monokit rewrites the app's `components.json` as a shared projection with the same design fields and app-specific aliases, CSS path, and `rsc` value.
5. Monokit invokes `shadcn add` from `packages/ui` to install the starter shared component. It does not move a component file from the app into the package.
6. The shadcn CLI installs the primitive and registry dependencies into `packages/ui`, which owns the generated source.
7. Monokit removes only the disposable app-local starter component created during initialization. It does not broadly remove app dependencies or user files.

For later apps using shared mode:

1. Monokit reads the canonical configuration from `packages/ui/components.json`.
2. It writes the new app's workspace-specific projection without asking the user to choose a second shared preset.
3. It records the app as `shared` in `.monokit.json`.

For per-app mode, shadcn runs inside the selected app and keeps that app's source, configuration, theme choices, and primitive dependencies independent. Shared synchronization never rewrites a per-app configuration.

## Component Installation

`monokit add <component> --shared` runs shadcn from `packages/ui`. The shared package's canonical config determines the style and primitive, and the generated dependencies remain in `packages/ui`.

`monokit add <component> --app <name>` runs shadcn from that app. A shared-mode app starts with synchronized design fields but uses its own aliases, allowing intentionally app-local components and dependencies. A per-app app uses its independent configuration unchanged.

Before invoking shadcn, Monokit validates that the destination has a usable `components.json`. In shared mode it also validates that the destination's synchronized fields match the canonical shared fields. A mismatch stops the add operation and points to `monokit upgrade --check`; Monokit does not generate another component on top of a known conflict.

## Health Checks

`monokit doctor` reports, without modifying files:

- missing `.monokit.json` ownership metadata;
- missing shared or app `components.json` files;
- synchronized field differences between `packages/ui` and shared apps;
- shared component imports whose primitive does not match the canonical style;
- primitive packages imported by shared source but missing from `packages/ui/package.json`;
- primitive packages declared in apps when the corresponding source is owned only by `packages/ui` as an informational cleanup warning;
- mixed primitive imports inside the shared component directory.

`monokit doctor --fix` may repair only deterministic metadata issues, such as adding a missing marker for a project whose ownership is already unambiguous. It must not switch styles, rewrite component source, or remove primitive dependencies.

## Existing Project Upgrade

This change introduces the minimum versioned migration infrastructure required for `monokit upgrade --check` and `monokit upgrade`.

For a legacy project without `.monokit.json`, the check command will inspect:

- all app and shared `components.json` files;
- shared component import specifiers;
- workspace package dependencies;
- shared theme wiring;
- Git working-tree cleanliness.

The check command produces a read-only plan. It suggests shared ownership only when the evidence is unambiguous. If apps disagree or Monokit cannot distinguish shared from per-app ownership, the apply command asks the user to classify each affected app. The answer is recorded in `.monokit.json`.

### Safe metadata repair

When shared component imports already match the intended primitive, `monokit upgrade` may:

- synchronize canonical design fields;
- preserve workspace aliases, CSS paths, and `rsc` values;
- add missing directly imported packages to `packages/ui` through the detected package manager;
- update `.monokit.json`;
- leave unrelated dependencies and component source unchanged.

The command prints the planned file and dependency changes and asks for confirmation before writing.

### Primitive migration

When the intended style uses a different primitive from the shared source, Monokit treats the operation as a component migration, not a metadata repair.

The migration will:

1. require a clean Git working tree;
2. list the affected shared components and the current and target primitive;
3. run shadcn dry-run/diff checks for registry-backed components;
4. report custom files that shadcn cannot regenerate;
5. ask for explicit overwrite confirmation, defaulting to no;
6. regenerate only confirmed registry-backed components from inside `packages/ui`;
7. preserve the existing barrel exports;
8. run the project's typecheck after regeneration;
9. stop with recovery guidance if typecheck fails.

Monokit does not create a commit. Git remains the rollback mechanism. If the tree is dirty, if primitive imports are mixed, or if a customized component cannot be safely regenerated, the migration stops before overwriting files and reports the manual merge work required.

## Failure Handling

- A network or registry failure leaves the last successfully written configuration visible and reports the exact command that failed.
- Configuration writes use complete JSON objects and are validated before replacement.
- Cancellation exits without applying the remaining migration steps.
- Unsupported or unknown style values are preserved and delegated to shadcn rather than mapped through a Monokit-maintained allowlist.
- Missing package-manager tooling produces an actionable error and no dependency edits.
- `--check` never writes files, installs packages, or changes Git state.
- Neither scaffolding nor upgrading stages, commits, pushes, or configures remotes.

## Implementation Boundaries

The change includes:

- canonical shared shadcn config helpers;
- app config projection helpers;
- removal of the hardcoded shared `new-york` and `radix-ui` assumptions;
- destination-owned shared component generation;
- `.monokit.json` ownership metadata;
- drift checks in `monokit doctor`;
- the minimum migration registry and `monokit upgrade` command needed for legacy shadcn repair;
- documentation for shared versus per-app ownership;
- automated tests and disposable-project smoke tests.

The change does not include:

- automatically converting arbitrary custom component implementations;
- silently overwriting registry components;
- forcing per-app configurations to match shared mode;
- replacing Monokit's complete repository scaffold with shadcn's repository template;
- pinning a single style, icon library, base color, or primitive;
- automatically upgrading unrelated framework or npm dependencies;
- automatic Git commits or npm publication.

## Verification

Automated tests will cover:

- canonical field extraction and workspace projection;
- preservation of aliases, CSS paths, and `rsc`;
- Base UI, Radix, and React Aria style values without primitive-specific branches;
- custom registries and optional fields;
- first shared app initialization;
- later shared app inheritance;
- per-app independence;
- `monokit add --shared` running shadcn in `packages/ui`;
- destination dependency ownership;
- doctor detection of config drift, missing dependencies, and mixed primitives;
- upgrade check mode making no writes;
- safe metadata repair;
- ambiguous legacy ownership prompting instead of guessing;
- dirty-tree and overwrite guards for primitive migrations;
- package-manager coverage for pnpm, npm, yarn, and Bun;
- no automatic Git staging or commits.

Release smoke tests will generate disposable monorepos for:

- Next.js with a shared Base UI configuration;
- Vite with a shared Radix configuration;
- mixed Next.js and Vite apps sharing one design system;
- a React Aria shared configuration;
- independent per-app configurations;
- a legacy app/shared mismatch repaired through `monokit upgrade`.

Each shared smoke test will add a component to `packages/ui`, install dependencies, run type checking, inspect every `components.json`, and verify that the primitive dependency belongs to `packages/ui`.

## Branch and Release Isolation

The work lives on `fix/shadcn-config-sync`. The earlier `fix/scaffold-command-hint` patch remains a separate release branch until merged. Before this branch is merged or released, it must be updated from the latest `main` so the completed scaffold hint fix is retained without duplicating its commit or version bump.

# Monokit README Redesign

## Goal

Redesign the public README so a new user can understand Monokit quickly while still having a complete and accurate reference for every released capability. The same document must render cleanly on GitHub and npm.

## Audience

- Developers evaluating Monokit for a new TypeScript monorepo
- Existing users checking commands, flags, requirements, and upgrade behavior
- Contributors who need to understand the supported product surface

## Design principles

1. **Progressive detail:** lead with the value proposition and first-success command, then provide the full reference below.
2. **Implementation-backed claims:** every capability statement must be traceable to released CLI code or a verified command result.
3. **One source of truth:** requirements, supported frameworks, and compatibility rules appear once and are linked or summarized elsewhere instead of duplicated.
4. **Explicit choices:** distinguish shared shadcn, per-app shadcn, and no shadcn initialization without presenting one mode as the only supported workflow.
5. **Restrained presentation:** use headings, spacing, badges, tables, and short examples for visual hierarchy; avoid decorative noise and unsupported HTML-heavy layouts.

## Page structure

### 1. Hero

- Product name and a short, concrete description
- One sentence explaining the main benefit
- Dynamic badges for npm version, npm downloads, Node requirement, and license
- A single primary Quick Start command, followed by compact alternatives for other package managers

The hero must not use subjective claims such as “production-ready” unless the README defines what that means.

### 2. Why Monokit

A compact feature table will explain the problems Monokit handles:

- Next.js and Vite application scaffolding
- Shared workspace packages and configuration
- Shared or per-app shadcn/ui management
- Workspace-aware dependency management
- Root Git initialization
- Monorepo health checks through `monokit doctor`

### 3. Capability matrix

The matrix is the quick source of truth for released behavior:

| Area | Supported behavior |
| --- | --- |
| Frameworks | Next.js App Router, Vite + React, or both in one generated repository |
| Package managers | pnpm, bun, yarn, and npm |
| shadcn/ui | Shared design system, per-app setup, or no shadcn initialization |
| Components | Add or remove from `packages/ui` or a selected app |
| Dependencies | Install, uninstall, or update in the root, shared package, or selected app where supported |
| Git | One root repository initialized on `main`; no automatic staging, commit, remote, or push |
| Runtime | Node.js 22.12.0 or newer |

Planned frameworks must not appear in this matrix.

### 4. Quick Start and generated result

- Show the shortest path to scaffolding a repository
- Explain the interactive choices without claiming a port prompt exists
- Show the generated folder tree
- Explain root Git behavior immediately below the tree
- Document the fixed generated port defaults without implying that Monokit searches for a free port
- Do not claim automatic port-conflict detection: `monokit app` currently uses its generator defaults

### 5. shadcn/ui workflows

This section must describe all three project setup choices:

- **Shared:** reusable components live in `packages/ui` and apps consume them through `@repo/ui`.
- **Per app:** each app owns and manages its own components.
- **None:** Monokit skips shadcn initialization; this does not imply the generated workspace package shell is absent.

Component examples must show both destinations:

```bash
monokit add button --shared
monokit add button --app client
```

The dependency guidance must say that third-party libraries belong in the workspace that imports them: `packages/ui` for shared component dependencies or the individual app for app-only usage. The README may warn against re-exporting an entire third-party library through `@repo/ui`, but must not imply that third-party libraries can only be installed in apps.

### 6. Complete CLI reference

Document only released commands and their implemented flags:

- `monokit app`
- `monokit add <component>` with `--shared` and `--app <name>`
- `monokit remove <component>` with `--shared` and `--app <name>`
- `monokit install [package]`
- `monokit uninstall [package]`
- `monokit update [package]`
- `monokit list`
- `monokit doctor` with `--fix` and `--types`
- `monokit --help`
- `monokit --version`

Each command gets one purpose sentence and focused examples. Prompt-driven destination choices should be described where flags are not available.

### 7. Requirements and upgrades

Maintain one authoritative compatibility section:

- Node.js 22.12.0 or newer
- Current installation and upgrade command
- Existing generated repositories are not modified merely by upgrading the global CLI
- `monokit-cli@0.1.5` remains the documented fallback for Node.js 18 users

### 8. Doctor, roadmap, and project information

- Keep the detailed list of checks and safe auto-fixes performed by `monokit doctor`.
- Label future framework entries as planned or under consideration, not currently supported or guaranteed.
- End with concise contributing, repository, and license information.

## Visual treatment

- Standard Markdown remains the baseline for reliable npm and GitHub rendering.
- Use no more than four meaningful badges.
- Use tables only for comparisons and capability summaries.
- Use code blocks for commands and generated structure.
- Use short callouts for important compatibility or safety notes.
- Reduce horizontal-rule repetition; headings and whitespace provide most section separation.
- Keep emojis optional and sparse so they do not replace labels or meaning.

## Accuracy audit

Before considering the rewrite complete:

1. Trace every command and flag to `src/monokit-main.ts` and its command implementation.
2. Trace scaffolding choices to `src/scaffold.ts` and `src/add.ts`.
3. Trace shared and per-app component behavior to `src/add-component.ts` and `src/remove-component.ts`.
4. Trace package destinations and dependency behavior to the install, uninstall, and update implementations.
5. Trace Node and Git claims to the runtime preflight, package metadata, scaffold implementation, and existing tests.
6. Run the test suite, typecheck, build, and `npm pack --dry-run`.
7. Inspect the packed README and package metadata to confirm npm will receive the intended document and version.

If code and documentation disagree, document the released implementation rather than the intended behavior and flag the product gap separately.

## Non-goals

- Adding or changing CLI behavior
- Claiming unreleased testing, E2E, SvelteKit, Astro, Remix, or Expo support
- Creating a new logo or image asset
- Turning the README into a separate documentation website
- Publishing to npm before the README branch is reviewed and merged

## Acceptance criteria

- A new user can find the install command, Node requirement, supported frameworks, and shadcn modes without reading the entire page.
- Shared and per-app shadcn workflows are both explained accurately.
- Every released command and documented flag matches the current implementation.
- Port documentation states the implemented defaults without claiming automatic conflict detection.
- Git behavior clearly states what Monokit does and does not automate.
- Planned features are visually separated from released capabilities.
- The README has no duplicated requirement sections or contradictory statements.
- The packed npm artifact contains the redesigned README and correct package version.

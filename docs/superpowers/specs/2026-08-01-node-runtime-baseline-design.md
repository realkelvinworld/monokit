# Node.js Runtime Baseline Design

## Status

Approved on 2026-08-01.

## Context

Monokit currently declares Node.js 18 as its minimum runtime and writes the same requirement into generated repositories. That no longer matches the tools Monokit invokes: current Vite requires Node.js 20.19+ or 22.12+, current Next.js requires Node.js 20.9+, and Node.js 18 and 20 are end-of-life.

Maintaining a legacy framework matrix for unsupported Node.js versions would add branching throughout scaffolding, testing, and upgrade commands. A single modern baseline is simpler to explain, test, and maintain.

## Decision

Monokit and all repositories it generates will require Node.js 22.12.0 or newer.

The minimum version will have one source of truth in the CLI code. Both executable entry points will validate the running version before inspecting or modifying a project. Generated root `package.json` files and Monokit's own `package.json` will declare the same requirement through `engines.node`.

## User Experience

Supported versions continue without additional output.

Unsupported versions stop before any filesystem changes or external commands and display a concise error containing:

- the required minimum version;
- the detected version;
- a prompt to upgrade Node.js and retry.

Example:

```text
Monokit requires Node.js 22.12.0 or newer.
Detected: Node.js 18.20.8

Upgrade Node.js using your preferred version manager, then retry.
```

The process exits with a non-zero status.

Existing Monokit installations do not update automatically. Installing a newer global version replaces only the CLI package and does not migrate or rewrite existing monorepos. Because npm treats `engines` as advisory unless `engine-strict` is enabled, the runtime preflight must remain dependency-free and execute before the rest of the CLI is imported.

The unsupported-version message includes `npm install -g monokit-cli@0.1.5` as a recovery path for users who cannot upgrade Node.js immediately. The Node.js requirement will ship as a breaking `0.2.0` release, while `0.1.5` remains the legacy Node.js 18-compatible release.

## Implementation Boundaries

The change includes:

- updating Monokit's published `engines.node` requirement;
- updating the generated root package template;
- adding a small dependency-free Node.js version utility;
- using dependency-free bootstraps for both `create-monokit` and `monokit`, with command modules loaded only after the preflight passes;
- documenting the requirement in the README;
- testing version comparison at the boundary and representative supported and unsupported versions.

The change does not include framework upgrades, dependency upgrades, SvelteKit support, or command-specific legacy behavior.

## Design Details

The version check will use `process.versions.node` and numeric major, minor, and patch comparison. A semver dependency is unnecessary because Node.js supplies a normalized numeric version and the requirement has no prerelease or range syntax.

The comparison logic will be pure and separate from terminal output so boundary cases can be tested without replacing global process state. The entry-point preflight will format the error and return control to the entry point, which will set a failing exit status without starting command execution.

## Verification

Verification will cover:

- `22.11.x` is rejected;
- `22.12.0` is accepted;
- newer Node.js 22 releases are accepted;
- Node.js 24 and 26 are accepted;
- malformed version input is rejected safely;
- both entry points run the preflight before command handling;
- type checking and production bundling still pass;
- the published and generated `engines.node` values remain identical.

## Risks and Mitigations

Users on Node.js 18 or 20 will no longer be able to run new Monokit releases. The explicit preflight makes the incompatibility understandable, while older Monokit releases remain available from npm for existing legacy environments.

Duplicating the minimum version between runtime code and JSON could drift. Verification will assert that the package metadata and generated template match the exported runtime constant.

# Generated Repository Git Design

## Status

Approved on 2026-08-03.

## Context

Monokit delegates Next.js app creation to `create-next-app`. During initial monorepo creation, the generated root is not yet a Git repository, so `create-next-app` initializes `apps/<name>/.git`. Git then treats that app as a separate repository and the parent repository does not track the app's files normally.

The failure was reproduced with the same Next.js generator arguments Monokit uses. The generated app reported that it initialized Git, and `git rev-parse --show-toplevel` resolved to the app directory instead of the monorepo root.

## Decision

Every repository created by `create-monokit` will have one Git repository at the generated monorepo root. Generated apps must not contain their own Git repositories.

Monokit will:

- initialize the generated root with `git init -b main` before scaffolding apps;
- pass the official `--disable-git` option to `create-next-app`;
- defensively remove `.git` only from an app directory that Monokit has just created if an upstream generator still creates one;
- prevent nested Git initialization when `monokit app` adds a Next.js app to an existing monorepo;
- leave staging, commits, remotes, and pushes entirely under the user's control.

Vite does not currently initialize a nested Git repository through Monokit's scaffold path, but the same generated-app postcondition applies regardless of framework.

## User Experience

After a successful scaffold:

```text
my-project/
├── .git/
├── apps/
│   ├── web/
│   └── dashboard/
└── packages/
```

There must be no `apps/*/.git` directory. The repository starts on the `main` branch with generated files unstaged and uncommitted, allowing the user to review them before the first commit.

If Git is unavailable or root initialization fails, project generation will continue and show an actionable warning with `git init -b main`. A Git setup problem must not discard an otherwise valid generated monorepo.

## Implementation Boundaries

The change includes:

- a small Git initialization helper;
- root initialization during `create-monokit`;
- Next.js `--disable-git` arguments for both initial and later app scaffolding;
- narrowly scoped cleanup of nested metadata in newly generated app directories;
- regression tests for Git initialization and Next.js scaffold arguments;
- a disposable generated-project smoke test.

The change does not include:

- automatic `git add`;
- automatic commits;
- remote creation or configuration;
- automatic pushes;
- rewriting Git configuration in existing applications;
- deleting nested repositories that Monokit did not create in the current command.

## Branch Isolation

The Node runtime and generated-repository Git work will live on a dedicated `feat/node-runtime` branch based on `main`. The existing `feat/testing` branch will retain only its testing and Playwright command work.

Because the current working tree contains both groups of changes, the split will use explicit file and hunk selection with a recoverable temporary backup. No broad `git add .`, hard reset, or destructive checkout will be used. Before either branch is considered ready, its diff against `main` will be inspected to confirm that no feature crossed the boundary.

The Node branch may contain source-control commits needed to represent its Monokit changes. Those development commits are separate from generated-project behavior: Monokit itself will never create a commit in a user's new repository.

## Verification

Automated and manual verification will confirm:

- the Next.js generator arguments contain `--disable-git`;
- root initialization produces a repository whose branch is `main`;
- a generated Next.js app has no nested `.git` directory;
- a generated Vite app has no nested `.git` directory;
- adding a later Next.js app does not change the root repository boundary;
- a dry-run add from the root sees files inside every generated app;
- Git initialization failure produces guidance without deleting the project;
- Node runtime tests, type checking, build, and package dry-run still pass;
- `feat/node-runtime` contains no testing or E2E command implementation;
- `feat/testing` retains its testing and E2E work without the Node runtime changes.

## Risks and Mitigations

Removing a `.git` directory is destructive if applied to an existing repository. Cleanup is therefore restricted to the exact app directory created successfully by the current scaffold operation. Monokit will never scan for and delete arbitrary nested repositories.

Git versions without `git init -b` support may reject the initialization command. The failure path will preserve the generated project and provide the manual recovery command instead of leaving partially deleted output.

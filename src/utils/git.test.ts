import { access, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";

import {
  assertGeneratedAppTargetAvailable,
  initializeGitRepository,
  removeGeneratedAppGitMetadata,
} from "./git.js";
import { getWorkspaceNameError } from "./workspace-name.js";
import { getNextAppCreateArgs } from "./apps.js";

const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "monokit-git-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("generated repository Git behavior", () => {
  it("disables create-next-app Git initialization", () => {
    const args = getNextAppCreateArgs("web", false, "pnpm");

    assert.equal(args.filter((arg) => arg === "--disable-git").length, 1);
  });

  it("rejects names that can escape the generated workspace directory", () => {
    assert.match(getWorkspaceNameError("../outside") ?? "", /single lowercase folder name/);
    assert.match(getWorkspaceNameError("nested/app") ?? "", /single lowercase folder name/);
    assert.match(getWorkspaceNameError("/absolute") ?? "", /single lowercase folder name/);
    assert.equal(getWorkspaceNameError("web-app"), undefined);
  });

  it("initializes the monorepo root on main and tracks app files from that root", async () => {
    const projectDir = await createTemporaryDirectory();
    const appDir = join(projectDir, "apps", "web");
    await mkdir(appDir, { recursive: true });
    await writeFile(join(appDir, "page.tsx"), "export default function Page() {}\n");

    const result = await initializeGitRepository(projectDir);
    const { stdout: branch } = await execa("git", ["symbolic-ref", "--short", "HEAD"], {
      cwd: projectDir,
    });
    const { stdout: dryRun } = await execa("git", ["add", "--dry-run", "."], {
      cwd: projectDir,
    });

    assert.equal(result.initialized, true);
    assert.equal(branch, "main");
    assert.match(dryRun, /apps\/web\/page\.tsx/);
  });

  it("removes Git metadata only from the newly generated app", async () => {
    const projectDir = await createTemporaryDirectory();
    const rootGitMarker = join(projectDir, ".git", "root-marker");
    const appDir = join(projectDir, "apps", "web");
    const appGitDirectory = join(appDir, ".git");
    await mkdir(join(projectDir, ".git"), { recursive: true });
    await mkdir(appGitDirectory, { recursive: true });
    await writeFile(rootGitMarker, "root\n");

    await removeGeneratedAppGitMetadata(projectDir, "web");

    await access(rootGitMarker);
    await assert.rejects(access(appGitDirectory));
  });

  it("rejects traversal without touching an outside repository", async () => {
    const temporaryRoot = await createTemporaryDirectory();
    const projectDir = join(temporaryRoot, "project");
    const outsideGitMarker = join(temporaryRoot, "outside", ".git", "marker");
    await mkdir(join(projectDir, "apps"), { recursive: true });
    await mkdir(join(temporaryRoot, "outside", ".git"), { recursive: true });
    await writeFile(outsideGitMarker, "outside\n");

    await assert.rejects(
      removeGeneratedAppGitMetadata(projectDir, "../outside"),
      /inside the apps directory/,
    );

    await access(outsideGitMarker);
  });

  it("rejects a pre-existing app target without touching its repository", async () => {
    const projectDir = await createTemporaryDirectory();
    const existingGitMarker = join(projectDir, "apps", "web", ".git", "marker");
    await mkdir(join(projectDir, "apps", "web", ".git"), { recursive: true });
    await writeFile(existingGitMarker, "existing\n");

    await assert.rejects(
      assertGeneratedAppTargetAvailable(projectDir, "web"),
      /already exists/,
    );

    await access(existingGitMarker);
  });

  it("returns recovery guidance when root initialization fails", async () => {
    const missingDirectory = join(await createTemporaryDirectory(), "missing");

    const result = await initializeGitRepository(missingDirectory);

    assert.equal(result.initialized, false);
    assert.match(result.warning ?? "", /git init -b main/);
  });
});

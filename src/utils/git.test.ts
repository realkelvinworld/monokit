import { access, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";

import { initializeGitRepository, removeGeneratedAppGitMetadata } from "./git.js";
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

    await removeGeneratedAppGitMetadata(appDir);

    await access(rootGitMarker);
    await assert.rejects(access(appGitDirectory));
  });

  it("returns recovery guidance when root initialization fails", async () => {
    const missingDirectory = join(await createTemporaryDirectory(), "missing");

    const result = await initializeGitRepository(missingDirectory);

    assert.equal(result.initialized, false);
    assert.match(result.warning ?? "", /git init -b main/);
  });
});

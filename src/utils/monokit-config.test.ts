import { mkdtemp, rm } from "node:fs/promises";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createMonokitConfig,
  readMonokitConfig,
  setAppShadcnMode,
  writeMonokitConfig,
} from "./monokit-config.js";

const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "monokit-config-test-"));
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

describe("Monokit project metadata", () => {
  it("records shadcn ownership for generated apps", async () => {
    const projectDir = await createTemporaryDirectory();
    const config = createMonokitConfig(["web", "dashboard"], "shared");

    await writeMonokitConfig(projectDir, config);

    assert.deepEqual(await readMonokitConfig(projectDir), {
      schemaVersion: 1,
      shadcn: {
        apps: {
          web: "shared",
          dashboard: "shared",
        },
      },
    });
  });

  it("updates one app without changing existing ownership", async () => {
    const projectDir = await createTemporaryDirectory();
    await writeMonokitConfig(projectDir, createMonokitConfig(["web"], "shared"));

    await setAppShadcnMode(projectDir, "admin", "per-app");

    assert.deepEqual((await readMonokitConfig(projectDir))?.shadcn.apps, {
      web: "shared",
      admin: "per-app",
    });
  });
});

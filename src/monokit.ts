#!/usr/bin/env node
import { getNodeVersionError } from "./utils/node-version.js";

async function main(): Promise<void> {
  const versionError = getNodeVersionError(process.versions.node);
  if (versionError) {
    console.error(versionError);
    process.exitCode = 1;
    return;
  }

  const { runMonokit } = await import("./monokit-main.js");
  await runMonokit();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

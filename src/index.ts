#!/usr/bin/env node
import { getNodeVersionError } from "./utils/node-version.js";

async function main(): Promise<void> {
  const versionError = getNodeVersionError(process.versions.node);
  if (versionError) {
    console.error(versionError);
    process.exitCode = 1;
    return;
  }

  const [{ add }, { scaffold }, { isMonorepo }] = await Promise.all([
    import("./add.js"),
    import("./scaffold.js"),
    import("./utils/detect.js"),
  ]);
  const cwd = process.cwd();

  if (isMonorepo(cwd)) {
    await add(cwd);
    return;
  }

  await scaffold(cwd);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

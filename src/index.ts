#!/usr/bin/env node
import { isMonorepo } from "./utils/detect.js";
import { scaffold } from "./scaffold.js";
import { add } from "./add.js";

async function main() {
  const cwd = process.cwd();

  if (isMonorepo(cwd)) {
    await add(cwd);
    return;
  }

  await scaffold(cwd);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

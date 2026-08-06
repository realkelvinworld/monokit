import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { rootPackageJson } from "../templates/root.js";
import {
  MINIMUM_NODE_VERSION,
  SUPPORTED_NODE_RANGE,
  getNodeVersionError,
  isNodeVersionSupported,
} from "./node-version.js";

describe("Node.js runtime support", () => {
  it("rejects versions below the minimum", () => {
    assert.equal(isNodeVersionSupported("18.20.8"), false);
    assert.equal(isNodeVersionSupported("22.11.99"), false);
  });

  it("accepts the minimum and newer versions", () => {
    assert.equal(isNodeVersionSupported(MINIMUM_NODE_VERSION), true);
    assert.equal(isNodeVersionSupported("22.12.1"), true);
    assert.equal(isNodeVersionSupported("24.7.0"), true);
    assert.equal(isNodeVersionSupported("26.0.0"), true);
  });

  it("handles normalized prefixes and rejects prerelease versions", () => {
    assert.equal(isNodeVersionSupported("v22.12.0"), true);
    assert.equal(isNodeVersionSupported("22.12.0-rc.1"), false);
  });

  it("rejects malformed versions safely", () => {
    assert.equal(isNodeVersionSupported("22.12"), false);
    assert.equal(isNodeVersionSupported("unknown"), false);
    assert.equal(isNodeVersionSupported(""), false);
    assert.equal(isNodeVersionSupported("900719925474099999999.0.0"), false);
  });

  it("returns actionable guidance for unsupported versions", () => {
    const message = getNodeVersionError("18.20.8");

    assert.match(message ?? "", /requires Node\.js 22\.12\.0 or newer/);
    assert.match(message ?? "", /Detected: Node\.js 18\.20\.8/);
    assert.match(message ?? "", /monokit-cli@0\.1\.5/);
    assert.equal(getNodeVersionError("24.7.0"), null);
  });

  it("keeps published and generated engine ranges synchronized", () => {
    const packagePath = new URL("../../package.json", import.meta.url);
    const monokitPackage = JSON.parse(readFileSync(packagePath, "utf-8")) as {
      engines?: { node?: string };
      version?: string;
    };
    const generatedPackage = rootPackageJson("example");

    assert.equal(monokitPackage.version, "0.2.2");
    assert.equal(monokitPackage.engines?.node, SUPPORTED_NODE_RANGE);
    assert.equal(generatedPackage.engines.node, SUPPORTED_NODE_RANGE);
  });

  it("keeps both executable entry points dependency-free until the preflight passes", () => {
    const entryPoints = ["../index.ts", "../monokit.ts"];

    for (const entryPoint of entryPoints) {
      const source = readFileSync(new URL(entryPoint, import.meta.url), "utf-8");
      const staticImports = source.match(/^import .+;$/gm) ?? [];
      const preflightIndex = source.indexOf("const versionError = getNodeVersionError");
      const dynamicImportIndex = source.indexOf("import(");

      assert.deepEqual(staticImports, [
        'import { getNodeVersionError } from "./utils/node-version.js";',
      ]);
      assert.ok(preflightIndex !== -1);
      assert.ok(dynamicImportIndex > preflightIndex);
    }
  });
});

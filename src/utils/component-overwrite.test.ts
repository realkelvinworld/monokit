import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getAppComponentCandidates,
  getShadcnAddArgs,
} from "./component-overwrite.js";

describe("shadcn component overwrite safety", () => {
  it("does not request overwrite for a new component", () => {
    assert.deepEqual(getShadcnAddArgs("button", false), [
      "shadcn@latest",
      "add",
      "button",
      "--yes",
    ]);
  });

  it("requests overwrite only after the caller confirms an existing component", () => {
    assert.deepEqual(getShadcnAddArgs("button", true), [
      "shadcn@latest",
      "add",
      "button",
      "--yes",
      "--overwrite",
    ]);
  });

  it("checks both supported app component locations", () => {
    assert.deepEqual(getAppComponentCandidates("/repo/apps/web", "button"), [
      "/repo/apps/web/components/ui/button.tsx",
      "/repo/apps/web/src/components/ui/button.tsx",
    ]);
  });
});

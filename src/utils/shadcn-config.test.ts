import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  findShadcnConfigDrift,
  findShadcnPrimitiveDependencyDrift,
  inferShadcnPrimitive,
  listShadcnPrimitiveDependencies,
  projectShadcnConfig,
  stripShadcnPrimitiveDependencies,
} from "./shadcn-config.js";

describe("shared shadcn configuration", () => {
  it("projects the selected design into a workspace without copying its paths", () => {
    const selectedConfig = {
      $schema: "https://ui.shadcn.com/schema.json",
      style: "base-nova",
      rsc: true,
      tsx: true,
      tailwind: {
        config: "",
        css: "app/globals.css",
        baseColor: "neutral",
        cssVariables: true,
        prefix: "",
      },
      iconLibrary: "lucide",
      aliases: {
        components: "@/components",
        utils: "@/lib/utils",
        ui: "@/components/ui",
        lib: "@/lib",
        hooks: "@/hooks",
      },
      rtl: false,
      menuColor: "default",
      menuAccent: "subtle",
      registries: { "@company": "https://example.com/{name}.json" },
    };

    const projected = projectShadcnConfig(selectedConfig, {
      rsc: false,
      tailwindCss: "../tailwind-config/globals.css",
      aliases: {
        components: "src",
        utils: "src/utils",
        ui: "src",
        lib: "src",
        hooks: "src/hooks",
      },
    });

    assert.equal(projected.style, "base-nova");
    assert.equal(projected.iconLibrary, "lucide");
    assert.equal(projected.rtl, false);
    assert.equal(projected.menuColor, "default");
    assert.equal(projected.menuAccent, "subtle");
    assert.deepEqual(projected.registries, selectedConfig.registries);
    assert.deepEqual(projected.tailwind, {
      config: "",
      css: "../tailwind-config/globals.css",
      baseColor: "neutral",
      cssVariables: true,
      prefix: "",
    });
    assert.deepEqual(projected.aliases, {
      components: "src",
      utils: "src/utils",
      ui: "src",
      lib: "src",
      hooks: "src/hooks",
    });
    assert.equal(projected.rsc, false);
  });

  it("reports shared design drift but ignores workspace-specific paths", () => {
    const canonical = {
      style: "base-nova",
      iconLibrary: "phosphor",
      tailwind: {
        config: "",
        css: "../tailwind-config/globals.css",
        baseColor: "neutral",
        cssVariables: true,
        prefix: "ui-",
      },
      aliases: { ui: "src" },
      registries: { "@company": "https://example.com/{name}.json" },
    };
    const appConfig = {
      ...canonical,
      style: "radix-nova",
      tailwind: {
        ...canonical.tailwind,
        css: "src/index.css",
      },
      aliases: { ui: "@/components/ui" },
    };

    assert.deepEqual(findShadcnConfigDrift(canonical, appConfig), ["style"]);
  });

  it("infers the primitive layer from current and legacy styles", () => {
    assert.equal(inferShadcnPrimitive("base-nova"), "base");
    assert.equal(inferShadcnPrimitive("radix-nova"), "radix");
    assert.equal(inferShadcnPrimitive("aria-nova"), "aria");
    assert.equal(inferShadcnPrimitive("new-york"), "radix");
    assert.equal(inferShadcnPrimitive("unknown-style"), "unknown");
  });

  it("can remove primitive packages during an approved migration without touching unrelated dependencies", () => {
    const packageJson = {
      dependencies: {
        "@base-ui/react": "latest",
        "@radix-ui/react-slot": "latest",
        "react-aria-components": "latest",
        "radix-ui": "latest",
        "lucide-react": "latest",
        react: "latest",
      },
    };

    assert.deepEqual(stripShadcnPrimitiveDependencies(packageJson), {
      dependencies: {
        "lucide-react": "latest",
        react: "latest",
      },
    });
  });

  it("reports primitive dependencies that conflict with the selected style", () => {
    assert.deepEqual(
      findShadcnPrimitiveDependencyDrift(
        { style: "base-nova" },
        {
          dependencies: {
            "@base-ui/react": "latest",
            "radix-ui": "latest",
            react: "latest",
          },
        },
      ),
      ["radix-ui"],
    );
  });

  it("lists primitive packages without including unrelated dependencies", () => {
    assert.deepEqual(
      listShadcnPrimitiveDependencies({
        dependencies: {
          "@base-ui/react": "latest",
          "lucide-react": "latest",
        },
        devDependencies: { "react-aria-components": "latest" },
      }),
      ["@base-ui/react", "react-aria-components"],
    );
  });
});

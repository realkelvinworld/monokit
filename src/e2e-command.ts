import * as p from "@clack/prompts";
import fs from "fs-extra";
import { join } from "path";
import pc from "picocolors";

import { run } from "./utils/exec.js";
import { type PackageManager, detectProjectPackageManager } from "./utils/pm.js";

// ─── Templates ────────────────────────────────────────────────────────────────

const playwrightConfig = `import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
`;

const sampleSpec = `import { test, expect } from "@playwright/test";

test("homepage loads", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/.+/);
});
`;

// ─── Install helper ───────────────────────────────────────────────────────────

async function installRootDev(
  pm: PackageManager,
  packages: string[],
  cwd: string,
): Promise<void> {
  if (pm === "pnpm") {
    await run("pnpm", ["add", "-D", "-w", ...packages], cwd);
    return;
  }
  if (pm === "bun") {
    await run("bun", ["add", "-D", ...packages], cwd);
    return;
  }
  if (pm === "yarn") {
    await run("yarn", ["add", "-D", "-W", ...packages], cwd);
    return;
  }
  // npm
  await run("npm", ["install", "-D", ...packages], cwd);
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init(cwd: string): Promise<void> {
  p.intro(pc.bgCyan(pc.black(" monokit e2e init ")));

  const pm = await detectProjectPackageManager(cwd);
  const s = p.spinner();

  // 1 — install @playwright/test at root
  s.start("Installing @playwright/test");
  await installRootDev(pm, ["@playwright/test"], cwd);
  s.stop("@playwright/test installed");

  // 2 — install chromium browser
  s.start("Installing Playwright browsers (chromium)");
  await run("npx", ["playwright", "install", "chromium", "--with-deps"], cwd);
  s.stop("Browser installed");

  // 3 — write playwright.config.ts at repo root
  const configPath = join(cwd, "playwright.config.ts");
  if (!fs.existsSync(configPath)) {
    s.start("Writing playwright.config.ts");
    await fs.writeFile(configPath, playwrightConfig, "utf-8");
    s.stop("playwright.config.ts written");
  } else {
    p.log.warn("playwright.config.ts already exists — skipped");
  }

  // 4 — create tests/e2e/ with a sample spec
  const e2eDir = join(cwd, "tests/e2e");
  const samplePath = join(e2eDir, "example.spec.ts");
  if (!fs.existsSync(samplePath)) {
    s.start("Creating sample spec");
    await fs.ensureDir(e2eDir);
    await fs.writeFile(samplePath, sampleSpec, "utf-8");
    s.stop("Sample spec created at tests/e2e/example.spec.ts");
  }

  // 5 — add e2e script to root package.json
  s.start("Adding e2e script to root package.json");
  const pkgPath = join(cwd, "package.json");
  const pkg = await fs.readJson(pkgPath);
  pkg.scripts = pkg.scripts ?? {};
  if (!pkg.scripts.e2e) {
    pkg.scripts.e2e = "playwright test";
    pkg.scripts["e2e:ui"] = "playwright test --ui";
    pkg.scripts["e2e:report"] = "playwright show-report";
    await fs.writeJson(pkgPath, pkg, { spaces: 2 });
    s.stop("e2e scripts added");
  } else {
    s.stop("e2e script already exists — skipped");
  }

  p.outro(
    pc.green("Done! ") +
      pc.dim(`Start your app, then run ${pc.white("monokit e2e")} to run your tests.`),
  );
}

// ─── Run ──────────────────────────────────────────────────────────────────────

async function runE2e(cwd: string, args: string[]): Promise<void> {
  p.intro(pc.bgCyan(pc.black(" monokit e2e ")));

  const configPath = join(cwd, "playwright.config.ts");
  if (!fs.existsSync(configPath)) {
    p.cancel(
      `No playwright.config.ts found at repo root. Run ${pc.white("monokit e2e init")} first.`,
    );
    process.exit(1);
  }

  // Strip monokit-only flags; everything else passes through to playwright
  const passthroughArgs = args.filter((a) => a !== "--ui" || a);

  p.log.info("Running Playwright tests…");
  await run("npx", ["playwright", "test", ...passthroughArgs], cwd);

  p.outro(pc.green("Done!"));
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function e2eCommand(cwd: string, args: string[]): Promise<void> {
  const subcommand = args[0];

  if (subcommand === "init") {
    await init(cwd);
  } else {
    await runE2e(cwd, args);
  }
}

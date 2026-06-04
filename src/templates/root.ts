export const turboJson = {
  $schema: "https://turborepo.dev/schema.json",
  ui: "tui",
  tasks: {
    build: {
      dependsOn: ["^build"],
      inputs: ["$TURBO_DEFAULT$", ".env*"],
      outputs: [".next/**", "!.next/cache/**", "dist/**"],
    },
    lint: {
      dependsOn: ["^lint"],
    },
    "check-types": {
      dependsOn: ["^check-types"],
    },
    test: {
      dependsOn: ["^build"],
      inputs: ["$TURBO_DEFAULT$"],
      outputs: ["coverage/**"],
    },
    dev: {
      cache: false,
      persistent: true,
    },
  },
};

export const pnpmWorkspace = `packages:
  - "apps/*"
  - "packages/*"
`;

export const prettierConfig = {
  semi: true,
  singleQuote: false,
  tabWidth: 2,
  trailingComma: "es5",
  printWidth: 100,
  plugins: ["prettier-plugin-tailwindcss"],
};

export const prettierIgnore = `# dependencies
node_modules

# build outputs
.next
dist
.turbo

# generated
*.lock
pnpm-lock.yaml

# env
.env*
`;

export const gitIgnore = `# dependencies
node_modules

# build outputs
.next
dist
.turbo

# env files — never commit secrets
.env
.env.local
.env*.local

# OS
.DS_Store
*.local

# test coverage
coverage

# editor
.vscode/extensions.json
`;


type PackageManager = "pnpm" | "npm" | "yarn" | "bun";

export const rootPackageJson = (
  name: string,
  pm: PackageManager = "pnpm",
  pmVersion?: string,
  appNames: string[] = [],
) => {
  // Per-app scripts let you start or build one app at a time from the root.
  // Add more as you add apps: "dev:my-app": "turbo run dev --filter=my-app"
  const perAppScripts: Record<string, string> = {};
  for (const appName of appNames) {
    perAppScripts[`dev:${appName}`] = `turbo run dev --filter=${appName}`;
    perAppScripts[`build:${appName}`] = `turbo run build --filter=${appName}`;
  }

  return {
    name,
    private: true,
    ...(pm !== "pnpm" ? { workspaces: ["apps/*", "packages/*"] } : {}),
    ...(pmVersion ? { packageManager: pmVersion } : {}),
    scripts: {
      build: "turbo run build",
      dev: "turbo run dev",
      ...perAppScripts,
      lint: "turbo run lint",
      test: "turbo run test",
      format: 'prettier --write "**/*.{ts,tsx,md}"',
      "check-types": "turbo run check-types",
    },
    devDependencies: {
      "tw-animate-css": "^1.2.9",
      tailwindcss: "^4",
      prettier: "^3.7.4",
      "prettier-plugin-tailwindcss": "^0.6.0",
      turbo: "^2.9.14",
      typescript: "5.9.2",
    },
    engines: {
      node: ">=18",
    },
  };
};

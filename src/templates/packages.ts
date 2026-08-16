export const tailwindConfigCss = `@import "tailwindcss";

@source "../ui/src";

@custom-variant dark (&:is(.dark *));
`;

export const tailwindConfigPackageJson = {
  name: "@repo/tailwind-config",
  version: "0.0.0",
  private: true,
  exports: {
    "./globals.css": "./globals.css",
  },
};

export const uiPackageJson = (workspaceDep: string) => ({
  name: "@repo/ui",
  version: "0.0.0",
  private: true,
  exports: {
    ".": "./src/index.ts",
  },
  dependencies: {
    "class-variance-authority": "^0.7.1",
    clsx: "^2.1.1",
    react: "^19.2.0",
    "react-dom": "^19.2.0",
    "tailwind-merge": "^3.6.0",
  },
  devDependencies: {
    "@repo/typescript-config": workspaceDep,
    "@types/react": "^19.2.0",
    "@types/react-dom": "^19.2.0",
    typescript: "5.9.2",
  },
});

export const uiUtils = `import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
`;

export const uiIndex = `export { cn } from "./utils";
`;

export const uiTsConfig = {
  extends: "@repo/typescript-config/react-library.json",
  compilerOptions: {
    outDir: "dist",
    strictNullChecks: true,
  },
  include: ["src"],
  exclude: ["node_modules", "dist"],
};

// --- eslint-config ---

export const eslintConfigPackageJson = {
  name: "@repo/eslint-config",
  version: "0.0.0",
  private: true,
  exports: {
    "./base": "./base.js",
    "./next": "./next.js",
    "./react-library": "./react-library.js",
  },
  dependencies: {
    "@eslint/js": "^9.0.0",
    "typescript-eslint": "^8.0.0",
    "eslint-plugin-react-hooks": "^5.0.0",
    "eslint-plugin-react-refresh": "^0.4.0",
  },
};

export const eslintBase = `import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  }
);
`;

export const eslintNext = `import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";
import baseConfig from "./base.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

export default [
  ...baseConfig,
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];
`;

export const eslintReactLibrary = `import baseConfig from "./base.js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default [
  ...baseConfig,
  {
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
];
`;

export const tsConfigPackageJson = {
  name: "@repo/typescript-config",
  version: "0.0.0",
  private: true,
  license: "MIT",
};

export const tsConfigBase = {
  $schema: "https://json.schemastore.org/tsconfig",
  compilerOptions: {
    declaration: true,
    declarationMap: true,
    esModuleInterop: true,
    incremental: false,
    isolatedModules: true,
    lib: ["es2022", "DOM", "DOM.Iterable"],
    module: "NodeNext",
    moduleDetection: "force",
    moduleResolution: "NodeNext",
    noUncheckedIndexedAccess: true,
    resolveJsonModule: true,
    skipLibCheck: true,
    strict: true,
    target: "ES2022",
  },
};

export const tsConfigNextJs = {
  $schema: "https://json.schemastore.org/tsconfig",
  extends: "./base.json",
  compilerOptions: {
    plugins: [{ name: "next" }],
    module: "ESNext",
    moduleResolution: "Bundler",
    allowJs: true,
    jsx: "preserve",
    noEmit: true,
    strictNullChecks: true,
  },
};

export const tsConfigReactLibrary = {
  $schema: "https://json.schemastore.org/tsconfig",
  extends: "./base.json",
  compilerOptions: {
    jsx: "react-jsx",
  },
};

export const tsConfigVite = {
  $schema: "https://json.schemastore.org/tsconfig",
  extends: "./base.json",
  compilerOptions: {
    module: "ESNext",
    moduleResolution: "bundler",
    jsx: "react-jsx",
    noEmit: true,
    allowImportingTsExtensions: true,
    verbatimModuleSyntax: true,
    types: ["vite/client"],
  },
};

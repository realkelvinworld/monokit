import fs from "fs-extra";
import { join } from "path";

export async function writeFile(
  cwd: string,
  filePath: string,
  content: string,
): Promise<void> {
  const fullPath = join(cwd, filePath);
  await fs.ensureDir(join(fullPath, ".."));
  await fs.writeFile(fullPath, content, "utf-8");
}

export async function writeJson(
  cwd: string,
  filePath: string,
  data: object,
): Promise<void> {
  const fullPath = join(cwd, filePath);
  await fs.ensureDir(join(fullPath, ".."));
  await fs.writeJson(fullPath, data, { spaces: 2 });
}

export async function mergeJson(
  cwd: string,
  filePath: string,
  data: object,
): Promise<void> {
  const fullPath = join(cwd, filePath);
  const existing = await fs.readJson(fullPath);
  const merged = JSON.parse(JSON.stringify(existing));
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "object" && !Array.isArray(value) && merged[key]) {
      merged[key] = { ...merged[key], ...value };
    } else {
      merged[key] = value;
    }
  }
  await fs.writeJson(fullPath, merged, { spaces: 2 });
}

export async function replaceInFile(
  cwd: string,
  filePath: string,
  search: string,
  replace: string,
): Promise<void> {
  const fullPath = join(cwd, filePath);
  const content = await fs.readFile(fullPath, "utf-8");
  await fs.writeFile(fullPath, content.replace(search, replace), "utf-8");
}

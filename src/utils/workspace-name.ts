export function getWorkspaceNameError(name: string): string | undefined {
  if (!name) return "Name is required";
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(name)) {
    return "Use a single lowercase folder name with letters, numbers, hyphens, or underscores";
  }

  return undefined;
}

export const MINIMUM_NODE_VERSION = "22.12.0";
export const SUPPORTED_NODE_RANGE = `>=${MINIMUM_NODE_VERSION}`;

type ParsedVersion = readonly [major: number, minor: number, patch: number];

function parseNodeVersion(version: string): ParsedVersion | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!match) return null;

  const parsed = [Number(match[1]), Number(match[2]), Number(match[3])] as const;
  if (parsed.some((part) => !Number.isSafeInteger(part))) return null;

  return parsed;
}

export function isNodeVersionSupported(version: string): boolean {
  const current = parseNodeVersion(version);
  const minimum = parseNodeVersion(MINIMUM_NODE_VERSION);
  if (!current || !minimum) return false;

  for (let index = 0; index < current.length; index++) {
    if (current[index]! > minimum[index]!) return true;
    if (current[index]! < minimum[index]!) return false;
  }

  return true;
}

export function getNodeVersionError(version: string): string | null {
  if (isNodeVersionSupported(version)) return null;

  return [
    `Monokit requires Node.js ${MINIMUM_NODE_VERSION} or newer.`,
    `Detected: Node.js ${version}`,
    "",
    "Upgrade Node.js using your preferred version manager, then retry.",
    "To restore the legacy Node.js 18 release, run:",
    "npm install -g monokit-cli@0.1.5",
  ].join("\n");
}

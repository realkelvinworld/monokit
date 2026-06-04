import { execa } from "execa";

export async function run(
  command: string,
  args: string[],
  cwd: string = process.cwd(),
): Promise<void> {
  await execa(command, args, { cwd, stdio: "inherit" });
}

// Used for commands that show interactive prompts we want to auto-dismiss.
// Piping stdin (non-TTY) causes @clack/prompts to skip prompts; we also
// send "n\n" as a fallback for prompts that still read from stdin.
export async function runNonInteractive(
  command: string,
  args: string[],
  cwd: string = process.cwd(),
): Promise<void> {
  const subprocess = execa(command, args, {
    cwd,
    stdio: ["pipe", "inherit", "inherit"],
  });
  subprocess.stdin?.write("n\n");
  subprocess.stdin?.end();
  await subprocess;
}

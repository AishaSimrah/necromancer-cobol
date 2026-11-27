import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT: string = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Runs the frontend build steps in order. Stops at the first runner that throws. */
export function runBuild(run: (command: string) => void): void {
  run("npm run build:frontend");
  run("npm run build:fonts");
}

function execInRepo(command: string): void {
  try {
    execSync(command, { cwd: REPO_ROOT, stdio: "inherit" });
  } catch (cause) {
    const detail: string = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Frontend build step failed: ${command} (${detail})`, { cause });
  }
}

export default function setup(): void {
  runBuild(execInRepo);
}

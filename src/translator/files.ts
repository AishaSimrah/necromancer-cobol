import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const cache = new Map<string, string>();

/** Resolve a repo-relative path from this module's location (never from the cwd). */
export function repoPath(relative: string): string {
  return fileURLToPath(new URL("../../" + relative, import.meta.url));
}

function causeMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Read a repo text file once per process. Throws with `what` and the resolved path on failure. */
export function readRepoText(relative: string, what: string): string {
  const resolved = repoPath(relative);
  const cached = cache.get(resolved);
  if (cached !== undefined) return cached;
  let text: string;
  try {
    text = readFileSync(resolved, "utf8");
  } catch (cause: unknown) {
    throw new Error(`Cannot read ${what} at ${resolved}: ${causeMessage(cause)}`, { cause });
  }
  cache.set(resolved, text);
  return text;
}

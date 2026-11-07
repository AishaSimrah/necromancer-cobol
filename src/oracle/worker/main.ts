/**
 * Worker entry point. Frames go over stdin/stdout; logs go to stderr only.
 * Usage: node worker.js --policy <base64 JSON> [--work-root /work]
 */

import { mkdir } from "node:fs/promises";
import type { Logger, SandboxPolicy } from "../config.js";
import { DEFAULT_CONFIG } from "../config.js";
import { serve } from "./server.js";
import { RealChildSpawner } from "./spawner.js";
import { RealWorkFs } from "./workfs.js";

function makeLogger(): Logger {
  const write =
    (level: string) =>
    (message: string, fields?: Readonly<Record<string, unknown>>): void => {
      const suffix = fields === undefined ? "" : ` ${JSON.stringify(fields)}`;
      process.stderr.write(`[worker ${level}] ${message}${suffix}\n`);
    };
  return { debug: write("debug"), info: write("info"), warn: write("warn"), error: write("error") };
}

function argValue(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

function parsePolicy(b64: string | undefined): SandboxPolicy {
  if (b64 === undefined) return DEFAULT_CONFIG.sandbox;
  const parsed: unknown = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("--policy must decode to a JSON object");
  }
  return parsed as SandboxPolicy;
}

async function main(): Promise<void> {
  const logger = makeLogger();
  const argv = process.argv.slice(2);
  const policy = parsePolicy(argValue(argv, "--policy"));
  const workRoot = argValue(argv, "--work-root") ?? "/work";
  await mkdir(workRoot, { recursive: true });

  await serve(
    {
      input: process.stdin as AsyncIterable<Buffer>,
      output: (chunk: Buffer): void => {
        process.stdout.write(chunk);
      },
    },
    { spawner: new RealChildSpawner(), fs: new RealWorkFs(workRoot, logger), policy, logger },
  );
}

main().then(
  () => {
    // Let stdout flush, then exit 0 (shutdown or input EOF; dirs already removed).
    process.stdout.write("", () => process.exit(0));
  },
  (err: unknown) => {
    process.stderr.write(`[worker error] fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  },
);

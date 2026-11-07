/**
 * Child process spawner: the only Worker module that touches child_process.
 * Phase A scope: detached process group, piped stdio, EPIPE-safe stdin,
 * capped capture, timeout and output-cap kills, wait for `close`.
 * Task 5.4 adds the `kill -9 -1` sweep and enforces the sandbox identity.
 */

import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { appendCapped } from "../capture.js";
import type { Capture } from "../capture.js";

export interface SpawnSpec {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  /** Slot identity. Optional until Task 5.4; passed to spawn when given. */
  readonly uid?: number;
  readonly gid?: number;
  /** Replaces the environment when given (never merged with process.env). */
  readonly env?: Readonly<Record<string, string>>;
  readonly stdin: Buffer;
  readonly timeoutMs: number;
  readonly outputLimitBytes: number;
}

export type ChildEndedBy = "exit" | "timeout" | "output_limit" | "spawn_error";

export interface ChildTermination {
  readonly stdout: Buffer;
  readonly stderr: Buffer;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly endedBy: ChildEndedBy;
  readonly truncated: boolean;
  readonly durationMs: number;
}

export interface ChildSpawner {
  run(spec: SpawnSpec): Promise<ChildTermination>;
}

const EMPTY: Capture = { bytes: Buffer.alloc(0), truncated: false };

/** Kills the whole process group led by `pid`; ignores already-gone groups. */
function killGroup(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // group already gone
  }
}

export class RealChildSpawner implements ChildSpawner {
  run(spec: SpawnSpec): Promise<ChildTermination> {
    return new Promise<ChildTermination>((resolve) => {
      const started = Date.now();
      let stdout: Capture = EMPTY;
      let stderr: Capture = EMPTY;
      let endedBy: ChildEndedBy = "exit";
      let killed = false;
      let settled = false;
      const timers: NodeJS.Timeout[] = [];

      const finish = (
        exitCode: number | null,
        signal: string | null,
        reason: ChildEndedBy,
      ): void => {
        if (settled) return;
        settled = true;
        for (const t of timers) clearTimeout(t);
        resolve({
          stdout: stdout.bytes,
          stderr: stderr.bytes,
          exitCode,
          signal,
          endedBy: reason,
          truncated: stdout.truncated || stderr.truncated,
          durationMs: Date.now() - started,
        });
      };

      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(spec.command, [...spec.args], {
          cwd: spec.cwd,
          detached: true,
          stdio: ["pipe", "pipe", "pipe"],
          ...(spec.env !== undefined ? { env: { ...spec.env } } : {}),
          ...(spec.uid !== undefined ? { uid: spec.uid } : {}),
          ...(spec.gid !== undefined ? { gid: spec.gid } : {}),
        });
      } catch {
        finish(null, null, "spawn_error");
        return;
      }

      const kill = (reason: "timeout" | "output_limit"): void => {
        if (killed) return;
        killed = true;
        endedBy = reason;
        killGroup(child.pid);
      };

      child.on("error", () => {
        // Failure to start (ENOENT, EACCES...) never produces `close` with a pid.
        if (child.pid === undefined) finish(null, null, "spawn_error");
      });

      // The child may exit before reading stdin; EPIPE must not crash the Worker.
      child.stdin.on("error", () => undefined);
      try {
        child.stdin.end(spec.stdin);
      } catch {
        // ignore synchronous stdin failures
      }

      child.stdout.on("data", (chunk: Buffer) => {
        stdout = appendCapped(stdout, chunk, spec.outputLimitBytes);
        if (stdout.truncated) kill("output_limit");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = appendCapped(stderr, chunk, spec.outputLimitBytes);
        if (stderr.truncated) kill("output_limit");
      });

      timers.push(setTimeout(() => kill("timeout"), spec.timeoutMs));

      child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
        finish(code, signal, endedBy);
      });
    });
  }
}

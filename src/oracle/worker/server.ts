/**
 * Worker protocol server (Phase A). Transport-agnostic: takes an async
 * iterable of input bytes and an output write function.
 * Phase A scope: no slots, prlimit, uid separation, env allowlist handling
 * beyond a fixed env from policy.env, or cobc version probing.
 */

import { join } from "node:path";
import { encodeStdin } from "../capture.js";
import type { Logger, SandboxPolicy } from "../config.js";
import { encodeFrame, FrameDecoder } from "../framing.js";
import type {
  RawOutcomeFields,
  WorkerRequest,
  WorkerResponse,
} from "../protocol.js";
import type { ChildSpawner, ChildTermination } from "./spawner.js";
import { PROGRAM_FILE, SOURCE_FILE } from "./workfs.js";
import type { WorkFs } from "./workfs.js";

export interface ServeIo {
  readonly input: AsyncIterable<Buffer>;
  readonly output: (chunk: Buffer) => void;
}

export interface ServeDeps {
  readonly spawner: ChildSpawner;
  readonly fs: WorkFs;
  readonly policy: SandboxPolicy;
  readonly logger: Logger;
}

/** Output cap for compiler output, which the protocol does not carry. */
const COMPILE_OUTPUT_LIMIT_BYTES = 1024 * 1024;

function toOutcome(t: ChildTermination): RawOutcomeFields {
  return {
    stdoutB64: t.stdout.toString("base64"),
    stderrB64: t.stderr.toString("base64"),
    exitCode: t.exitCode,
    signal: t.signal,
    endedBy: t.endedBy,
    limit: null,
    truncated: t.truncated,
    durationMs: t.durationMs,
  };
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isPositiveNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

/** Returns an error message when the request is structurally invalid. */
function checkRequest(req: WorkerRequest): string | null {
  switch (req.type) {
    case "ping":
    case "shutdown":
      return null;
    case "compile":
      if (!isString(req.handleId) || req.handleId === "") return "handleId must be a non-empty string";
      if (!isString(req.source)) return "source must be a string";
      if (!isPositiveNumber(req.timeoutMs)) return "timeoutMs must be a positive number";
      return null;
    case "run":
      if (!isString(req.handleId)) return "handleId must be a string";
      if (!Array.isArray(req.inputLines) || !req.inputLines.every(isString)) {
        return "inputLines must be an array of strings";
      }
      if (!isPositiveNumber(req.timeoutMs)) return "timeoutMs must be a positive number";
      if (!isPositiveNumber(req.outputLimitBytes)) return "outputLimitBytes must be a positive number";
      return null;
    case "release":
      return isString(req.handleId) ? null : "handleId must be a string";
    default:
      return "unknown request type";
  }
}

export async function serve(io: ServeIo, deps: ServeDeps): Promise<void> {
  const { spawner, fs, policy, logger } = deps;
  const handles = new Map<string, string>(); // handleId -> directory
  const allDirs = new Set<string>(); // includes directories of in-flight compiles
  const inflight = new Set<Promise<void>>();
  const decoder = new FrameDecoder();
  let stopping = false;

  const send = (msg: WorkerResponse): void => {
    try {
      io.output(encodeFrame(msg));
    } catch (err) {
      logger.error("failed to write frame", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const fail = (
    id: string,
    code: "unknown_handle" | "bad_request" | "internal",
    message: string,
  ): void => send({ id, type: "error", code, message });

  const env = (cwd: string): Record<string, string> => ({ ...policy.env, HOME: cwd, TMPDIR: cwd });

  const discard = async (dir: string): Promise<void> => {
    allDirs.delete(dir);
    await fs.removeDir(dir);
  };

  const doCompile = async (
    req: Extract<WorkerRequest, { type: "compile" }>,
  ): Promise<void> => {
    if (handles.has(req.handleId)) {
      fail(req.id, "bad_request", `handle already exists: ${req.handleId}`);
      return;
    }
    const dir = await fs.createHandleDir();
    allDirs.add(dir);
    try {
      await fs.writeSource(dir, req.source);
      const term = await spawner.run({
        command: "cobc",
        args: ["-x", "-free", "-o", PROGRAM_FILE, SOURCE_FILE],
        cwd: dir,
        env: env(dir),
        stdin: Buffer.alloc(0),
        timeoutMs: req.timeoutMs,
        outputLimitBytes: COMPILE_OUTPUT_LIMIT_BYTES,
      });
      const outcome = toOutcome(term);
      if (term.endedBy === "exit" && term.exitCode === 0 && !stopping) {
        handles.set(req.handleId, dir);
        send({ id: req.id, type: "compiled", ok: true, handleId: req.handleId, outcome });
        return;
      }
      await discard(dir);
      send({ id: req.id, type: "compiled", ok: false, outcome });
    } catch (err) {
      await discard(dir);
      throw err;
    }
  };

  const doRun = async (req: Extract<WorkerRequest, { type: "run" }>): Promise<void> => {
    const dir = handles.get(req.handleId);
    if (dir === undefined) {
      fail(req.id, "unknown_handle", `unknown handle: ${req.handleId}`);
      return;
    }
    const term = await spawner.run({
      command: join(dir, PROGRAM_FILE),
      args: [],
      cwd: dir,
      env: env(dir),
      stdin: encodeStdin(req.inputLines),
      timeoutMs: req.timeoutMs,
      outputLimitBytes: req.outputLimitBytes,
    });
    send({ id: req.id, type: "ran", outcome: toOutcome(term) });
  };

  const doRelease = async (
    req: Extract<WorkerRequest, { type: "release" }>,
  ): Promise<void> => {
    const dir = handles.get(req.handleId);
    if (dir !== undefined) {
      handles.delete(req.handleId);
      await discard(dir);
    }
    send({ id: req.id, type: "released" });
  };

  const cleanupAll = async (): Promise<void> => {
    handles.clear();
    await Promise.all([...allDirs].map((d) => discard(d)));
  };

  const dispatch = async (req: WorkerRequest): Promise<void> => {
    const problem = checkRequest(req);
    if (problem !== null) {
      fail(isString(req.id) ? req.id : "", "bad_request", problem);
      return;
    }
    switch (req.type) {
      case "ping":
        send({
          id: req.id,
          type: "pong",
          pid: process.pid,
          liveHandles: handles.size,
          busySlots: 0,
        });
        return;
      case "compile":
        return doCompile(req);
      case "run":
        return doRun(req);
      case "release":
        return doRelease(req);
      case "shutdown":
        stopping = true;
        await Promise.allSettled([...inflight]);
        await cleanupAll();
        send({ id: req.id, type: "shutdown_ack" });
        return;
    }
  };

  const track = (req: WorkerRequest): void => {
    const p: Promise<void> = dispatch(req)
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        logger.error("request failed", { type: req.type, error: message });
        fail(isString(req.id) ? req.id : "", "internal", message);
      })
      .finally(() => {
        inflight.delete(p);
      });
    inflight.add(p);
  };

  try {
    for await (const chunk of io.input) {
      let messages: readonly unknown[];
      try {
        messages = decoder.push(chunk);
      } catch (err) {
        logger.error("protocol error, closing", {
          error: err instanceof Error ? err.message : String(err),
        });
        break;
      }
      for (const message of messages) {
        if (stopping) break;
        track(message as WorkerRequest);
      }
      if (stopping) break;
    }
  } finally {
    stopping = true;
    await Promise.allSettled([...inflight]);
    await cleanupAll();
  }
}

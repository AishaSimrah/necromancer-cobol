// Feature: necromancer-server, Property 14: Every Oracle compile call uses the one frozen Shared_Oracle_Config
// Validates: Requirements 10.2, 16.1, 16.2, 16.3, 16.5
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { PartialOracleConfig } from "../../src/oracle/config.js";
import type { CompiledHandle, RunResult } from "../../src/oracle/index.js";
import { createOracleAdapter } from "../../src/server/oracle-adapter.js";
import type { OracleBackend } from "../../src/server/types.js";

interface CompileCall {
  readonly source: string;
  readonly config: PartialOracleConfig | undefined;
}

interface RecordingBackend {
  readonly backend: OracleBackend;
  readonly calls: CompileCall[];
  readonly shutdownCount: () => number;
}

const OK_RESULT: RunResult = {
  status: "environment_error",
  stdout: "",
  stderr: "",
  exitCode: null,
  truncated: false,
  durationMs: 0,
  message: "fake",
};

function makeBackend(): RecordingBackend {
  const calls: CompileCall[] = [];
  let shutdowns = 0;
  const backend: OracleBackend = {
    compileCobol: (source, config) => {
      calls.push({ source, config });
      return Promise.resolve(OK_RESULT);
    },
    runCompiled: () => Promise.resolve(OK_RESULT),
    releaseHandle: () => Promise.resolve(),
    isCompiledHandle: (value): value is CompiledHandle => typeof value === "string",
    shutdown: () => {
      shutdowns += 1;
      return Promise.resolve();
    },
  };
  return { backend, calls, shutdownCount: () => shutdowns };
}

const WORK_ROOT = "/home/app/work";

describe("shared Oracle config (Property 14)", () => {
  it("freezes sharedConfig and workerCommand with the exact worker command", () => {
    const { backend } = makeBackend();
    const adapter = createOracleAdapter({ backend, workRoot: WORK_ROOT });
    expect(Object.isFrozen(adapter.sharedConfig)).toBe(true);
    expect(Object.isFrozen(adapter.sharedConfig.workerCommand)).toBe(true);
    expect(adapter.sharedConfig.workerCommand).toEqual([
      "node",
      "/opt/oracle/worker.js",
      "--work-root",
      WORK_ROOT,
    ]);
  });

  it("passes the identical frozen config on every compile over arbitrary interleavings", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.tuple(fc.boolean(), fc.string()), { minLength: 1, maxLength: 20 }),
        fc.string({ minLength: 1 }),
        async (ops, workRoot) => {
          const { backend, calls } = makeBackend();
          const adapter = createOracleAdapter({ backend, workRoot });
          await Promise.all(
            ops.map(([viaPort, source]) =>
              viaPort ? adapter.port.compileCobol(source) : adapter.compile(source),
            ),
          );
          expect(calls).toHaveLength(ops.length);
          for (const call of calls) {
            expect(call.config).toBeDefined();
            expect(call.config).toBe(adapter.sharedConfig);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("ignores a caller-supplied config on the port", async () => {
    const { backend, calls } = makeBackend();
    const adapter = createOracleAdapter({ backend, workRoot: WORK_ROOT });
    const foreign: PartialOracleConfig = { workerCommand: ["evil"] };
    const widened = adapter.port.compileCobol as (
      source: string,
      config?: PartialOracleConfig,
    ) => Promise<CompiledHandle | RunResult>;
    await widened("IDENTIFICATION DIVISION.", foreign);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.config).toBe(adapter.sharedConfig);
    expect(calls[0]?.config).not.toBe(foreign);
  });

  it("reset() calls backend.shutdown()", async () => {
    const { backend, shutdownCount } = makeBackend();
    const adapter = createOracleAdapter({ backend, workRoot: WORK_ROOT });
    await adapter.reset();
    expect(shutdownCount()).toBe(1);
  });
});

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listTs(full));
    else if (name.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("single compileCobol call site", () => {
  it("has exactly one compileCobol( call in src/server, in oracle-adapter.ts", () => {
    const root = join(process.cwd(), "src", "server");
    const hits: string[] = [];
    for (const file of listTs(root)) {
      const text = readFileSync(file, "utf8");
      // Call sites are member calls; the interface declaration in types.ts has no leading dot.
      const count = (text.match(/\.compileCobol\(/g) ?? []).length;
      for (let i = 0; i < count; i += 1) hits.push(relative(root, file).replace(/\\/g, "/"));
    }
    expect(hits).toEqual(["oracle-adapter.ts"]);
  });
});

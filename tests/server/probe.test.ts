import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CompiledHandle, RunResult, Status } from "../../src/oracle/index.js";
import type { OracleAdapter } from "../../src/server/oracle-adapter.js";
import { createProbe, type ProbeController } from "../../src/server/probe.js";
import type { OracleBackend } from "../../src/server/types.js";
import { getSample } from "../../src/translator/index.js";

const sample = getSample("interest");
const firstExample = sample.examples[0];
if (firstExample === undefined) throw new Error("interest sample has no example");
const EXPECTED_OUTPUT: string = firstExample.output;

const ALL_STATUSES: readonly Status[] = [
  "ok",
  "compile_error",
  "timeout",
  "source_too_large",
  "invalid_request",
  "resource_limit",
  "environment_error",
];
const NON_OK_STATUSES: readonly Status[] = ALL_STATUSES.filter((s) => s !== "ok");

function makeResult(status: Status, stdout: string): RunResult {
  return status === "ok"
    ? { status, stdout, stderr: "", exitCode: 0, truncated: false, durationMs: 1 }
    : {
        status,
        stdout,
        stderr: "",
        exitCode: null,
        truncated: false,
        durationMs: 1,
        message: "scripted",
      };
}

function makeHandle(id: string): CompiledHandle {
  return { id } as unknown as CompiledHandle;
}

type CompileScript =
  | { readonly kind: "handle" }
  | { readonly kind: "result"; readonly status: Status }
  | { readonly kind: "junk"; readonly value: unknown }
  | { readonly kind: "throw" }
  | { readonly kind: "hang" };

type RunScript =
  | { readonly kind: "result"; readonly status: Status; readonly stdout: string }
  | { readonly kind: "throw" }
  | { readonly kind: "late"; readonly delayMs: number };

interface Harness {
  readonly probe: ProbeController;
  readonly logs: string[];
  readonly counts: { compile: number; run: number; release: number; reset: number; issued: number };
  readonly clock: { t: number };
  readonly slot: { taken: boolean };
}

function build(
  compileScript: CompileScript,
  runScript: RunScript,
  opts: { timeoutMs?: number; minIntervalMs?: number; execAllowed?: boolean } = {},
): Harness {
  const counts = { compile: 0, run: 0, release: 0, reset: 0, issued: 0 };
  const logs: string[] = [];
  const clock = { t: 0 };
  const slot = { taken: false };
  const backend: OracleBackend = {
    compileCobol: async () => {
      counts.compile += 1;
      switch (compileScript.kind) {
        case "handle":
          counts.issued += 1;
          return makeHandle(`h${counts.issued}`);
        case "result":
          return makeResult(compileScript.status, "");
        case "junk":
          return compileScript.value as RunResult;
        case "throw":
          throw new Error("boom at C:\\secret\\path\n    at stack frame");
        case "hang":
          return new Promise<never>(() => undefined);
      }
    },
    runCompiled: async () => {
      counts.run += 1;
      if (runScript.kind === "throw") throw new Error("run boom");
      if (runScript.kind === "late") {
        await new Promise<void>((resolve) => setTimeout(resolve, runScript.delayMs));
        return makeResult("ok", EXPECTED_OUTPUT);
      }
      return makeResult(runScript.status, runScript.stdout);
    },
    releaseHandle: async () => {
      counts.release += 1;
    },
    isCompiledHandle: (value: unknown): value is CompiledHandle =>
      typeof value === "object" &&
      value !== null &&
      typeof (value as { id?: unknown }).id === "string" &&
      (value as { status?: unknown }).status === undefined,
    shutdown: async () => {
      counts.reset += 1;
    },
  };
  const adapter: OracleAdapter = {
    sharedConfig: {},
    port: {
      compileCobol: (source: string) => backend.compileCobol(source),
      runCompiled: (h, i, o) => backend.runCompiled(h, i, o),
      releaseHandle: (h) => backend.releaseHandle(h),
      isCompiledHandle: (v): v is CompiledHandle => backend.isCompiledHandle(v),
    },
    backend,
    compile: (source: string) => backend.compileCobol(source),
    reset: () => backend.shutdown(),
  };
  const probe = createProbe({
    adapter,
    getSample,
    slot: { isTaken: () => slot.taken },
    timings: { probeTimeoutMs: opts.timeoutMs ?? 1000, probeMinIntervalMs: opts.minIntervalMs ?? 0 },
    logger: { line: (text: string) => void logs.push(text) },
    execAllowed: opts.execAllowed ?? true,
    now: () => clock.t,
  });
  return { probe, logs, counts, clock, slot };
}

/** A string that differs from `s` by exactly one edit. */
function singleEdit(s: string): fc.Arbitrary<string> {
  const edits: fc.Arbitrary<string>[] = [
    fc.constant(`${s}\n`),
    fc.constant(`${s} `),
    fc.constant(` ${s}`),
    fc.constant(`${s}x`),
  ];
  if (s.length > 0) {
    edits.push(fc.constant(s.slice(0, -1)));
    edits.push(fc.nat({ max: s.length - 1 }).map((i) => s.slice(0, i) + s.slice(i + 1)));
    edits.push(
      fc
        .tuple(fc.nat({ max: s.length - 1 }), fc.constantFrom("0", "1", "9", "X", " ", "\r"))
        .map(([i, c]) => s.slice(0, i) + c + s.slice(i + 1)),
    );
  }
  return fc.oneof(...edits).filter((m) => m !== s);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("initial state and guards", () => {
  it("starts unavailable without any backend call", () => {
    const h = build({ kind: "handle" }, { kind: "result", status: "ok", stdout: EXPECTED_OUTPUT });
    expect(h.probe.state()).toBe("unavailable");
    expect(h.counts.compile).toBe(0);
  });

  it("stays unavailable and never compiles when execution is not allowed", async () => {
    const h = build(
      { kind: "handle" },
      { kind: "result", status: "ok", stdout: EXPECTED_OUTPUT },
      { execAllowed: false },
    );
    expect(await h.probe.run()).toBe("unavailable");
    expect(h.counts.compile).toBe(0);
  });

  it("does not probe while the slot is taken and returns the last state", async () => {
    const h = build({ kind: "handle" }, { kind: "result", status: "ok", stdout: EXPECTED_OUTPUT });
    h.slot.taken = true;
    expect(await h.probe.run()).toBe("unavailable");
    expect(h.counts.compile).toBe(0);
    h.slot.taken = false;
    expect(await h.probe.run()).toBe("ready");
    h.slot.taken = true;
    expect(await h.probe.run({ force: true })).toBe("ready");
    expect(h.counts.compile).toBe(1);
  });

  it("two concurrent probes make exactly one compile call", async () => {
    const h = build({ kind: "handle" }, { kind: "result", status: "ok", stdout: EXPECTED_OUTPUT });
    const [a, b] = await Promise.all([h.probe.run(), h.probe.run({ force: true })]);
    expect(a).toBe("ready");
    expect(b).toBe("ready");
    expect(h.counts.compile).toBe(1);
    expect(h.counts.release).toBe(1);
  });

  it("does not reprobe when ready unless forced", async () => {
    const h = build({ kind: "handle" }, { kind: "result", status: "ok", stdout: EXPECTED_OUTPUT });
    await h.probe.run();
    await h.probe.run();
    expect(h.counts.compile).toBe(1);
    await h.probe.run({ force: true });
    expect(h.counts.compile).toBe(2);
  });

  it("markUnavailable drops ready state and clears the interval gate", async () => {
    const h = build(
      { kind: "handle" },
      { kind: "result", status: "ok", stdout: EXPECTED_OUTPUT },
      { minIntervalMs: 1000 },
    );
    expect(await h.probe.run()).toBe("ready");
    h.probe.markUnavailable();
    expect(h.probe.state()).toBe("unavailable");
    expect(await h.probe.run()).toBe("ready");
    expect(h.counts.compile).toBe(2);
  });
});

describe("min interval", () => {
  it("skips a probe inside the interval and probes again after it", async () => {
    const h = build({ kind: "result", status: "compile_error" }, { kind: "throw" }, { minIntervalMs: 1000 });
    expect(await h.probe.run()).toBe("unavailable");
    expect(h.counts.compile).toBe(1);
    h.clock.t = 999;
    expect(await h.probe.run()).toBe("unavailable");
    expect(await h.probe.run({ force: true })).toBe("unavailable");
    expect(h.counts.compile).toBe(1);
    h.clock.t = 1000;
    await h.probe.run();
    expect(h.counts.compile).toBe(2);
  });
});

describe("scripted failures", () => {
  it.each(NON_OK_STATUSES)("compile result with status %s is unavailable", async (status) => {
    const h = build({ kind: "result", status }, { kind: "throw" });
    expect(await h.probe.run()).toBe("unavailable");
    expect(h.counts.run).toBe(0);
    expect(h.counts.reset).toBe(1);
  });

  it("a result claiming ok at compile time is not a handle", async () => {
    const h = build({ kind: "result", status: "ok" }, { kind: "throw" });
    expect(await h.probe.run()).toBe("unavailable");
    expect(h.counts.run).toBe(0);
  });

  it.each([null, undefined, 42, "handle", {}, { id: 5 }])("non-handle value %j is unavailable", async (value) => {
    const h = build({ kind: "junk", value }, { kind: "throw" });
    expect(await h.probe.run()).toBe("unavailable");
    expect(h.counts.run).toBe(0);
  });

  it.each(NON_OK_STATUSES)("run status %s is unavailable and the handle is released", async (status) => {
    const h = build({ kind: "handle" }, { kind: "result", status, stdout: EXPECTED_OUTPUT });
    expect(await h.probe.run()).toBe("unavailable");
    expect(h.counts.release).toBe(1);
  });

  it("a missing trailing newline is a mismatch", async () => {
    const h = build(
      { kind: "handle" },
      { kind: "result", status: "ok", stdout: EXPECTED_OUTPUT.replace(/\n$/, "") },
    );
    if (EXPECTED_OUTPUT.endsWith("\n")) {
      expect(await h.probe.run()).toBe("unavailable");
    } else {
      expect(await h.probe.run()).toBe("ready");
    }
  });

  it("a thrown compile error is unavailable and the log has no stack or path", async () => {
    const h = build({ kind: "throw" }, { kind: "throw" });
    expect(await h.probe.run()).toBe("unavailable");
    const text = h.logs.join("\n");
    expect(text).not.toMatch(/secret|stack frame|\\|\/\w+\/|\bat\b.*:\d+/);
    expect(h.counts.reset).toBe(1);
  });

  it("a thrown run error is unavailable and the handle is released", async () => {
    const h = build({ kind: "handle" }, { kind: "throw" });
    expect(await h.probe.run()).toBe("unavailable");
    expect(h.counts.release).toBe(1);
  });

  it("a hang past the timeout is unavailable and resets the oracle", async () => {
    vi.useFakeTimers();
    const h = build({ kind: "hang" }, { kind: "throw" }, { timeoutMs: 500 });
    const pending = h.probe.run();
    await vi.advanceTimersByTimeAsync(499);
    expect(h.probe.state()).toBe("unavailable");
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toBe("unavailable");
    expect(h.counts.reset).toBe(1);
    expect(h.logs.join("\n")).toContain("timed out");
  });

  it("releases the handle when a run finishes after the timeout", async () => {
    vi.useFakeTimers();
    const h = build({ kind: "handle" }, { kind: "late", delayMs: 800 }, { timeoutMs: 500 });
    const pending = h.probe.run();
    await vi.advanceTimersByTimeAsync(500);
    expect(await pending).toBe("unavailable");
    await vi.advanceTimersByTimeAsync(400);
    expect(h.counts.release).toBe(1);
    expect(h.probe.state()).toBe("unavailable");
  });
});

describe("Property 15", () => {
  const compileArb: fc.Arbitrary<CompileScript> = fc.oneof(
    fc.constant<CompileScript>({ kind: "handle" }),
    fc.constantFrom(...ALL_STATUSES).map((status): CompileScript => ({ kind: "result", status })),
    fc
      .constantFrom<unknown>(null, undefined, 0, "x", {}, [], { id: 1 })
      .map((value): CompileScript => ({ kind: "junk", value })),
    fc.constant<CompileScript>({ kind: "throw" }),
  );

  const stdoutArb: fc.Arbitrary<string> = fc.oneof(
    fc.constant(EXPECTED_OUTPUT),
    singleEdit(EXPECTED_OUTPUT),
    fc.string(),
  );

  const runArb: fc.Arbitrary<RunScript> = fc.oneof(
    fc
      .tuple(fc.constantFrom(...ALL_STATUSES), stdoutArb)
      .map(([status, stdout]): RunScript => ({ status, stdout, kind: "result" })),
    fc.constant<RunScript>({ kind: "throw" }),
  );

  // Feature: necromancer-server, Property 15: Oracle_State is ready only after a real, matching probe
  // **Validates: Requirements 4.1, 4.2, 4.3, 4.6, 4.7, 4.8**
  it("is ready iff a handle was returned, the run was ok and stdout is strictly equal", async () => {
    await fc.assert(
      fc.asyncProperty(compileArb, runArb, async (compileScript, runScript) => {
        const h = build(compileScript, runScript);
        expect(h.probe.state()).toBe("unavailable");
        const state = await h.probe.run();
        const expectReady =
          compileScript.kind === "handle" &&
          runScript.kind === "result" &&
          runScript.status === "ok" &&
          runScript.stdout === EXPECTED_OUTPUT;
        expect(state).toBe(expectReady ? "ready" : "unavailable");
        expect(h.probe.state()).toBe(state);
        // A ready state needs a real compile and run.
        if (state === "ready") {
          expect(h.counts.compile).toBe(1);
          expect(h.counts.run).toBe(1);
        }
        // The handle is released on every path where one was issued.
        expect(h.counts.release).toBe(h.counts.issued);
        // Failure resets the oracle, success does not.
        expect(h.counts.reset).toBe(expectReady ? 0 : 1);
      }),
      { numRuns: 200 },
    );
  });

  it("any single edit of the expected stdout is never ready", async () => {
    await fc.assert(
      fc.asyncProperty(singleEdit(EXPECTED_OUTPUT), async (stdout) => {
        const h = build({ kind: "handle" }, { kind: "result", status: "ok", stdout });
        expect(await h.probe.run()).toBe("unavailable");
        expect(h.counts.release).toBe(1);
      }),
      { numRuns: 100 },
    );
  });
});

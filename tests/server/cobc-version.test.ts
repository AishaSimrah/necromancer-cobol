import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COBC_VERSION_WAIT_MS,
  createCobcVersionCache,
  parseCobcVersion,
  readCobcVersion,
  type ExecFileFn,
} from "../../src/server/cobc-version.js";

type Callback = Parameters<ExecFileFn>[3];

function okExec(stdout: string): { fn: ExecFileFn; calls: () => number } {
  let n = 0;
  const fn: ExecFileFn = (_f, _a, _o, cb) => {
    n += 1;
    cb(null, stdout);
    return undefined;
  };
  return { fn, calls: () => n };
}

describe("parseCobcVersion", () => {
  it("parses a 4-part version", () => {
    expect(parseCobcVersion("cobc (GnuCOBOL) 3.1.2.0\n")).toBe("3.1.2.0");
  });
  it("parses a 3-part version", () => {
    expect(parseCobcVersion("cobc (GnuCOBOL) 3.2.0")).toBe("3.2.0");
  });
  it("returns null for garbage and empty input", () => {
    expect(parseCobcVersion("hello world")).toBeNull();
    expect(parseCobcVersion("")).toBeNull();
  });
  it("only reads the first line of multi-line output", () => {
    expect(parseCobcVersion("cobc (GnuCOBOL) 3.1.2.0\r\nCopyright 2020\n")).toBe("3.1.2.0");
    expect(parseCobcVersion("noise\ncobc (GnuCOBOL) 3.1.2.0\n")).toBeNull();
  });
});

describe("readCobcVersion", () => {
  it("resolves the parsed version", async () => {
    const { fn } = okExec("cobc (GnuCOBOL) 3.1.2.0\n");
    await expect(readCobcVersion(fn)).resolves.toBe("3.1.2.0");
  });
  it("resolves null on exec error", async () => {
    const fn: ExecFileFn = (_f, _a, _o, cb: Callback) => {
      cb(new Error("ENOENT"), "");
      return undefined;
    };
    await expect(readCobcVersion(fn)).resolves.toBeNull();
  });
  it("resolves null when exec throws", async () => {
    const fn: ExecFileFn = () => {
      throw new Error("boom");
    };
    await expect(readCobcVersion(fn)).resolves.toBeNull();
  });
  it("resolves null on timeout error", async () => {
    const fn: ExecFileFn = (_f, _a, _o, cb: Callback) => {
      cb(Object.assign(new Error("timed out"), { killed: true }), "");
      return undefined;
    };
    await expect(readCobcVersion(fn)).resolves.toBeNull();
  });
});

describe("createCobcVersionCache", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls exec exactly once across repeated reads", async () => {
    const { fn, calls } = okExec("cobc (GnuCOBOL) 3.1.2.0\n");
    const cache = createCobcVersionCache(fn);
    cache.start();
    expect(await cache.get()).toBe("3.1.2.0");
    expect(await cache.get()).toBe("3.1.2.0");
    expect(await cache.get()).toBe("3.1.2.0");
    expect(calls()).toBe(1);
  });

  it("caches a failure as null without retrying", async () => {
    let n = 0;
    const fn: ExecFileFn = (_f, _a, _o, cb: Callback) => {
      n += 1;
      cb(new Error("fail"), "");
      return undefined;
    };
    const cache = createCobcVersionCache(fn);
    expect(await cache.get()).toBeNull();
    expect(await cache.get()).toBeNull();
    expect(n).toBe(1);
  });

  it("waits at most 1000 ms for a slow call, then returns null", async () => {
    vi.useFakeTimers();
    expect(COBC_VERSION_WAIT_MS).toBe(1000);
    let finish: Callback | undefined;
    const fn: ExecFileFn = (_f, _a, _o, cb: Callback) => {
      finish = cb;
      return undefined;
    };
    const cache = createCobcVersionCache(fn);
    let result: string | null | undefined;
    void cache.get().then((v) => {
      result = v;
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toBeNull();

    // The call later completes; the cached value is then served.
    finish?.(null, "cobc (GnuCOBOL) 3.1.2.0\n");
    await vi.advanceTimersByTimeAsync(0);
    expect(await cache.get()).toBe("3.1.2.0");
  });
});

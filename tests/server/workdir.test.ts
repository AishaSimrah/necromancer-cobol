import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ServerLogger } from "../../src/server/types.js";
import { prepareWorkRoot, realWorkdirFs, type WorkdirFsPort } from "../../src/server/workdir.js";

function capture(): { logger: ServerLogger; lines: string[] } {
  const lines: string[] = [];
  const logger = { line: (t: string) => void lines.push(t) } as ServerLogger;
  return { logger, lines };
}

function codeError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

describe("prepareWorkRoot", () => {
  let base: string;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), "necro-workdir-"));
  });
  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("creates nested directories and removes the check file", async () => {
    const root = join(base, "a", "b", "c");
    const { logger, lines } = capture();
    const status = await prepareWorkRoot(root, realWorkdirFs, logger, 4242);
    expect((await stat(root)).isDirectory()).toBe(true);
    expect(await readdir(root)).toEqual([]);
    expect(typeof status.execAllowed).toBe("boolean");
    if (status.execAllowed) expect(lines).toEqual([]);
  });

  it("reports a clear message when mkdir fails", async () => {
    const fake: WorkdirFsPort = {
      ...realWorkdirFs,
      mkdir: () => Promise.reject(codeError("EACCES")),
    };
    const { logger } = capture();
    await expect(prepareWorkRoot("/nope/root", fake, logger)).rejects.toThrow(
      "cannot create work root /nope/root: EACCES",
    );
  });

  it("reports a clear message when the check write fails", async () => {
    const fake: WorkdirFsPort = {
      ...realWorkdirFs,
      mkdir: () => Promise.resolve(undefined),
      writeFile: () => Promise.reject(codeError("EROFS")),
    };
    const { logger } = capture();
    await expect(prepareWorkRoot("/ro/root", fake, logger)).rejects.toThrow(
      "cannot write to /ro/root: EROFS",
    );
  });

  it("returns execAllowed false, logs the path, and still removes the check file", async () => {
    const removed: string[] = [];
    const written: string[] = [];
    const fake: WorkdirFsPort = {
      mkdir: () => Promise.resolve(undefined),
      writeFile: (p) => {
        written.push(p);
        return Promise.resolve();
      },
      access: () => Promise.reject(codeError("EACCES")),
      rm: (p) => {
        removed.push(p);
        return Promise.resolve();
      },
    };
    const { logger, lines } = capture();
    const status = await prepareWorkRoot("/mnt/noexec", fake, logger, 7);
    expect(status.execAllowed).toBe(false);
    expect(lines.some((l) => l.includes("/mnt/noexec"))).toBe(true);
    expect(written).toEqual(["/mnt/noexec/.necro-check-7"]);
    expect(removed).toEqual(written);
  });

  it("returns execAllowed true and logs nothing when access succeeds", async () => {
    const fake: WorkdirFsPort = {
      mkdir: () => Promise.resolve(undefined),
      writeFile: () => Promise.resolve(),
      access: () => Promise.resolve(),
      rm: () => Promise.resolve(),
    };
    const { logger, lines } = capture();
    await expect(prepareWorkRoot("/ok", fake, logger)).resolves.toEqual({ execAllowed: true });
    expect(lines).toEqual([]);
  });

  it("ignores a failing check-file removal", async () => {
    const fake: WorkdirFsPort = {
      mkdir: () => Promise.resolve(undefined),
      writeFile: () => Promise.resolve(),
      access: () => Promise.resolve(),
      rm: () => Promise.reject(codeError("EPERM")),
    };
    const { logger } = capture();
    await expect(prepareWorkRoot("/ok", fake, logger)).resolves.toEqual({ execAllowed: true });
  });
});

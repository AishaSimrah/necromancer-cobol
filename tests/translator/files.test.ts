import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readRepoText, repoPath } from "../../src/translator/files.js";

function ownRead(relative: string): string {
  return readFileSync(fileURLToPath(new URL("../../" + relative, import.meta.url)), "utf8");
}

describe("translator/files", () => {
  it("reads interest.cbl identically to a test-local import.meta.url read", () => {
    expect(readRepoText("cobol-samples/interest.cbl", "interest source")).toBe(
      ownRead("cobol-samples/interest.cbl"),
    );
  });

  it("does not depend on process.cwd()", () => {
    const original = process.cwd();
    try {
      process.chdir(tmpdir());
      expect(process.cwd()).not.toBe(original);
      // payroll.cbl is not read elsewhere in this file, so this is an uncached read.
      expect(readRepoText("cobol-samples/payroll.cbl", "payroll source")).toBe(
        ownRead("cobol-samples/payroll.cbl"),
      );
    } finally {
      process.chdir(original);
    }
  });

  it("throws with the label and resolved path for a missing file, every time", () => {
    const rel = "cobol-samples/does-not-exist.cbl";
    const resolved = repoPath(rel);
    for (let i = 0; i < 2; i++) {
      let message = "";
      try {
        readRepoText(rel, "ghost source");
      } catch (e: unknown) {
        message = e instanceof Error ? e.message : String(e);
      }
      expect(message).toContain("ghost source");
      expect(message).toContain(resolved);
    }
  });
});

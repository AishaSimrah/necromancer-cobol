// Feature: necromancer-frontend, Property 1: NDJSON splitting round-trips across arbitrary chunk boundaries
// **Validates: Requirements 4.1, 12.2**
import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import { createLineSplitter } from "../../src/frontend/core/ndjson.js";

const lineArb: fc.Arbitrary<string> = fc.string({ unit: "binary" }).map((s) => s.replace(/\n/g, ""));
const linesArb: fc.Arbitrary<string[]> = fc.array(lineArb, { maxLength: 20 });
const cutsArb: fc.Arbitrary<number[]> = fc.array(fc.nat(1000), { maxLength: 40 });

/** Cut text at the given points (scaled into range, duplicates give zero-length chunks). */
function cut(text: string, cuts: readonly number[]): string[] {
  const points = cuts.map((c) => c % (text.length + 1)).sort((a, b) => a - b);
  const chunks: string[] = [];
  let prev = 0;
  for (const p of points) {
    chunks.push(text.slice(prev, p));
    prev = p;
  }
  chunks.push(text.slice(prev));
  return chunks;
}

function feed(chunks: readonly string[]): { pushed: string[]; flushed: readonly string[] } {
  const splitter = createLineSplitter();
  const pushed: string[] = [];
  for (const chunk of chunks) pushed.push(...splitter.push(chunk));
  return { pushed, flushed: splitter.flush() };
}

describe("Property 1: NDJSON splitting round-trips across arbitrary chunk boundaries", () => {
  it("newline-terminated stream yields exactly the original lines and flush is empty", () => {
    fc.assert(
      fc.property(linesArb, cutsArb, (lines, cuts) => {
        const text = lines.map((l) => l + "\n").join("");
        const { pushed, flushed } = feed(cut(text, cuts));
        expect(pushed).toEqual(lines);
        expect(flushed).toEqual([]);
      }),
    );
  });

  it("single-character chunks yield the original lines", () => {
    fc.assert(
      fc.property(linesArb, (lines) => {
        const text = lines.map((l) => l + "\n").join("");
        const { pushed, flushed } = feed(Array.from(text));
        expect(pushed).toEqual(lines);
        expect(flushed).toEqual([]);
      }),
    );
  });

  it("stream without trailing newline: push output plus flush equals all lines", () => {
    fc.assert(
      fc.property(linesArb, fc.string({ minLength: 1, unit: "binary" }).map((s) => s.replace(/\n/g, "") || "x"), cutsArb, (lines, tail, cuts) => {
        const text = lines.map((l) => l + "\n").join("") + tail;
        const { pushed, flushed } = feed(cut(text, cuts));
        expect([...pushed, ...flushed]).toEqual([...lines, tail]);
      }),
    );
  });

  it("empty chunks produce no lines and flush on an empty stream is empty", () => {
    const splitter = createLineSplitter();
    expect(splitter.push("")).toEqual([]);
    expect(splitter.flush()).toEqual([]);
  });
});

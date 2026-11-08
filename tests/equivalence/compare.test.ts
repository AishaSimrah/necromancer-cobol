import { describe, expect, it } from "vitest";
import { invokeCandidate, outputsEqual } from "../../src/equivalence/compare.js";

describe("outputsEqual", () => {
  it("does not ignore trailing whitespace", () => {
    expect(outputsEqual("1157.63", "1157.63 ")).toBe(false);
  });

  it("does not equate 0.00 with -0.00", () => {
    expect(outputsEqual("0.00", "-0.00")).toBe(false);
  });

  it("accepts identical strings", () => {
    expect(outputsEqual("1157.63", "1157.63")).toBe(true);
  });
});

describe("invokeCandidate", () => {
  it("turns a throw into an error outcome", async () => {
    const outcome = await invokeCandidate(() => {
      throw new Error("boom");
    }, ["1"]);
    expect(outcome).toEqual({ kind: "error", text: "boom" });
  });

  it("does not mutate the caller's input array", async () => {
    const lines: readonly string[] = ["100", "5"];
    const snapshot = [...lines];
    const outcome = await invokeCandidate((input) => {
      input.push("extra");
      input[0] = "changed";
      return "ok";
    }, lines);
    expect(outcome).toEqual({ kind: "output", text: "ok" });
    expect(lines).toEqual(snapshot);
  });
});

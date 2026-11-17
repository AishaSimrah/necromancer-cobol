import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Deployment checks, no Oracle needed (Requirements 12.1 to 12.4).
//
// TODO(extend): when the app image `Dockerfile` exists (the one that runs the Next.js app),
// this test must be extended to assert that it copies `cobol-samples/` and
// `src/translator/translations/`. Today only the Oracle `Dockerfile` exists.

function repoFile(relative: string): string {
  return fileURLToPath(new URL("../../" + relative, import.meta.url));
}

function readRepo(relative: string): string {
  return readFileSync(repoFile(relative), "utf8");
}

const SAMPLE_FILES: readonly string[] = [
  "cobol-samples/interest.cbl",
  "cobol-samples/payroll.cbl",
  "cobol-samples/tax.cbl",
];

interface IgnoreRule {
  readonly negated: boolean;
  readonly regex: RegExp;
  readonly source: string;
}

function globToRegexSource(glob: string): string {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob.charAt(i);
    if (ch === "*") {
      if (glob.charAt(i + 1) === "*") {
        if (glob.charAt(i + 2) === "/") {
          out += "(?:.*/)?";
          i += 2;
        } else {
          out += ".*";
          i += 1;
        }
      } else {
        out += "[^/]*";
      }
    } else if (ch === "?") {
      out += "[^/]";
    } else {
      out += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return out;
}

/** Parses .dockerignore text: skips blank and comment lines, handles `!` negation. */
export function parseIgnoreRules(text: string): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    let negated = false;
    if (line.startsWith("!")) {
      negated = true;
      line = line.slice(1).trim();
    }
    line = line.replace(/^\/+/, "").replace(/\/+$/, "");
    if (line === "") continue;
    // Conservative: a pattern also matches at any depth, and also matches anything below
    // a matched directory.
    const regex = new RegExp("^(?:.*/)?" + globToRegexSource(line) + "(?:/.*)?$");
    rules.push({ negated, regex, source: raw.trim() });
  }
  return rules;
}

/** Last matching rule wins, as in Docker. */
export function isIgnored(rules: readonly IgnoreRule[], path: string): boolean {
  let ignored = false;
  for (const rule of rules) {
    if (rule.regex.test(path)) ignored = !rule.negated;
  }
  return ignored;
}

describe("deployment: .dockerignore", () => {
  const rules = parseIgnoreRules(readRepo(".dockerignore"));

  it("does not exclude the cobol-samples directory or the three .cbl files", () => {
    expect(isIgnored(rules, "cobol-samples")).toBe(false);
    for (const file of SAMPLE_FILES) {
      expect(isIgnored(rules, file), file).toBe(false);
    }
  });

  it("still allows cobol-samples/bin to be excluded", () => {
    expect(isIgnored(rules, "cobol-samples/bin")).toBe(true);
    expect(isIgnored(rules, "cobol-samples/bin/interest")).toBe(true);
  });

  it("flags every forbidden pattern when added to the file", () => {
    const forbidden = [
      "cobol-samples",
      "cobol-samples/",
      "cobol-samples/*",
      "cobol-samples/*.cbl",
      "*.cbl",
      "**/*.cbl",
      "interest.cbl",
      "payroll.cbl",
      "tax.cbl",
    ];
    for (const pattern of forbidden) {
      const withBad = parseIgnoreRules(readRepo(".dockerignore") + "\n" + pattern + "\n");
      const hit = isIgnored(withBad, "cobol-samples") || SAMPLE_FILES.some((f) => isIgnored(withBad, f));
      expect(hit, pattern).toBe(true);
    }
  });

  it("handles comments, blank lines and negation", () => {
    const parsed = parseIgnoreRules("# *.cbl\n\n   \n*.cbl\n!cobol-samples/*.cbl\n");
    expect(parsed).toHaveLength(2);
    expect(isIgnored(parsed, "cobol-samples/interest.cbl")).toBe(false);
    expect(isIgnored(parseIgnoreRules("# *.cbl\n"), "cobol-samples/interest.cbl")).toBe(false);
  });
});

describe("deployment: sample files and Oracle Dockerfile", () => {
  it("has the three .cbl files on disk", () => {
    for (const file of SAMPLE_FILES) {
      expect(existsSync(repoFile(file)), file).toBe(true);
    }
  });

  it("Oracle Dockerfile still copies cobol-samples/", () => {
    expect(readRepo("Dockerfile")).toMatch(/^COPY\s+cobol-samples\/\s/m);
  });
});

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { loadServerConfig, ServerConfigError, type Env } from "../../src/server/config.js";

const VARS = [
  "PORT",
  "NECROMANCER_DEFAULT_CASE_COUNT",
  "NECROMANCER_MAX_CASE_COUNT",
  "NECROMANCER_TIME_BUDGET_MS",
  "NECROMANCER_WORK_ROOT",
] as const;

const BASE: Env = { HOME: "/home/app" };

function withEnv(extra: Record<string, string | undefined>): Env {
  return { ...BASE, ...extra };
}

function errorOf(env: Env): ServerConfigError {
  try {
    loadServerConfig(env);
  } catch (e) {
    expect(e).toBeInstanceOf(ServerConfigError);
    return e as ServerConfigError;
  }
  throw new Error("expected loadServerConfig to throw");
}

describe("loadServerConfig defaults", () => {
  it("applies every default when only HOME is set", () => {
    expect(loadServerConfig(BASE)).toEqual({
      port: 10000,
      defaultCaseCount: 1000,
      maxCaseCount: 2000,
      timeBudgetMs: 60000,
      workRoot: "/home/app/work",
    });
  });

  it("strips trailing slashes from HOME", () => {
    expect(loadServerConfig({ HOME: "/home/app//" }).workRoot).toBe("/home/app/work");
  });

  it("treats empty strings as unset", () => {
    const cfg = loadServerConfig(
      withEnv({
        PORT: "",
        NECROMANCER_DEFAULT_CASE_COUNT: "",
        NECROMANCER_MAX_CASE_COUNT: "",
        NECROMANCER_TIME_BUDGET_MS: "",
        NECROMANCER_WORK_ROOT: "",
      }),
    );
    expect(cfg.port).toBe(10000);
    expect(cfg.defaultCaseCount).toBe(1000);
    expect(cfg.maxCaseCount).toBe(2000);
    expect(cfg.timeBudgetMs).toBe(60000);
    expect(cfg.workRoot).toBe("/home/app/work");
  });

  it("accepts explicit valid values", () => {
    const cfg = loadServerConfig({
      PORT: "8080",
      NECROMANCER_DEFAULT_CASE_COUNT: "500",
      NECROMANCER_MAX_CASE_COUNT: "5000",
      NECROMANCER_TIME_BUDGET_MS: "1000",
      NECROMANCER_WORK_ROOT: "/data/w",
    });
    expect(cfg).toEqual({
      port: 8080,
      defaultCaseCount: 500,
      maxCaseCount: 5000,
      timeBudgetMs: 1000,
      workRoot: "/data/w",
    });
  });

  it("accepts Windows absolute work roots without HOME", () => {
    expect(loadServerConfig({ NECROMANCER_WORK_ROOT: "C:\\work" }).workRoot).toBe("C:\\work");
  });

  it("returns a frozen config", () => {
    const cfg = loadServerConfig(BASE);
    expect(Object.isFrozen(cfg)).toBe(true);
  });
});

describe("loadServerConfig invalid values name their variable", () => {
  const cases: ReadonlyArray<readonly [string, Record<string, string>]> = [
    ["PORT", { PORT: "0" }],
    ["PORT", { PORT: "65536" }],
    ["PORT", { PORT: "80a" }],
    ["PORT", { PORT: " 80" }],
    ["PORT", { PORT: "+80" }],
    ["PORT", { PORT: "1e3" }],
    ["PORT", { PORT: "1.5" }],
    ["PORT", { PORT: "-1" }],
    ["PORT", { PORT: "99999999999999999999" }],
    ["NECROMANCER_MAX_CASE_COUNT", { NECROMANCER_MAX_CASE_COUNT: "100001" }],
    ["NECROMANCER_MAX_CASE_COUNT", { NECROMANCER_MAX_CASE_COUNT: "99" }],
    ["NECROMANCER_MAX_CASE_COUNT", { NECROMANCER_MAX_CASE_COUNT: "abc" }],
    ["NECROMANCER_DEFAULT_CASE_COUNT", { NECROMANCER_DEFAULT_CASE_COUNT: "99" }],
    [
      "NECROMANCER_DEFAULT_CASE_COUNT",
      { NECROMANCER_DEFAULT_CASE_COUNT: "3000", NECROMANCER_MAX_CASE_COUNT: "2000" },
    ],
    ["NECROMANCER_DEFAULT_CASE_COUNT", { NECROMANCER_DEFAULT_CASE_COUNT: "2001" }],
    ["NECROMANCER_TIME_BUDGET_MS", { NECROMANCER_TIME_BUDGET_MS: "999" }],
    ["NECROMANCER_TIME_BUDGET_MS", { NECROMANCER_TIME_BUDGET_MS: "3600001" }],
    ["NECROMANCER_TIME_BUDGET_MS", { NECROMANCER_TIME_BUDGET_MS: "1.5" }],
    ["NECROMANCER_WORK_ROOT", { NECROMANCER_WORK_ROOT: "relative/dir" }],
  ];

  it.each(cases)("%s rejects %j", (variable, extra) => {
    const err = errorOf(withEnv(extra));
    expect(err.variable).toBe(variable);
    expect(err.message).toContain(variable);
  });

  it("echoes at most 40 characters of a bad value", () => {
    const err = errorOf(withEnv({ PORT: "x".repeat(200) }));
    expect(err.message).not.toContain("x".repeat(41));
  });

  it("requires NECROMANCER_WORK_ROOT when HOME is missing or relative", () => {
    expect(errorOf({}).variable).toBe("NECROMANCER_WORK_ROOT");
    expect(errorOf({ HOME: "home/app" }).variable).toBe("NECROMANCER_WORK_ROOT");
    expect(errorOf({ HOME: "" }).variable).toBe("NECROMANCER_WORK_ROOT");
  });
});

describe("loadServerConfig cross-field rules", () => {
  it("MAX alone 500 (below the default 1000) fails naming DEFAULT and both variables", () => {
    const err = errorOf(withEnv({ NECROMANCER_MAX_CASE_COUNT: "500" }));
    expect(err.variable).toBe("NECROMANCER_DEFAULT_CASE_COUNT");
    expect(err.message).toContain("NECROMANCER_MAX_CASE_COUNT");
  });

  it("MAX alone 1000 is fine (DEFAULT equals MAX)", () => {
    const cfg = loadServerConfig(withEnv({ NECROMANCER_MAX_CASE_COUNT: "1000" }));
    expect(cfg.defaultCaseCount).toBe(1000);
    expect(cfg.maxCaseCount).toBe(1000);
  });

  it("DEFAULT equal to MAX is accepted", () => {
    const cfg = loadServerConfig(
      withEnv({ NECROMANCER_DEFAULT_CASE_COUNT: "300", NECROMANCER_MAX_CASE_COUNT: "300" }),
    );
    expect(cfg.defaultCaseCount).toBe(300);
  });

  it("MAX 100000 is accepted and 100001 is rejected", () => {
    expect(loadServerConfig(withEnv({ NECROMANCER_MAX_CASE_COUNT: "100000" })).maxCaseCount).toBe(100000);
    expect(errorOf(withEnv({ NECROMANCER_MAX_CASE_COUNT: "100001" })).variable).toBe(
      "NECROMANCER_MAX_CASE_COUNT",
    );
  });

  it("time budget bounds 1000 and 3600000 are accepted, 999 and 3600001 rejected", () => {
    expect(loadServerConfig(withEnv({ NECROMANCER_TIME_BUDGET_MS: "1000" })).timeBudgetMs).toBe(1000);
    expect(loadServerConfig(withEnv({ NECROMANCER_TIME_BUDGET_MS: "3600000" })).timeBudgetMs).toBe(3600000);
    expect(errorOf(withEnv({ NECROMANCER_TIME_BUDGET_MS: "999" })).variable).toBe("NECROMANCER_TIME_BUDGET_MS");
    expect(errorOf(withEnv({ NECROMANCER_TIME_BUDGET_MS: "3600001" })).variable).toBe(
      "NECROMANCER_TIME_BUDGET_MS",
    );
  });

  it("PORT bounds 1 and 65535 are accepted", () => {
    expect(loadServerConfig(withEnv({ PORT: "1" })).port).toBe(1);
    expect(loadServerConfig(withEnv({ PORT: "65535" })).port).toBe(65535);
  });
});

// Feature: necromancer-server, Property 1: Environment configuration is validated totally
// **Validates: Requirements 1.3, 15.1, 15.2, 15.3, 15.4**
describe("Property 1: Environment configuration is validated totally", () => {
  const textValue = fc.oneof(
    fc.constant(undefined),
    fc.constant(""),
    fc.nat({ max: 4_000_000 }).map(String),
    fc.integer({ min: 100, max: 100000 }).map(String),
    fc.string({ maxLength: 60 }),
    fc.constantFrom("0", "65536", "80a", " 80", "+80", "1e3", "1.5", "-5", "/abs/path", "C:\\x", "rel/path"),
  );

  const envArb = fc
    .record({
      PORT: textValue,
      NECROMANCER_DEFAULT_CASE_COUNT: textValue,
      NECROMANCER_MAX_CASE_COUNT: textValue,
      NECROMANCER_TIME_BUDGET_MS: textValue,
      NECROMANCER_WORK_ROOT: textValue,
      HOME: fc.oneof(fc.constant(undefined), fc.constant("/home/u"), fc.string({ maxLength: 20 })),
    })
    .map((r): Env => {
      const out: Record<string, string | undefined> = {};
      for (const [k, v] of Object.entries(r)) out[k] = v;
      return out;
    });

  it("either returns a frozen in-range config or throws ServerConfigError naming a known variable", () => {
    fc.assert(
      fc.property(envArb, (env) => {
        let thrown: unknown;
        let cfg: ReturnType<typeof loadServerConfig> | undefined;
        try {
          cfg = loadServerConfig(env);
        } catch (e) {
          thrown = e;
        }
        if (cfg === undefined) {
          expect(thrown).toBeInstanceOf(ServerConfigError);
          const err = thrown as ServerConfigError;
          expect(VARS as readonly string[]).toContain(err.variable);
          expect(err.message).toContain(err.variable);
          return;
        }
        expect(Object.isFrozen(cfg)).toBe(true);
        expect(Number.isInteger(cfg.port)).toBe(true);
        expect(cfg.port).toBeGreaterThanOrEqual(1);
        expect(cfg.port).toBeLessThanOrEqual(65535);
        expect(cfg.defaultCaseCount).toBeGreaterThanOrEqual(100);
        expect(cfg.defaultCaseCount).toBeLessThanOrEqual(cfg.maxCaseCount);
        expect(cfg.maxCaseCount).toBeLessThanOrEqual(100000);
        expect(cfg.timeBudgetMs).toBeGreaterThanOrEqual(1000);
        expect(cfg.timeBudgetMs).toBeLessThanOrEqual(3600000);
        expect(cfg.workRoot.length).toBeGreaterThan(0);
      }),
      { numRuns: 500 },
    );
  });

  it("is deterministic: the same env gives the same outcome", () => {
    fc.assert(
      fc.property(envArb, (env) => {
        const run = (): string => {
          try {
            return JSON.stringify(loadServerConfig(env));
          } catch (e) {
            return `ERR:${(e as ServerConfigError).variable}`;
          }
        };
        expect(run()).toBe(run());
      }),
      { numRuns: 200 },
    );
  });

  it("any PORT that is not a plain integer in 1..65535 is rejected naming PORT", () => {
    const badPort = fc
      .string({ maxLength: 12 })
      .filter((s) => s !== "" && !(/^[0-9]+$/.test(s) && Number(s) >= 1 && Number(s) <= 65535));
    fc.assert(
      fc.property(badPort, (port) => {
        const err = errorOf(withEnv({ PORT: port }));
        expect(err.variable).toBe("PORT");
      }),
      { numRuns: 200 },
    );
  });
});

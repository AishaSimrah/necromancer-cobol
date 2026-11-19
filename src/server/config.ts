import path from "node:path";
import type { ServerConfig } from "./types.js";

export class ServerConfigError extends Error {
  readonly variable: string;
  constructor(variable: string, message: string) {
    super(message);
    this.name = "ServerConfigError";
    this.variable = variable;
  }
}

export type Env = Readonly<Record<string, string | undefined>>;

const ECHO_LIMIT = 40;
const DIGITS = /^[0-9]+$/;

const PORT_DEFAULT = 10000;
const DEFAULT_CASES_DEFAULT = 1000;
const MAX_CASES_DEFAULT = 2000;
const MAX_CASES_CEILING = 100000;
const MIN_CASES = 100;
const BUDGET_DEFAULT = 60000;
const BUDGET_MIN = 1000;
const BUDGET_MAX = 3600000;

function echo(raw: string): string {
  return JSON.stringify(raw.slice(0, ECHO_LIMIT));
}

function fail(variable: string, rule: string, raw: string): ServerConfigError {
  return new ServerConfigError(variable, `${variable} must be ${rule}, got ${echo(raw)}`);
}

/** Parses an unsigned base-10 safe integer, or returns undefined when the text is invalid. */
function parseUnsigned(raw: string): number | undefined {
  if (!DIGITS.test(raw)) return undefined;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : undefined;
}

function isSet(raw: string | undefined): raw is string {
  return raw !== undefined && raw !== "";
}

function readInt(env: Env, name: string, fallback: number, min: number, max: number, rule: string): number {
  const raw = env[name];
  if (!isSet(raw)) return fallback;
  const n = parseUnsigned(raw);
  if (n === undefined || n < min || n > max) throw fail(name, rule, raw);
  return n;
}

function readWorkRoot(env: Env): string {
  const raw = env["NECROMANCER_WORK_ROOT"];
  if (isSet(raw)) {
    if (!path.posix.isAbsolute(raw) && !path.win32.isAbsolute(raw)) {
      throw fail("NECROMANCER_WORK_ROOT", "an absolute path", raw);
    }
    return raw;
  }
  const home = env["HOME"];
  if (!isSet(home) || !path.posix.isAbsolute(home)) {
    throw new ServerConfigError(
      "NECROMANCER_WORK_ROOT",
      "NECROMANCER_WORK_ROOT must be set to an absolute path when HOME is not an absolute path",
    );
  }
  return `${home.replace(/\/+$/, "")}/work`;
}

function readCaseCounts(env: Env): { defaultCaseCount: number; maxCaseCount: number } {
  const maxCaseCount = readInt(
    env,
    "NECROMANCER_MAX_CASE_COUNT",
    MAX_CASES_DEFAULT,
    MIN_CASES,
    MAX_CASES_CEILING,
    `an integer from ${String(MIN_CASES)} to ${String(MAX_CASES_CEILING)} (NECROMANCER_MAX_CASE_COUNT <= 100000)`,
  );
  const defaultSet = isSet(env["NECROMANCER_DEFAULT_CASE_COUNT"]);
  const defaultCaseCount = readInt(
    env,
    "NECROMANCER_DEFAULT_CASE_COUNT",
    DEFAULT_CASES_DEFAULT,
    MIN_CASES,
    maxCaseCount,
    `an integer with 100 <= NECROMANCER_DEFAULT_CASE_COUNT <= NECROMANCER_MAX_CASE_COUNT (max is ${String(maxCaseCount)})`,
  );
  if (!defaultSet && defaultCaseCount > maxCaseCount) {
    throw new ServerConfigError("NECROMANCER_DEFAULT_CASE_COUNT", crossFieldMessage(maxCaseCount));
  }
  return { defaultCaseCount, maxCaseCount };
}

function crossFieldMessage(maxCaseCount: number): string {
  return (
    `NECROMANCER_DEFAULT_CASE_COUNT defaults to ${String(DEFAULT_CASES_DEFAULT)}, which exceeds ` +
    `NECROMANCER_MAX_CASE_COUNT=${String(maxCaseCount)}. Set both NECROMANCER_DEFAULT_CASE_COUNT and ` +
    `NECROMANCER_MAX_CASE_COUNT (100 <= NECROMANCER_DEFAULT_CASE_COUNT <= NECROMANCER_MAX_CASE_COUNT)`
  );
}

/** Reads and validates the server settings once. Throws ServerConfigError naming the variable. */
export function loadServerConfig(env: Env): ServerConfig {
  const port = readInt(env, "PORT", PORT_DEFAULT, 1, 65535, "an integer from 1 to 65535");
  const { defaultCaseCount, maxCaseCount } = readCaseCounts(env);
  const timeBudgetMs = readInt(
    env,
    "NECROMANCER_TIME_BUDGET_MS",
    BUDGET_DEFAULT,
    BUDGET_MIN,
    BUDGET_MAX,
    "an integer with 1000 <= NECROMANCER_TIME_BUDGET_MS <= 3600000",
  );
  const workRoot = readWorkRoot(env);
  return Object.freeze({ port, defaultCaseCount, maxCaseCount, timeBudgetMs, workRoot });
}

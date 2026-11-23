import { realpath } from "node:fs/promises";
import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import { SAMPLE_IDS, VARIANTS } from "../translator/index.js";
import type { SampleId } from "../translator/types.js";
import { toSampleDetail, toSampleSummary } from "./catalog-wire.js";
import {
  errorBody,
  FIXED_MESSAGES,
  NOT_FOUND_SAMPLE_MESSAGE,
  statusOf,
  type ErrorCode,
} from "./errors.js";
import {
  checkJsonContentType,
  declaredTooLarge,
  parseJsonObject,
  readBodyLimited,
  sendPayloadTooLarge,
} from "./body-reader.js";
import type { ProbeController } from "./probe.js";
import type { ProveRunner } from "./prove-runner.js";
import { validateProveRequest, type CaseCountLimits } from "./validate.js";
import { applySecurityHeaders } from "./security-headers.js";
import { serveStatic } from "./static-files.js";
import type { AppDeps } from "./types.js";
import type { HealthBody } from "./wire.js";

/** Mutable server state shared by the router and `app.shutdown()`. */
export interface AppState {
  shuttingDown: boolean;
}

/** Handler for `POST /api/prove`. Wired in a later task; until then the route answers 404. */
export type ProveHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

export interface RouterContext {
  readonly deps: AppDeps;
  readonly probe: ProbeController;
  readonly state: AppState;
  readonly prove?: ProveHandler;
}

const API_PREFIX = "/api/";
const SAMPLES_PREFIX = "/api/samples/";
const LOG_PATH_LIMIT = 200;

function sendJson(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    ...extra,
  });
  res.end(text);
}

function sendError(res: ServerResponse, code: ErrorCode, message: string, extra: Record<string, string> = {}): void {
  sendJson(res, statusOf(code), errorBody(code, message), extra);
}

function sendNotFound(res: ServerResponse, message: string = FIXED_MESSAGES.not_found): void {
  sendError(res, "not_found", message);
}

function sendMethodNotAllowed(res: ServerResponse, allow: string): void {
  sendError(res, "method_not_allowed", FIXED_MESSAGES.method_not_allowed, { Allow: allow });
}

function splitUrl(url: string): { readonly rawPath: string; readonly query: string } {
  const q = url.indexOf("?");
  return q === -1 ? { rawPath: url, query: "" } : { rawPath: url.slice(0, q), query: url.slice(q + 1) };
}

function findSampleId(candidate: string): SampleId | null {
  return SAMPLE_IDS.find((id) => id === candidate) ?? null;
}

/** Decodes the single segment after `/api/samples/` once. Null means 404. */
function parseSampleId(rawPath: string): SampleId | null {
  const rest = rawPath.slice(SAMPLES_PREFIX.length);
  if (rest === "" || rest.includes("/")) return null;
  try {
    return findSampleId(decodeURIComponent(rest));
  } catch {
    return null;
  }
}

async function healthRoute(ctx: RouterContext, query: string, res: ServerResponse): Promise<void> {
  if (new URLSearchParams(query).get("probe") === "1") await ctx.probe.run({ force: true });
  const oracle = ctx.probe.state();
  const cobcVersion = await ctx.deps.cobcVersion();
  const body: HealthBody = {
    status: oracle === "ready" ? "ok" : "degraded",
    oracle,
    cobcVersion,
    uptimeMs: Math.max(0, Math.floor(ctx.deps.now())),
  };
  sendJson(res, 200, body);
}

function samplesListRoute(ctx: RouterContext, res: ServerResponse): void {
  const body = SAMPLE_IDS.map((id) => toSampleSummary(ctx.deps.catalog.getSample(id)));
  sendJson(res, 200, body);
}

function sampleDetailRoute(ctx: RouterContext, id: SampleId, res: ServerResponse): void {
  const { getSample, getTranslation } = ctx.deps.catalog;
  const sample = getSample(id);
  const translations = VARIANTS.map((variant) => getTranslation(id, variant));
  sendJson(res, 200, toSampleDetail(sample, translations));
}

/** Runs a catalog-backed route; a catalog throw logs the cause and answers a generic 500. */
function guardCatalog(ctx: RouterContext, res: ServerResponse, work: () => void): void {
  try {
    work();
  } catch (err) {
    ctx.deps.logger.line(`catalog failed: ${describeError(err)}`);
    sendError(res, "internal_error", FIXED_MESSAGES.internal_error);
  }
}

function describeError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return "non-error thrown";
}

async function dispatchApi(
  ctx: RouterContext,
  method: string,
  rawPath: string,
  query: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  res.setHeader("Cache-Control", "no-store");
  if (rawPath === "/api/health") {
    if (method !== "GET") return sendMethodNotAllowed(res, "GET");
    return healthRoute(ctx, query, res);
  }
  if (rawPath === "/api/samples") {
    if (method !== "GET") return sendMethodNotAllowed(res, "GET");
    return guardCatalog(ctx, res, () => samplesListRoute(ctx, res));
  }
  if (rawPath === "/api/prove") {
    if (ctx.prove === undefined) {
      if (method !== "POST") return sendMethodNotAllowed(res, "POST");
      return sendNotFound(res);
    }
    return ctx.prove(req, res);
  }
  if (rawPath.startsWith(SAMPLES_PREFIX)) {
    const id = parseSampleId(rawPath);
    if (id === null) return method === "GET" ? sendNotFound(res, NOT_FOUND_SAMPLE_MESSAGE) : sendMethodNotAllowed(res, "GET");
    if (method !== "GET") return sendMethodNotAllowed(res, "GET");
    return guardCatalog(ctx, res, () => sampleDetailRoute(ctx, id, res));
  }
  return sendNotFound(res);
}

/**
 * Builds the `POST /api/prove` handler. Order: method, content type, declared
 * length, limited read, JSON object, field validation, then the runner.
 */
export function proveRoute(runner: Pick<ProveRunner, "handle">, limits: CaseCountLimits): ProveHandler {
  return async (req, res) => {
    if (req.method !== "POST") return sendMethodNotAllowed(res, "POST");
    if (!checkJsonContentType(req.headers["content-type"])) {
      return sendError(res, "unsupported_media_type", FIXED_MESSAGES.unsupported_media_type);
    }
    if (declaredTooLarge(req)) return sendPayloadTooLarge(req, res);
    const read = await readBodyLimited(req);
    if (!read.ok) {
      if (read.reason === "too_large") return sendPayloadTooLarge(req, res);
      res.destroy();
      return;
    }
    const parsed = parseJsonObject(read.body);
    if (!parsed.ok) return sendError(res, "invalid_json", FIXED_MESSAGES.invalid_json);
    const checked = validateProveRequest(parsed.value, limits);
    if (!checked.ok) return sendError(res, checked.code, checked.message);
    return runner.handle(checked.value, res);
  };
}

function isApiPath(rawPath: string): boolean {
  return rawPath === "/api" || rawPath.startsWith(API_PREFIX);
}

function installRequestLog(ctx: RouterContext, req: IncomingMessage, res: ServerResponse, rawPath: string): void {
  const started = ctx.deps.now();
  const method = (req.method ?? "").slice(0, 16);
  const shownPath = rawPath.slice(0, LOG_PATH_LIMIT);
  let logged = false;
  const log = (): void => {
    if (logged) return;
    logged = true;
    const ms = Math.max(0, Math.round(ctx.deps.now() - started));
    ctx.deps.logger.line(`${method} ${shownPath} ${String(res.statusCode)} ${String(ms)}ms`);
  };
  res.on("finish", log);
  res.on("close", log);
}

function failRequest(ctx: RouterContext, res: ServerResponse, err: unknown): void {
  ctx.deps.logger.line(`request failed: ${describeError(err)}`);
  if (res.headersSent) {
    res.destroy();
    return;
  }
  try {
    sendError(res, "internal_error", FIXED_MESSAGES.internal_error);
  } catch {
    res.destroy();
  }
}

export function createHandler(ctx: RouterContext): RequestListener {
  let realRoot: Promise<string> | null = null;
  const staticRoot = (): Promise<string> => {
    realRoot ??= realpath(ctx.deps.staticRoot).catch((err: unknown) => {
      realRoot = null;
      throw err;
    });
    return realRoot;
  };

  const route = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const { rawPath, query } = splitUrl(req.url ?? "");
    installRequestLog(ctx, req, res, rawPath);
    if (!rawPath.startsWith("/")) return sendNotFound(res);
    if (isApiPath(rawPath)) return dispatchApi(ctx, req.method ?? "", rawPath, query, req, res);
    return serveStatic(req, res, await staticRoot());
  };

  return (req, res) => {
    applySecurityHeaders(res);
    route(req, res).catch((err: unknown) => {
      failRequest(ctx, res, err);
    });
  };
}

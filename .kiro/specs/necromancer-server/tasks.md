# Implementation Plan: necromancer-server

## Overview

Implement `src/server/` (plain `node:http`, TypeScript strict, no `any`), `Dockerfile.app`, `public/index.html`, the `build:server` script, the steering edits and `tests/server/`. Nothing in `src/equivalence/`, `src/oracle/` or `src/translator/` is modified. If a change there looks necessary, stop and ask the user.

The plan is a thin slice first, then the image, then the prove route:

1. **Thin slice (tasks 1 to 4):** config, security headers, catalog mappers, oracle adapter with the single frozen Shared_Oracle_Config, cobc version, work directory preparation, probe, static files, router, `GET /api/health`, `GET /api/samples`, `GET /api/samples/:id`, `main.ts` with graceful shutdown, and the `build:server` esbuild script. All route tests use an injected fake Oracle backend. Checkpoint (task 5).
2. **App image early (tasks 6 and 7):** `Dockerfile.app`, `.dockerignore`, a local `docker build` and `docker run` in the three configurations, and the observations needed for `docs/kiro-log.md`. Checkpoint (task 7) before any prove-route work.
3. **POST /api/prove with the fake Oracle (tasks 8 to 10):** body reader, validation, mappers, prove runner (Run_Slot, abort, budget, backstop, watchdog, 503, shutdown), and their route tests. Checkpoint (task 10).
4. **Real-Oracle integration tests (task 11)** through HTTP, with a loud preflight.
5. **Bundle test, deployment test, steering, docs, final verification (tasks 12 to 14).**

Rules for every task:

- Every file under `src/server/` uses explicit types, small functions and no `any`. Request data never reaches a COBOL string, path, command or log format string (Req 7.10).
- Each task ends by running `npm run typecheck`, `npm run lint` and the Vitest files it added (`npx vitest --run <file>`). Checkpoints run the full `npm test`. The sample equivalence suite (`scripts/run-samples.sh`) runs at the final verification (task 13.4) and at checkpoints 10 and 14.
- New tests live in `tests/server/`, use no `it.skip`, `describe.skipIf`, `it.runIf`, `test.todo` and no early `return` on a missing dependency (Req 13.8). Each property test carries the tag comment `// Feature: necromancer-server, Property N: <title>`.
- Only `tests/translator/deployment.test.ts` is modified outside `tests/server/`.
- Docker commands in tasks 6 and 11 are one-shot verification commands. Long-running containers are started with `docker run -d` and stopped with `docker rm -f`; never block on a foreground server.
- Interfaces `OracleBackend`, `ServerConfig`, `Timings`, `AppDeps` from the design live in `src/server/types.ts` (a small addition to the file table so `app.ts`, `main.ts` and the tests can import them without cycles).

## Tasks

- [x] 1. Foundation types, config, headers, catalog mappers
  - [x] 1.1 Create `src/server/types.ts`, `wire.ts`, `errors.ts`, `config.ts`
    - `types.ts`: `OracleBackend`, `ServerConfig`, `Timings`, `AppDeps`, `ServerLogger` exactly as in the design
    - `wire.ts`: `HealthBody`, `SampleSummary`, `SampleDetail`, `ProveRequest`, `ProgressWire`, `ReportWire`, `ErrorWire`. `ProgressWire` has no key containing `score`; `ErrorWire` has exactly `type`, `code`, `message`
    - `errors.ts`: `ErrorCode` union, `errorBody(code, message)`, code-to-status table, the fixed messages from the Error Handling table
    - `config.ts`: `loadServerConfig(env)` returning a frozen `ServerConfig` or throwing `ServerConfigError` that names the variable. Rules: `PORT` 1..65535 (default 10000); `NECROMANCER_DEFAULT_CASE_COUNT` default 1000, `100 <= v <= MAX`; `NECROMANCER_MAX_CASE_COUNT` default 2000, `<= 100000`; `NECROMANCER_TIME_BUDGET_MS` default 60000, `1000..3600000`; `NECROMANCER_WORK_ROOT` default `$HOME/work`, absolute. Values must match `/^[0-9]+$/` and be safe integers; unset or empty uses the default; echoed values are cut to 40 characters. Cross-field failure when only MAX is set below the default names `NECROMANCER_DEFAULT_CASE_COUNT` and says to set both
    - Run typecheck and lint
    - _Requirements: 1.1, 1.3, 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 8.3, 8.10_
  - [x] 1.2 Write tests in `tests/server/config.test.ts`
    - **Property 1: Environment configuration is validated totally**
    - **Validates: Requirements 1.3, 15.1, 15.2, 15.3, 15.4**
    - Unit tests: every default; each invalid value names its variable; cross-field cases (MAX alone 500, DEFAULT above MAX, MAX 100001, budget 999 and 3600001, `PORT` `0`, `65536`, `"80a"`, `" 80"`, `"+80"`, `"1e3"`, `"1.5"`); empty string uses the default; the returned config is frozen
    - _Requirements: 13.12, 15.1, 15.2, 15.3_
  - [x] 1.3 Create `src/server/security-headers.ts` and `src/server/catalog-wire.ts`
    - `applySecurityHeaders(res)`: `Content-Security-Policy: default-src 'self'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`; removes `X-Powered-By` and `Server`; never sets `Access-Control-*`
    - `toSampleSummary`, `toSampleDetail`: explicit allowlist object literals (no spreads of catalog objects, no `candidate`, `FieldDescriptor` copied key by key); `translations` always in order `correct`, `subtle`, `naive`
    - Run typecheck and lint
    - _Requirements: 3.1, 3.2, 3.4, 5.1, 5.2, 5.3, 6.1, 6.2, 6.3_
  - [x] 1.4 Write allowlist tests in `tests/server/catalog-wire.test.ts`
    - **Property 6 (mapper part): Sample responses are allowlisted data**
    - **Validates: Requirements 5.1, 5.2, 5.3, 6.1, 6.2, 6.3**
    - fast-check over catalog-shaped objects with extra enumerable properties (functions, `candidate`, unknown keys): output has exactly the documented keys, contains no function after `JSON.parse(JSON.stringify(...))`, no `candidate` key anywhere; three translations in the documented order
    - _Requirements: 6.3, 13.4_

- [x] 2. Oracle adapter, probe, cobc version, work directory
  - [x] 2.1 Create `src/server/oracle-adapter.ts`
    - `createOracleAdapter({ backend, workRoot })` with the frozen `sharedConfig` (`workerCommand` frozen `["node", "/opt/oracle/worker.js", "--work-root", workRoot]`), the wrapper `port: OraclePort` that ignores any caller-supplied config, `compile`, `backend`, and `reset` (calls `backend.shutdown()`)
    - The only `compileCobol(` call site in `src/server`, with a comment that records why (the Oracle keeps one Worker client created from the first config, and `/work` cannot be created by a non-root user)
    - Run typecheck and lint
    - _Requirements: 10.2, 16.1, 16.2, 16.3, 16.4_
  - [x] 2.2 Write tests in `tests/server/shared-config.test.ts`
    - **Property 14: Every Oracle compile call uses the one frozen Shared_Oracle_Config**
    - **Validates: Requirements 10.2, 16.1, 16.2, 16.3, 16.5**
    - Recording fake backend; `toBe` identity of the second argument for probe calls and Engine port calls over arbitrary interleavings; `Object.isFrozen` on `sharedConfig` and `workerCommand`; `workerCommand` value; no recorded call with an undefined config; the port ignores a caller-supplied config; `reset()` calls `backend.shutdown()`
    - Grep test: `compileCobol(` appears exactly once across `src/server/**/*.ts`, in `oracle-adapter.ts`
    - _Requirements: 10.2, 13.13, 16.5_
  - [x] 2.3 Create `src/server/cobc-version.ts`
    - `parseCobcVersion(stdout)` with `/^cobc \(GnuCOBOL\) (\d+\.\d+\.\d+(?:\.\d+)?)/` on the first line, else `null`
    - `readCobcVersion(exec)` using one fixed `execFile("cobc", ["--version"], { timeout: 5000, maxBuffer: 16 * 1024, shell: false, windowsHide: true })`, result cached for the process, never repeated; a cached accessor that waits at most 1000 ms for an in-flight call and then yields `null`
    - Run typecheck and lint
    - _Requirements: 3.6, 4.4, 10.8_
  - [x] 2.4 Create `src/server/workdir.ts`
    - `prepareWorkRoot(workRoot, fsPort)`: `mkdir` recursive mode 0700 (failure throws an error naming the path and error code), write `.necro-check-<pid>` with `#!/bin/sh\nexit 0\n` mode 0700 (failure throws "cannot write to"), `access(file, X_OK)`; on failure log `work root <path> does not allow executing files (noexec mount?)` and return `execAllowed: false`; remove the check file best effort. Does not execute the file
    - Creates no other directory; `TMPDIR` is not needed because the Worker uses the handle directory
    - Run typecheck and lint
    - _Requirements: 10.3, 10.4, 10.5, 10.8_
  - [x] 2.5 Create `src/server/probe.ts`
    - `createProbe(deps)` returning `ProbeController` (`state`, `run({force})`, `markUnavailable`)
    - Real probe: `adapter.compile(getSample("interest").cobolSource)`, require a handle (`isCompiledHandle`), `runCompiled(handle, examples[0].input)`, success only if `status === "ok"` and `stdout === examples[0].output` strictly, `releaseHandle` in `finally`
    - Single flight (one shared promise, cleared in `finally`); 15 s timeout via `Timings.probeTimeoutMs` counts as unavailable and calls `adapter.reset()`; failure calls `reset()` and logs only a short fixed reason; no probe while `slot.isTaken()` (returns the last state); `probeMinIntervalMs` returns the last result for a probe finished too recently; initial state `unavailable`; `execAllowed === false` returns `unavailable` without calling the backend
    - Run typecheck and lint
    - _Requirements: 4.2, 4.6, 4.7, 4.8, 10.5, 16.2_
  - [x] 2.6 Write tests in `tests/server/probe.test.ts`
    - **Property 15: Oracle_State is `ready` only after a real, matching probe**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.6, 4.7, 4.8**
    - Scripted fake behaviors: compile failure of every status, a non-handle value, run status other than `ok`, stdout differing by any single edit (including a missing trailing newline), a thrown error, a hang past the timeout (fake timers); `ready` iff handle and `ok` and strict equality
    - Single flight: two concurrent probes make exactly one backend compile call; no probe while the slot is taken; min-interval behavior; initial state is `unavailable`; health body has no stack or path; handle released on every path
    - _Requirements: 4.2, 4.6, 4.7, 4.8_
  - [x] 2.7 Write tests in `tests/server/cobc-version.test.ts` and `tests/server/workdir.test.ts`
    - `parseCobcVersion`: `3.1.2.0`, 3-part version, garbage, empty, multi-line; `readCobcVersion` calls the exec fake exactly once across repeated reads; failure and timeout give `null`; the 1000 ms wait
    - `prepareWorkRoot` with a temp dir and an injected fs port: creates nested directories; clear message on mkdir failure and on write failure; a non-executable root returns `execAllowed: false` and logs the path; the check file is removed
    - _Requirements: 4.4, 10.3, 10.4, 10.5, 13.1_

- [x] 3. HTTP skeleton: static files, router, health, samples
  - [x] 3.1 Create `src/server/static-files.ts` and the placeholder `public/index.html`
    - `resolveStaticPath(rawPath, realRoot)`: `/` maps to `index.html`; decode once; reject NUL, backslash, any `..` or dot-prefixed segment, trailing `/`; `realpath` prefix check against the real root; directories 404; fixed Content-Type table with `charset=utf-8` on text types including svg; `serveStatic` with `GET`/`HEAD`, `pipeline(createReadStream, res)`, `Cache-Control: no-cache` for `index.html` and `public, max-age=3600` otherwise; 405 with `Allow: GET, HEAD`
    - `public/index.html`: names the app, no `<script>`, no inline style (CSP `default-src 'self'`)
    - Run typecheck and lint
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_
  - [x] 3.2 Write tests in `tests/server/static.test.ts`
    - **Property 3: Static path resolution never leaves the Static_Root**
    - **Validates: Requirements 2.3, 2.4**
    - Temp `public/` with a dotfile and a planted symlink out of the root; fast-check over arbitrary path strings (encoded `..`, NUL, backslash, dot segments, absolute paths): result is 404 or a regular file whose real path is inside the root without a dot segment; directories never listed
    - Examples: content type per extension, `HEAD` has headers and no body, 405 with `Allow`, cache headers for `index.html` vs others, the placeholder has no `<script>`
    - _Requirements: 2.1 to 2.7, 13.1_
  - [x] 3.3 Create `src/server/routes.ts` and `src/server/app.ts`
    - `createApp(deps)` returns `{ server, shutdown, state }`, no `process.*` access. Server options: `maxHeaderSize: 8192`, `headersTimeout` 15 s, `requestTimeout` 30 s, `keepAliveTimeout` 65 s, `maxConnections` 64
    - Per request: security headers first; split at first `?`; `/api/` paths get `Cache-Control: no-store`; exact route table (`/api/health` GET, `/api/samples` GET, `/api/samples/:id` GET, `/api/prove` POST wired later); 404 JSON for unknown API paths, 405 with `Allow` for wrong methods (`OPTIONS` gets 405); sample id decoded once inside `try`, compared with `SAMPLE_IDS.includes`; top-level `try/catch` answers generic 500 or destroys the socket if headers were sent
    - `GET /api/health`: `{status, oracle, cobcVersion, uptimeMs}`, always 200, `?probe=1` triggers `probe.run`
    - `GET /api/samples` and `/api/samples/:id` through `catalog-wire`; catalog throw gives generic 500 and logs the cause
    - One log line per request on `finish` and on `close` without finish (method, path without query, status, ms); bodies and query never logged
    - `app.shutdown()` sets `shuttingDown`, closes the server and idle connections, calls `backend.shutdown()`, then closes all connections (the prove runner hook is added in task 9)
    - Run typecheck and lint
    - _Requirements: 1.5, 1.6, 1.7, 2.8, 3.1, 3.3, 3.5, 4.1, 4.2, 4.3, 4.5, 4.6, 5.1, 5.2, 6.1, 6.4, 6.5, 6.6_
  - [x] 3.4 Write tests in `tests/server/headers.test.ts`
    - **Property 4: Security headers appear on every response**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4**
    - In-process server on port 0 with the fake backend; fast-check over method, path and header values; covers static, JSON, 404, 405, 413 (once task 8 exists, extended in 9.4) and 500 (throwing catalog); no `Access-Control-*`, no `X-Powered-By`, no `Server`; `Cache-Control: no-store` on every `/api/` response; `OPTIONS` gets 405
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 13.1_
  - [x] 3.5 Write tests in `tests/server/routes.test.ts`
    - **Property 5: Unknown API paths and unknown sample ids are 404 JSON**
    - **Property 6: Sample responses are allowlisted data**
    - **Validates: Requirements 2.8, 6.4, 5.1, 5.2, 5.3, 6.1, 6.2, 6.3**
    - Unknown ids including `__proto__`, `constructor`, `toString`, encoded and malformed escapes give 404 JSON; unknown `/api/` paths never return `index.html`; list has three samples in order with exactly the four keys; detail JSON after `JSON.parse` has no function and no `candidate` key and exactly three translations in order; each translation `source` equals the file text on disk; throwing catalog gives generic 500 without a path or stack in the body and logs the cause; 405 with `Allow` on both sample routes; health shape for ready and degraded (200 in both) and `?probe=1` re-probe
    - _Requirements: 2.8, 4.1 to 4.3, 5, 6, 13.1, 13.4_

- [x] 4. Entry point, shutdown, esbuild script
  - [x] 4.1 Create `src/server/main.ts`
    - The only file that reads `process.env` and calls `process.exit`. Order: `loadServerConfig` (exit non-zero with the message on error), `prepareWorkRoot`, real `createOracleAdapter` with `import * as oracle`, `createApp`, `listen(port, "0.0.0.0")`, then start `cobc --version` and the first probe in the background
    - SIGTERM and SIGINT start a 5 s hard timer (exit 1), call `app.shutdown()`, exit 0; a second signal is ignored
    - Logs only `PORT` and the three numeric settings
    - Run typecheck and lint
    - _Requirements: 1.3, 1.4, 1.5, 10.3, 15.6_
  - [x] 4.2 Add the `build:server` script to `package.json`
    - `esbuild src/server/main.ts --bundle --platform=node --target=node22 --format=esm --outfile=dist/server/server.js --sourcemap=external`; no `--define` of `import.meta.url`; add the `createRequire` banner only if the bundle fails with a dynamic `require` error
    - Run `npm run build:server` and confirm `dist/server/server.js` exists; run typecheck and lint
    - _Requirements: 1.2, 1.8_
  - [ ]* 4.3 Write tests in `tests/server/static-scan.test.ts`
    - Greps `src/server/**/*.ts` for `eval(`, `new Function`, `node:vm`, `exec(`, `shell: true`, `Access-Control`, `: any`, `as any`; child-process usage is limited to the one fixed `execFile("cobc", ["--version"]`
    - _Requirements: 3.6, 10.8, 1.2_
  - [ ]* 4.4 Write tests in `tests/server/shutdown.test.ts`
    - `app.shutdown()` stops accepting connections, calls `backend.shutdown()` once, resolves with no active run, and a second call is safe; a request after shutdown begins gets 503 `shutting_down` (prove part verified in 9.6)
    - _Requirements: 1.5, 9.6_

- [x] 5. Checkpoint - thin slice
  - Run `npm run typecheck`, `npm run lint` and `npm test`. Ensure all tests pass, ask the user if questions arise.

- [x] 6. App image (early)
  - [x] 6.1 Create `Dockerfile.app`
    - Stage 1 `build` from `node:22.11.0-bookworm-slim@sha256:f035ba7ffee18f67200e2eb8018e0f13c954ec16338f264940f701997e3c12da`: `npm ci`, copy `src/`, run `npm run build:worker && npm run build:server`
    - Final stage `ubuntu:24.04`: `apt-get install -y --no-install-recommends gnucobol libstdc++6`, copy `node` from the build stage, `--chmod=0555` worker at `/opt/oracle/worker.js`, user `necro` uid/gid 10001 with `/usr/sbin/nologin`, `/home/necro/work` mode 0700, `WORKDIR /app`, copy `dist/server/server.js` to `./dist/server/server.js`, `public/`, `cobol-samples/`, `src/translator/translations/` (readable by uid 10001, `--chmod=a+rX` or `chmod -R a+rX`)
    - `ENV NODE_ENV=production PORT=10000 HOME=/home/necro NECROMANCER_IN_ORACLE_IMAGE=1`, `EXPOSE 10000`, node-based `HEALTHCHECK` that succeeds on HTTP 200, `USER 10001:10001`, exec-form `CMD ["node", "dist/server/server.js"]`; no `COPY . .`, no `node_modules`, no `tests/`, `.kiro/`, `docs/`
    - The existing `Dockerfile` is not changed
    - _Requirements: 10.1, 10.6, 11.1, 11.2, 11.3, 11.4, 11.5, 11.7, 11.8_
  - [x] 6.2 Adjust `.dockerignore`
    - Keep every current exclusion; confirm no pattern matches `public`, `cobol-samples/*.cbl`, `src/translator/translations/` or any file in it; optionally add `deploy-test`, `scripts`, `Dockerfile`, `Dockerfile.app`; do not exclude `src/`, `tsconfig.json`, `package.json`, `package-lock.json`
    - _Requirements: 11.6_
  - [x] 6.3 Create `scripts/check-app-image.sh`
    - Builds `Dockerfile.app` as `necromancer-app`, runs the three configurations from the design (default, `--tmpfs /tmp`, `--read-only --tmpfs /tmp --tmpfs /home/necro/work:rw,exec,nosuid,uid=10001,gid=10001,mode=0700,size=128m`) detached, polls `/api/health?probe=1` until `oracle:"ready"` or fails after 60 s, prints image size and `docker stats --no-stream` memory at idle, removes the containers; also runs the `noexec` configuration (`--tmpfs /tmp:rw,noexec` with `NECROMANCER_WORK_ROOT=/tmp/work`) and expects `degraded` with the log line naming the path
    - _Requirements: 10.5, 10.7, 11.9, 14.1_
  - [x] 6.4 Build and run the image locally, record observations
    - `docker build -f Dockerfile.app -t necromancer-app .`; note the build time and the image size
    - Verify with `docker run -d` and `curl`/`docker exec`: `GET /api/health` answers within 3 s of start (note the startup time); `oracle:"ready"` after `?probe=1` with the default Work_Root, with `--tmpfs /tmp` and with the `--read-only` plus exec work volume; `GET /api/samples/interest` returns non-empty `cobolSource` and three non-empty translation sources, which proves the catalog paths resolve from `/app/dist/server/server.js`; `docker exec necromancer id -u` is 10001 and the Worker runs as the same uid; `NECROMANCER_WORK_ROOT=/tmp/work` on `--tmpfs /tmp:rw,noexec` gives `degraded` health and a log line naming the path
    - Measure idle memory with `docker stats --no-stream`; if possible also memory during a 2000-case run once task 11 exists (revisit in 13.3)
    - Write the figures (build time, image size, startup time, idle memory, each configuration result) to `docs/app-image-observations.md` for task 13.3; remove all containers (`docker rm -f`)
    - If Docker is not available, stop and report the missing piece; do not skip
    - _Requirements: 1.8, 10.5, 10.6, 10.7, 11.9, 14.1_

- [x] 7. Checkpoint - image works
  - Ensure `docker build` succeeded and every verification in 6.4 passed. Run `npm run typecheck`, `npm run lint` and `npm test`. Ensure all tests pass, ask the user if questions arise before starting any prove-route work.

- [x] 8. Prove request: body, validation, mappers
  - [x] 8.1 Create `src/server/body-reader.ts`
    - `checkJsonContentType` (`/^application\/json(?:\s*;\s*charset=utf-8)?$/i`), `readBodyLimited(req, 1024)` that counts bytes per chunk and stops past the limit (413 with `Connection: close`, `req.destroy()` on `res` finish), a `Content-Length` over 1024 gives 413 without reading, `parseJsonObject` with `TextDecoder("utf-8", { fatal: true })` and a plain-object check
    - Run typecheck and lint
    - _Requirements: 7.1, 7.2, 7.3_
  - [x] 8.2 Create `src/server/validate.ts`
    - `validateProveRequest(body: unknown, limits)` total over `unknown`: own keys via `Object.keys`, subset of `sampleId`, `variant`, `caseCount`, `seed`; first unknown key named in the message (JSON-quoted, cut to 40 characters); `sampleId` and `variant` via `Array.includes`; `caseCount` absent gives default, else safe integer in `[100, maxCaseCount]`; `seed` absent gives `undefined`, else int32 integer, `-0` normalized; reads with `Object.hasOwn`; failures carry the codes and fixed messages of the Error Handling table
    - Run typecheck and lint
    - _Requirements: 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.10_
  - [x] 8.3 Write tests in `tests/server/validate.test.ts`
    - **Property 2 (validator part): Prove request validation is total and side-effect free on rejection**
    - **Validates: Requirements 7.3, 7.4, 7.5, 7.6, 7.7, 7.8**
    - fast-check over `fc.jsonValue()` and arbitrary objects with random keys including `__proto__`, `constructor`, `toString`: result is a valid `ProveRequest` (catalog `sampleId` and `variant`, `caseCount` integer in range, `seed` absent or int32) or a 400 failure naming the field or key; example per rule (strings, floats, `NaN`, unsafe integers, 99, 2001, seed 2147483648, `-0`); the message states the range in force
    - _Requirements: 7.3 to 7.8, 13.5_
  - [x] 8.4 Create `src/server/mappers.ts`
    - `toProgressWire`, `toReportWire(report, echo)`, `toEngineErrorWire`: explicit allowlist literals, no spreads. `toReportWire` throws unless `outcome === "completed"` and `matchScore !== undefined`; passes `matchScore` through unchanged; `complete = !aborted && !budgetReached`; copies `shrunkExamples` field by field; never reads `inconclusiveCases`, `oracleMessage`, `oracleStatus`, `shrinkOracleCalls`, `containsInconclusive`
    - Run typecheck and lint
    - _Requirements: 8.3, 8.5, 8.6, 8.7, 8.8, 8.10, 8.12_
  - [~] 8.5 Write tests in `tests/server/mappers.test.ts`
    - **Property 7: Progress events never carry a score**
    - **Property 8: Report mapping is an allowlist that passes the Engine's score through**
    - **Property 9 (mapper part): Only a completed Engine outcome can produce a score, and error events never contain one**
    - **Validates: Requirements 8.3, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 8.12**
    - Generated `ProgressEvent` objects with extra `matchScore`/`score` keys give exactly the seven keys and no key containing `score`; generated `EquivalenceReport` values with extra properties and path or stack-trace strings give exactly the documented keys, `matchScore` strictly equal, `complete` equals `!aborted && !budgetReached`, no `inconclusiveCases`, no value containing `oracleMessage`; `toReportWire` throws for `inconclusive`, `oracle_unavailable` and a missing score; error mapper output has exactly `type`, `code`, `message` and no score or count keys
    - _Requirements: 8.3, 8.5 to 8.10, 8.12_

- [ ] 9. Prove runner and POST /api/prove
  - [ ] 9.1 Create `src/server/prove-runner.ts` (slot, writer, normal path)
    - `RunSlot` with synchronous `tryTake` and a per-run `Symbol` token so `release` is idempotent and a late release cannot free a newer run
    - `NdjsonWriter` (`progress`, `final`, `end`): drops writes when closed or `clientGone`; `res.write` returning false makes `progress` return a promise resolved by `drain` or `close`; `final` sets `closed` before writing; one `JSON.stringify` line per event
    - `handle`: take the slot, `200` with `application/x-ndjson; charset=utf-8`, `Cache-Control: no-store`, `X-Accel-Buffering: no`, `flushHeaders`, build Engine options only from `getSample(sampleId).cobolSource`, `fields`, `getTranslation(sampleId, variant).candidate`, `caseCount`, optional `seed`, `timeBudgetMs`, `signal`, `onProgress`, `oracle: adapter.port`; map outcomes (`completed` with score gives `report`; `inconclusive`, `oracle_unavailable` give `error`, the latter also `probe.markUnavailable()`; Engine throw gives `engine_config` or `internal_error` with the cause logged); `finally` clears timers, ends the response once, releases the slot
    - Run typecheck and lint
    - _Requirements: 7.10, 8.1, 8.2, 8.3, 8.4, 8.5, 8.7, 8.8, 8.9, 8.10, 9.1, 9.2, 9.5_
  - [ ] 9.2 Extend `prove-runner.ts`: abort, budget, backstop, watchdog
    - `AbortController`; `res.on("close")` and `req.on("close")` before the final event set `clientGone` and abort; the backstop timer aborts at `timeBudgetMs + abortBackstopGraceMs`; an exit watchdog starts at abort and, after `engineExitGraceMs` without an Engine return, writes the `timeout` error, calls `probe.markUnavailable()` and `adapter.reset()`, and releases the slot; a run ended by budget or abort (not disconnect) still sends a `report` with `complete: false`
    - Run typecheck and lint
    - _Requirements: 8.12, 9.2, 9.3, 9.4, 9.5_
  - [ ] 9.3 Wire the route: 503 path, shutdown, `proveRoute`
    - In `prove-runner.ts`: `shuttingDown` gives 503 `shutting_down` before any slot; slot taken gives 429 with `Retry-After: 5` and code `busy` (early check, then the synchronous `tryTake` after any await); Oracle_State `unavailable` runs one single-flight `probe.run()` without holding the slot, and if still unavailable answers 503 with one NDJSON `error` line `oracle_unavailable` and does not call the Engine; `abortActive()` and `idle()`
    - In `routes.ts`: `proveRoute` in the order method, content type (415), `Content-Length` (413), limited read (413), JSON object (400), `validateProveRequest`, then `runner.handle`; in `app.ts`: wire the runner and make `shutdown()` call `abortActive()` and wait for `idle()` before `backend.shutdown()`
    - Run typecheck and lint
    - _Requirements: 1.5, 7.1, 7.2, 7.8, 7.9, 8.11, 9.1, 9.6_
  - [ ]* 9.4 Write tests in `tests/server/prove-validation.http.test.ts`
    - **Property 2 (HTTP part): Prove request validation is total and side-effect free on rejection**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8**
    - fast-check with `fc.uint8Array()` bodies and random content types and lengths over real HTTP; every rejection is a 4xx JSON `{type:"error",code,message}` (not a stream, no score) with the Run_Slot free and the fake backend call count 0
    - Examples: 415, 413 by header, 413 by chunked body, 413 by a lying `Content-Length`, 400 per bad field and per unknown key, 404 unknown sample id, 405 with `Allow`; extend the header property of 3.4 to 413 and 415 responses
    - _Requirements: 7.1 to 7.9, 13.1, 13.5_
  - [ ]* 9.5 Write tests in `tests/server/prove-run.test.ts`
    - **Property 9 (stream part): Only a completed Engine outcome can produce a score, and error events never contain one**
    - **Property 10: NDJSON framing**
    - **Property 13: Only catalog COBOL and the catalog Candidate reach the Oracle**
    - **Validates: Requirements 8.1, 8.2, 8.4, 8.7, 8.8, 8.9, 8.10, 4.7, 7.10**
    - Fake Oracle backend with the real Engine and real Candidate: every line is valid JSON, progress lines first and non-decreasing `completed`, exactly one final line, nothing after it, the report has every field of Req 8.5, progress lines have no key containing `score`; every `compileCobol` source equals `getSample(id).cobolSource` and the Candidate is the catalog's; Oracle unavailable (fake `environment_error` and failing probe) gives 503 with a single `error` line and no `matchScore` in the body; Engine throw gives an `error` event and a free slot; inconclusive and `oracle_unavailable` outcomes give `error` events; backpressure with a slow reader
    - _Requirements: 8.1 to 8.11, 13.2, 13.3_
  - [ ]* 9.6 Write tests in `tests/server/concurrency.test.ts`
    - **Property 11: Run_Slot is taken and released exactly once on every exit path**
    - **Property 12: Every compiled handle is released**
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5, 9.6**
    - Interleaved requests: a second request while one runs gets 429 with `Retry-After` and the first run still completes; releases equal takes on every exit path (report, inconclusive, Engine throw, client disconnect, budget, abort, backstop timeout with millisecond `Timings`, shutdown); the slot is reusable afterwards; client disconnect aborts and the fake sees no further `runCompiled` call; `releaseHandle` called exactly once per handle and no live handles remain; a late release of an old token does not free a newer run; a request after shutdown begins gets 503; shutdown ends an in-flight stream with a `report` with `complete: false`; the watchdog marks the Oracle `unavailable` and resets the backend
    - _Requirements: 9.1 to 9.6, 13.3_
  - [ ]* 9.7 Write tests in `tests/server/logging.test.ts`
    - **Property 16: Logs never contain request bodies or the query string**
    - **Validates: Requirements 1.6, 15.6**
    - fast-check over body bytes and query strings; the captured logger lines contain neither; request log format `METHOD path status Nms`; only `PORT` and the three numeric settings are ever logged from the environment
    - _Requirements: 1.6, 15.6_
  - [ ]* 9.8 Write tests in `tests/server/budget.test.ts`
    - The configured `timeBudgetMs` reaches the Engine as `timeBudgetMs` (small injected budget so the test runs in milliseconds); a run ended by budget or abort gives a `report` with `complete: false` and `budgetReached` or `aborted` true and the score of the cases that ran; a normal run gives `complete: true`; configured default and maximum `caseCount` are applied (default used when absent, max enforced, message states the range in force)
    - _Requirements: 7.6, 8.12, 9.4, 13.3, 15.1_

- [ ] 10. Checkpoint - prove route
  - Run `npm run typecheck`, `npm run lint`, `npm test` and `scripts/run-samples.sh`. Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Real-Oracle integration tests
  - [ ]* 11.1 Write tests in `tests/server/integration.test.ts`
    - One file, one app, one module-level Oracle client. `beforeAll` runs a preflight that throws an `Error` naming the missing piece: in Docker mode, `docker version` fails gives "Docker daemon is not running or not reachable", `docker image inspect necromancer-oracle` fails gives "Oracle_Image 'necromancer-oracle' is missing: run docker build -t necromancer-oracle ."; in In_Image_Mode (`NECROMANCER_IN_ORACLE_IMAGE=1`), `cobc --version` fails gives "cobc not found", a missing `/opt/oracle/worker.js` gives "worker bundle /opt/oracle/worker.js missing". No skip, `skipIf`, `runIf`, `todo` or early return
    - `createApp` with the real backend (`import * as oracle`), real catalog and real Engine; `workRoot` is `/work` in Docker mode; `afterAll` calls `app.shutdown()` so `oracle.shutdown()` runs
    - Over HTTP with a fixed `seed` and a `caseCount` that fits the test timeout: `interest/correct` gives `matchScore === 1` and `complete: true`; `interest/naive` gives `matchScore < 1` and a non-empty `mismatches` list whose items each have `input`, `oracleOutput`, `candidateOutput`, `group`; `interest/subtle` gives `naive < matchScore < 1` for the same seed; `GET /api/health?probe=1` gives `oracle: "ready"` and a `cobcVersion` starting with `3.1.2`
    - Run the file, typecheck and lint
    - _Requirements: 4.7, 13.6, 13.7, 13.8, 13.9_

- [ ] 12. Built-bundle test
  - [ ]* 12.1 Write tests in `tests/server/bundle.test.ts`
    - Runs `npm run build:server` (a build failure fails the test, never skips); copies `dist/server/server.js` to `<tmp>/dist/server/server.js` and the data to `<tmp>/cobol-samples/`, `<tmp>/src/translator/translations/`, `<tmp>/public/`; starts the bundle as a child process on a free port with `NECROMANCER_WORK_ROOT` in the temp dir; `GET /api/samples/interest` returns a non-empty `cobolSource` equal to `cobol-samples/interest.cbl` on disk and three non-empty translation `source` values each equal to the matching file in `src/translator/translations/`; `/api/health` has the documented shape (oracle may be `unavailable` here); no data copy exists next to the bundle; the child is killed in `afterAll`
    - _Requirements: 1.8, 13.11_

- [ ] 13. Deployment test, steering, docs, final verification
  - [ ]* 13.1 Extend `tests/translator/deployment.test.ts`
    - Delete the TODO and add `describe("deployment: Dockerfile.app")` that reads `Dockerfile.app` and asserts on the final stage (text after the last `FROM`): copies of `cobol-samples/`, `src/translator/translations/` and `public/` to the App_Root paths; server bundle at `/app/dist/server/server.js`; worker at `/opt/oracle/worker.js` with `--chmod=0555`; exec-form `CMD ["node", "dist/server/server.js"]`; `NECROMANCER_IN_ORACLE_IMAGE=1`; non-root `USER` (not `root`, not `0`); no `COPY . .` and no `node_modules` in the final stage; `HEALTHCHECK`, `EXPOSE 10000`, `PORT=10000`, `WORKDIR /app`; first `FROM` contains `node:22.11.0-bookworm-slim@sha256:`, last `FROM ubuntu:24.04`; the Oracle `Dockerfile` assertion stays
    - With the existing `parseIgnoreRules` and `isIgnored`: `public`, `public/index.html`, the three `.cbl` files and every file from `readdirSync("src/translator/translations")` are not ignored
    - _Requirements: 11.10, 11.6_
  - [ ] 13.2 Update steering files
    - `.kiro/steering/tech.md`: replace the Front end and Back end lines and the Deployment line as in the design (static files in `public/`, plain Node `node:http` server built with esbuild, no framework, Render free Docker web service with `Dockerfile.app`, one container); `.kiro/steering/structure.md`: add `/src/server/`, `/public/`, `Dockerfile.app`, describe `Dockerfile` as the Oracle test image, replace the `/src/app/ UI (Next.js)` line with `/public/`; no other lines or files change
    - _Requirements: 12.1, 12.2, 12.3_
  - [ ] 13.3 Add the `docs/kiro-log.md` entry
    - Render settings (Docker, port 10000, health check path `/api/health`), image size, startup time, idle memory and memory at the maximum `caseCount` (measure a 2000-case run with `docker stats` and update `docs/app-image-observations.md`), the environment variables with defaults, the build and run commands including `docker run --tmpfs /tmp`, and the statement that the server relies on no user COBOL reaching the Phase A Oracle; then remove or fold `docs/app-image-observations.md` into the entry
    - _Requirements: 10.9, 11.9, 14.1_
  - [ ] 13.4 Final verification
    - Run `npm run typecheck`, `npm run lint`, `npm test` and `scripts/run-samples.sh` (the sample equivalence suite); fix any failure in the new code, never in `src/equivalence/`, `src/oracle/` or `src/translator/`
    - _Requirements: 13.10_

- [ ] 14. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks per the workflow convention. All design properties (1 to 16) and all tests named in the requirements are present as tasks.
- Property coverage: P1 in 1.2; P2 in 8.3 and 9.4; P3 in 3.2; P4 in 3.4 (extended in 9.4); P5 in 3.5; P6 in 1.4 and 3.5; P7, P8, P9 in 8.5 and 9.5; P10 in 9.5; P11, P12 in 9.6; P13 in 9.5; P14 in 2.2; P15 in 2.6; P16 in 9.7.
- Task 6.4 is a verification task that requires Docker. If Docker is missing, report it instead of skipping.
- No task modifies `src/equivalence/`, `src/oracle/` or `src/translator/`.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "2.1", "2.3", "2.4", "3.1", "4.2"] },
    { "id": 2, "tasks": ["1.4", "2.2", "2.5", "2.7", "3.2"] },
    { "id": 3, "tasks": ["2.6", "3.3"] },
    { "id": 4, "tasks": ["3.4", "3.5", "4.1"] },
    { "id": 5, "tasks": ["4.3", "4.4", "6.1", "6.2", "6.3"] },
    { "id": 6, "tasks": ["6.4"] },
    { "id": 7, "tasks": ["8.1", "8.2", "8.4"] },
    { "id": 8, "tasks": ["8.3", "8.5", "9.1"] },
    { "id": 9, "tasks": ["9.2"] },
    { "id": 10, "tasks": ["9.3"] },
    { "id": 11, "tasks": ["9.4", "9.5", "9.6", "9.7", "9.8"] },
    { "id": 12, "tasks": ["11.1", "12.1", "13.1", "13.2"] },
    { "id": 13, "tasks": ["13.3"] },
    { "id": 14, "tasks": ["13.4"] }
  ]
}
```

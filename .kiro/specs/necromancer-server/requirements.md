# Requirements Document

## Introduction

The Necromancer_Server is one small plain Node process (`node:http` only, no web framework, no Next.js). It serves the static UI files and exposes a JSON API over three existing modules: the Sample_Catalog (`src/translator/`), the Equivalence_Engine (`src/equivalence/`) and the Oracle (`src/oracle/`, GnuCOBOL 3.1.2). It runs in one Docker container on Render's free tier (512 MB RAM, sleeps when idle) and replaces the hello-world in `deploy-test/`.

The server bundle is built to `dist/server/server.js`. The Sample_Catalog resolves its data files with `new URL("../../" + relative, import.meta.url)`, so a bundle at `<App_Root>/dist/server/server.js` resolves them against `<App_Root>` with no change to `src/translator/`. In the image the App_Root is `/app`.

The server only works on the catalog samples. A user can choose a sample, a variant, a case count and a seed. A user can never upload code or COBOL, and nothing a user sends reaches the Oracle.

Scope: the server (`src/server/`), the app image (`Dockerfile.app`), the matching `.dockerignore` rules, the steering updates, and tests. Out of scope: the real UI (a later spec, only a placeholder `public/index.html` is delivered here), authentication, persistence, LLM calls, the analyzer, the repair loop.

Hard constraints: `src/equivalence/`, `src/oracle/` and `src/translator/` are NOT modified. If a change there turns out to be necessary, work stops and the user is asked.

Written in TypeScript strict mode with no `any`.

## Glossary

- **Server**: The Necromancer_Server process, started from `dist/server/server.js`.
- **App_Root**: The directory that contains `dist/`, `cobol-samples/`, `src/translator/translations/` and `public/`. In the App_Image it is `/app`.
- **Sample_Catalog**: `getSample`, `listSamples`, `getTranslation` from `src/translator/`.
- **Engine**: `runEquivalence` from `src/equivalence/`.
- **Oracle**: The COBOL runner in `src/oracle/`, reached through an `OraclePort` handed to the Engine.
- **Oracle_Port_Adapter**: The Server module that builds the `OraclePort` (real Oracle plus the Shared_Oracle_Config) and, in tests, accepts a fake.
- **Shared_Oracle_Config**: The single frozen Oracle config object, created once at startup by the Oracle_Port_Adapter and passed by reference to every Oracle `compileCobol` call.
- **Oracle_State**: `ready` or `unavailable`, the result of the last Probe.
- **Probe**: A real end-to-end check of the Oracle: compile `interest.cbl` through the Oracle, run the first Example_Pair of the sample, and compare stdout with its documented output. Success means `ready`.
- **Prove_Run**: One execution of the Engine started by `POST /api/prove`.
- **Run_Slot**: The single permit that allows one Prove_Run at a time.
- **Server_Config**: The validated values of `NECROMANCER_DEFAULT_CASE_COUNT`, `NECROMANCER_MAX_CASE_COUNT` and `NECROMANCER_TIME_BUDGET_MS`, read once at startup.
- **Time_Budget**: The overall Prove_Run time in milliseconds from Server_Config (default 60000).
- **NDJSON_Stream**: A response with `Content-Type: application/x-ndjson`, one JSON object per line, each line ending in `\n`.
- **Event**: One NDJSON line, with `type` equal to `progress`, `report` or `error`.
- **Static_Root**: The `public/` directory.
- **In_Image_Mode**: The Oracle mode selected by `NECROMANCER_IN_ORACLE_IMAGE=1`, where the Worker is a direct child process and Docker is not used.
- **Work_Root**: The directory where the Oracle Worker creates its handle directories.
- **App_Image**: The image built from `Dockerfile.app`.
- **Oracle_Image**: The existing image built from `Dockerfile`, used only by the Oracle tests.

## Requirements

### Requirement 1: Server process

**User Story:** As the operator, I want a small server that starts fast and stops cleanly, so that it fits Render's free tier.

#### Acceptance Criteria

1. THE Server SHALL use only Node built-ins (`node:http`, `node:fs`, `node:path`, `node:url`, etc.) plus the existing project modules and `decimal.js`. It SHALL NOT add a web framework or any new runtime dependency.
2. THE Server SHALL be built with esbuild into `dist/server/server.js` through a new npm script `build:server`, as ESM for Node 22, with TypeScript strict mode and no `any`.
3. THE Server SHALL read the port from the `PORT` environment variable, default 10000, and SHALL listen on `0.0.0.0`. IF `PORT` is set and is not an integer from 1 to 65535, THEN THE Server SHALL exit with a non-zero code and a message naming the variable.
4. THE Server SHALL start listening before the first Probe finishes. The first Probe SHALL run in the background and SHALL NOT delay startup.
5. WHEN the Server receives SIGTERM or SIGINT, THE Server SHALL stop accepting new connections, abort the active Prove_Run if any, call the Oracle `shutdown()`, close the HTTP server, and exit with code 0. IF this takes longer than 5 seconds, THEN THE Server SHALL exit anyway with a non-zero code.
6. THE Server SHALL log one line per request to stdout (method, path without query, status, duration) and SHALL NOT log request bodies.
7. THE Server SHALL catch every unhandled error in a request handler and answer 500 with a generic JSON error (no stack trace, no file paths). It SHALL NOT crash on a malformed request.
8. THE Server SHALL be started from `<App_Root>/dist/server/server.js` so that the Sample_Catalog path `../../<relative>` resolves to `<App_Root>/<relative>`. THE Server SHALL NOT rely on `--define` of `import.meta.url`, on copying data to other locations, or on any change in `src/translator/`.

### Requirement 2: Static files

**User Story:** As a visitor, I want the UI files served safely, so that the later UI spec has a place to live.

#### Acceptance Criteria

1. THE Server SHALL serve files from the Static_Root for `GET` and `HEAD` requests. `/` SHALL serve `index.html`.
2. THE Server SHALL deliver a placeholder `public/index.html` that names the app and contains no script.
3. THE Server SHALL resolve each path after URL decoding, SHALL reject any path that contains a NUL byte, a backslash, or a segment equal to `..`, and SHALL verify that the resolved real path is inside the Static_Root. A rejected path SHALL get 404.
4. THE Server SHALL NOT list directories, SHALL NOT serve dotfiles, and SHALL NOT follow a symlink that leaves the Static_Root.
5. THE Server SHALL set `Content-Type` from a fixed extension table (html, css, js, json, svg, png, ico, woff2, txt) with `charset=utf-8` for text types, and `application/octet-stream` otherwise.
6. THE Server SHALL answer 405 with an `Allow` header for any other method on a static path.
7. THE Server SHALL set `Cache-Control: no-cache` on `index.html` and `Cache-Control: public, max-age=3600` on other static files.
8. THE Server SHALL answer 404 JSON for any `/api/` path that is not a defined endpoint, and SHALL NOT fall back to `index.html` for it.

### Requirement 3: Security headers and request limits

**User Story:** As the operator, I want safe defaults on every response, so that the public service is hard to abuse.

#### Acceptance Criteria

1. THE Server SHALL set on every response: `Content-Security-Policy: default-src 'self'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and `X-Frame-Options: DENY`.
2. THE Server SHALL NOT send any `Access-Control-*` header and SHALL NOT answer `OPTIONS` preflight requests (405).
3. THE Server SHALL set `Cache-Control: no-store` on every `/api/` response.
4. THE Server SHALL NOT send an `X-Powered-By` or `Server` header that names its software.
5. THE Server SHALL set connection limits on the HTTP server: `headersTimeout` and `requestTimeout` so a client that never finishes its request is dropped, and a maximum header size of 8 KB.
6. THE Server SHALL NOT use `eval`, `new Function`, `vm`, or any shell. The only child processes the Server starts itself are the one fixed `execFile("cobc", ["--version"])` call of Requirement 4.4, started once at startup, and the Oracle Worker that the Oracle starts. "No shell commands" means: no shell (`shell: false`, no `exec`, no `sh -c`) and no argument derived from a request. Both child processes SHALL use a fixed command and a fixed argument list.

### Requirement 4: GET /api/health

**User Story:** As the operator and the UI, I want to know whether the proof machinery works, so that the UI can show the truth before a run.

#### Acceptance Criteria

1. WHEN `GET /api/health` is received, THE Server SHALL answer 200 with JSON `{status, oracle, cobcVersion, uptimeMs}`.
2. `oracle` SHALL be `"ready"` only when the last Probe succeeded, and `"unavailable"` in every other case, including before the first Probe has finished.
3. `status` SHALL be `"ok"` when `oracle` is `"ready"` and `"degraded"` otherwise. The HTTP status SHALL stay 200 in both cases so Render's health check does not restart a server whose only problem is the Oracle.
4. THE Server SHALL determine `cobcVersion` with one `execFile("cobc", ["--version"])` call, `shell: false`, a timeout of 5 seconds and a capped output, made once at startup. THE Server SHALL cache the result for the life of the process and SHALL NOT repeat the call on a re-probe or on a health request. `cobcVersion` SHALL be the version string reported by `cobc` (for example `"3.1.2.0"`), or `null` when the call failed or the output is not recognised.
5. `uptimeMs` SHALL be a non-negative integer, the time since the Server started.
6. THE Server SHALL run a Probe at startup (Requirement 1.4) and SHALL re-run it when `GET /api/health?probe=1` is received. Concurrent Probes SHALL share one in-flight Probe. A Probe SHALL NOT run while a Prove_Run is active (the last Oracle_State is returned instead). A Probe SHALL time out after 15 seconds and count as `unavailable`.
7. THE Server SHALL NOT report `ready` unless the Probe really compiled and ran COBOL through the Oracle and the stdout matched the documented output. A fake or cached success from a previous process SHALL NOT be possible.
8. A Probe failure SHALL NOT crash the Server and SHALL NOT include a stack trace or file path in the response.

### Requirement 5: GET /api/samples

**User Story:** As the UI, I want the list of samples, so that the Crypt screen can show the tombstones.

#### Acceptance Criteria

1. WHEN `GET /api/samples` is received, THE Server SHALL answer 200 with a JSON array of exactly three objects, in catalog order (`interest`, `payroll`, `tax`).
2. Each object SHALL contain exactly: `id`, `name`, `trapLabel`, `defaultInput` (array of strings).
3. THE list SHALL NOT contain COBOL source, translations, or any function.

### Requirement 6: GET /api/samples/:id

**User Story:** As the UI, I want everything about one sample in one call, so that the Ritual screen needs no other request.

#### Acceptance Criteria

1. WHEN `GET /api/samples/:id` is received with a valid id, THE Server SHALL answer 200 with a JSON object containing: `id`, `name`, `trapLabel`, `cobolSource`, `fields` (the FieldDescriptors), `curses` (id, label, lines), `fidelityPact`, `examples` (input, output), `defaultInput`, and `translations`.
2. `translations` SHALL contain exactly three entries, one per variant (`correct`, `subtle`, `naive`), each with `variant`, `source` (the readable TypeScript source text), `provenance` (label, generatedWith, date) and `markers` (curseId, line).
3. THE response SHALL NOT contain the `candidate` function or any other function. The Server SHALL build the response from an explicit allowlist of fields, not by serializing catalog objects directly.
4. WHEN the id is not one of the catalog ids, THE Server SHALL answer 404 with an `error` JSON body. The id SHALL be checked against the catalog id list (not with `in` or a property lookup, so `__proto__` and `constructor` are plain unknown ids).
5. IF the catalog throws (for example a source file cannot be read), THEN THE Server SHALL answer 500 with a generic error and SHALL log the cause. It SHALL NOT return partial data.
6. Non-GET methods on these two routes SHALL get 405 with an `Allow` header.

### Requirement 7: POST /api/prove, request validation

**User Story:** As the operator, I want every input checked before any work starts, so that no request can cause harm.

#### Acceptance Criteria

1. THE Server SHALL accept `POST /api/prove` only with `Content-Type: application/json` (an optional `charset=utf-8` is accepted). Any other type SHALL get 415.
2. THE Server SHALL read at most 1024 bytes of body. IF `Content-Length` exceeds 1024, THEN THE Server SHALL answer 413 without reading the body. IF the body grows beyond 1024 bytes while being read (chunked or lying length), THEN THE Server SHALL stop reading, answer 413 and close the connection.
3. THE body SHALL parse as a JSON object. Invalid JSON, an array, `null` or a scalar SHALL get 400.
4. THE body SHALL accept exactly these keys: `sampleId`, `variant`, `caseCount`, `seed`. An unknown key SHALL get 400 that names the key.
5. `sampleId` SHALL be a string equal to one catalog id. `variant` SHALL be a string equal to one of `correct`, `subtle`, `naive`. A missing or invalid value SHALL get 400 with a message that names the field and lists the valid values.
6. `caseCount` SHALL be, when present, a JSON integer from 100 (fixed minimum) to the configured maximum (`NECROMANCER_MAX_CASE_COUNT`, default 2000) inclusive; when absent it SHALL be the configured default (`NECROMANCER_DEFAULT_CASE_COUNT`, default 1000). A string, a float, `NaN`, a number outside the range or an unsafe integer SHALL get 400, and the message SHALL state the valid range in force.
7. `seed` SHALL be, when present, a JSON integer in the int32 range; when omitted the Engine chooses it. Anything else SHALL get 400.
8. All validation SHALL finish before the Run_Slot is taken, before any Oracle call and before the first byte of an NDJSON_Stream. Validation failures SHALL be JSON `{"type":"error","code":<string>,"message":<string>}` with a 4xx status, never a stream, and SHALL NOT contain a score.
9. THE Server SHALL answer 405 with an `Allow` header for other methods on `/api/prove`.
10. THE only COBOL text that can reach the Oracle SHALL be `getSample(sampleId).cobolSource`, and the only Candidate that can run SHALL be `getTranslation(sampleId, variant).candidate`. No request field SHALL be concatenated into a COBOL source, a file path, a command or a log format string.

### Requirement 8: POST /api/prove, execution and NDJSON stream

**User Story:** As the UI, I want live progress and one final report, so that the Verdict is built only from a real run.

#### Acceptance Criteria

1. WHEN validation passes, the Oracle_State is `ready` and the Run_Slot is free, THE Server SHALL take the Run_Slot, answer 200 with `Content-Type: application/x-ndjson; charset=utf-8`, `Cache-Control: no-store` and `X-Accel-Buffering: no`, flush the headers, and call the Engine with the sample's `cobolSource` and `fields`, the translation's `candidate`, the validated `caseCount` and `seed`, `timeBudgetMs` equal to the Time_Budget, an `AbortSignal`, an `onProgress` callback and the Oracle_Port_Adapter.
2. THE stream SHALL consist of zero or more `{"type":"progress", ...}` lines followed by exactly one final line, either `{"type":"report", ...}` or `{"type":"error", ...}`. Nothing SHALL be written after the final line, and the response SHALL then be ended.
3. A `progress` Event SHALL carry the Engine's ProgressEvent fields (`completed`, `target`, `group`, `matched`, `mismatches`, `inconclusive`) and SHALL NOT carry a score or any field named `matchScore`.
4. THE Server SHALL write Events in the order the Engine produced them. It SHALL respect backpressure: when `write` returns false, the `onProgress` callback SHALL return a promise that resolves on `drain`, so the Engine slows down instead of buffering.
5. THE `report` Event SHALL contain: `matchScore` (number from 0 to 1), `complete` (boolean), `casesRun`, `conclusiveCount`, `matchedCount`, `mismatchCount`, `groups` (per group: group, conclusive, matched, inconclusive), `mismatches` (the capped list; each item has `input` (string array), `oracleOutput`, `candidateOutput`, `group`), `mismatchListTruncated`, `shrunkExamples`, `inconclusiveCount`, `inconclusiveByStatus`, `seed`, `elapsedMs`, `aborted`, `budgetReached`, plus the echoed `sampleId`, `variant` and `caseCount`.
6. THE `report` Event SHALL be built by an explicit allowlist mapper. The Server SHALL NOT forward Oracle stderr, Oracle messages, file paths, or stack traces to the client. In a report, `inconclusiveCases` SHALL NOT be included; only the counts are.
7. A `matchScore` SHALL be sent only when the Engine returned an EquivalenceReport with outcome `completed` after a Prove_Run that really executed. The Server SHALL NOT compute, estimate, default or round a score itself; it SHALL pass through the Engine's value unchanged.
8. IF the Engine returns outcome `inconclusive` (no conclusive case) or `oracle_unavailable`, THEN THE Server SHALL send an `error` Event (codes `inconclusive` and `oracle_unavailable`) and no `report` and no `matchScore`.
9. IF the Engine throws (for example `EquivalenceConfigError` or an unexpected error), THEN THE Server SHALL send one `error` Event with a generic message and a stable `code`, log the cause, and release the Run_Slot.
10. An `error` Event SHALL have the shape `{"type":"error","code":<string>,"message":<string>}` and SHALL NOT contain `matchScore`, `score` or counts that could be read as a result.
11. WHEN the Oracle_State is `unavailable` at the moment a valid request arrives, THE Server SHALL re-run one Probe first (single-flight, Requirement 4.6). IF the Oracle_State is still `unavailable`, THEN THE Server SHALL answer HTTP 503 with a single `error` Event (code `oracle_unavailable`) in NDJSON form and SHALL NOT run the Engine.
12. A Prove_Run that ends because the Time_Budget was reached or because of an abort (not a client disconnect) SHALL still send a `report` Event with `budgetReached` or `aborted` set to true, containing the score of the cases that really ran. In every `report`, `complete` SHALL be true only when both `aborted` and `budgetReached` are false, and false otherwise. A report with `complete` false is non-final: clients SHALL treat it as a partial result and SHALL NOT present it as a final verdict.

### Requirement 9: Concurrency, abort and time budget

**User Story:** As the operator, I want one run at a time that always ends, so that a 512 MB free instance stays alive.

#### Acceptance Criteria

1. THE Server SHALL allow one Prove_Run at a time. WHEN a valid request arrives while the Run_Slot is taken, THE Server SHALL answer 429 with a `Retry-After` header and an `error` JSON body (code `busy`, message of one short sentence). The check and the take of the Run_Slot SHALL be one synchronous step so two simultaneous requests cannot both win.
2. THE Server SHALL release the Run_Slot exactly once on every exit path: report, error, Engine throw, client disconnect, time budget and shutdown.
3. WHEN the client connection closes before the final Event is written (`close` on the response or request), THE Server SHALL abort the Engine's AbortSignal, SHALL NOT write further to the socket, and SHALL release the Run_Slot after the Engine has returned.
4. THE Server SHALL apply the Time_Budget (default 60 000 ms) to every Prove_Run: it SHALL pass `timeBudgetMs` equal to the Time_Budget to the Engine, and SHALL also abort the AbortSignal at Time_Budget + 5 000 ms as a backstop. IF the Engine still has not returned 5 seconds after the abort, THEN THE Server SHALL send an `error` Event (code `timeout`), release the Run_Slot, and mark the Oracle_State `unavailable` so the next request re-probes.
5. THE Server SHALL release the compiled handle of a Prove_Run through the Engine's own cleanup, and SHALL NOT leak Worker handle directories after a run ends, aborts or fails.
6. THE Server SHALL NOT start a Prove_Run after shutdown has begun (503).

### Requirement 10: Oracle in the container

**User Story:** As the operator, I want the Oracle to run inside the app container without Docker-in-Docker, as a non-root user, even with a read-only or empty `/tmp`.

#### Acceptance Criteria

1. THE App_Image SHALL set `NECROMANCER_IN_ORACLE_IMAGE=1`, so the Oracle's launcher selection uses the direct launcher (Worker as a child process, no Docker).
2. THE Shared_Oracle_Config SHALL contain a `workerCommand` of `["node", "/opt/oracle/worker.js", "--work-root", <Work_Root>]`, because the Worker's default root `/work` cannot be created by a non-root user and the direct launcher passes no `--work-root`. This SHALL be done through the Oracle's existing `config` parameter, with no change in `src/oracle/`. Requirement 16 governs how this object is shared.
3. THE Server SHALL read the Work_Root from `NECROMANCER_WORK_ROOT`, with a default of a directory that is NOT on `/tmp` and not on a mount that may be `noexec` (default `$HOME/work`). It SHALL create it with `mkdir` recursive at every startup, before the first Probe, and SHALL exit with a clear message if it cannot create it or cannot write to it.
4. THE Server SHALL create every other directory it needs at startup with `mkdir` recursive (and SHALL NOT assume any directory in the image exists at runtime), including the directory it uses as `TMPDIR` for the Worker if different from the Work_Root.
5. THE Server SHALL verify at startup that the Work_Root allows executing a file created in it (the compiled COBOL program is executed from there). IF it does not (for example a `noexec` mount), THEN THE Server SHALL log a message naming the path and the cause, and the Probe SHALL fail so health reports `unavailable`.
6. THE App_Image SHALL run the Server as a non-root user (fixed uid, not 0, no login shell) with `USER` set in `Dockerfile.app`. The Worker and every program it starts SHALL run as that same user.
7. THE App_Image SHALL work when started with `docker run --tmpfs /tmp` and with `--read-only` plus a writable Work_Root volume or tmpfs with `exec`. A test script or documented command SHALL show the container reaching `oracle: "ready"` in that configuration.
8. THE Server SHALL start no child process other than: the Oracle Worker (started by the Oracle), and the single fixed `cobc --version` call of Requirement 4.4 made once at startup. This is the only child process the Server starts itself besides the Oracle Worker; the exception to "no shell commands" in Requirement 3.6 covers exactly this call and nothing else.
9. The Oracle in its current state (task list of `cobol-oracle-runner`, Phase A) has no per-program user separation, no `prlimit` and no network isolation. This is acceptable only because no user-provided COBOL ever reaches it (Requirement 7.10). THE Server SHALL be documented, in the spec design and in `docs/kiro-log.md`, as relying on that property.

### Requirement 11: App image

**User Story:** As the operator, I want one image that builds and runs on Render's free tier.

#### Acceptance Criteria

1. THE repository SHALL contain a new `Dockerfile.app`. The existing `Dockerfile` (Oracle_Image) SHALL NOT be changed.
2. `Dockerfile.app` SHALL be based on `ubuntu:24.04` and SHALL install `gnucobol` (3.1.2 from the Ubuntu archive) and its runtime needs with `--no-install-recommends`, and SHALL provide Node 22 the same pinned way as the Oracle_Image (copied from `node:22.11.0-bookworm-slim` pinned by tag and digest).
3. THE build SHALL produce `dist/server/server.js` and `dist/worker.js` (through `npm run build:server` and `npm run build:worker`) inside a build stage, so the image does not depend on a locally built `dist/`. THE final stage SHALL place the server bundle at `/app/dist/server/server.js`. `dist/worker.js` SHALL be installed as `/opt/oracle/worker.js`, mode 0555, because In_Image_Mode starts it there.
4. THE final stage SHALL use `/app` as App_Root and SHALL copy: `dist/server/` to `/app/dist/server/`, `public/` to `/app/public/`, `cobol-samples/` to `/app/cobol-samples/`, and `src/translator/translations/` to `/app/src/translator/translations/`. These paths are where the Sample_Catalog resolves its files from `/app/dist/server/server.js` (Requirement 1.8).
5. THE final stage SHALL NOT contain `node_modules`, `tests/`, `.kiro/`, `docs/` or the TypeScript sources other than `src/translator/translations/*.ts` read as text.
6. `.dockerignore` SHALL NOT exclude `public/`, `cobol-samples/*.cbl`, or `src/translator/translations/`. Existing exclusions that do not conflict (for example `cobol-samples/bin`, `node_modules`) SHALL stay. IF `dist` stays excluded, the image SHALL still build because of Requirement 11.3.
7. THE image SHALL define `WORKDIR /app`, `EXPOSE 10000`, `ENV PORT=10000`, `ENV NODE_ENV=production`, and a `CMD` in exec form that runs `node dist/server/server.js` without a shell.
8. THE image SHALL define a `HEALTHCHECK` that calls `GET /api/health` and succeeds on HTTP 200 (not on `oracle: "ready"`).
9. THE image SHALL start the Server and answer `GET /api/health` within 3 seconds of container start on a developer machine, and the built image SHALL fit the free tier's 512 MB at idle and during a run at the maximum caseCount (measured and noted in `docs/kiro-log.md`).
10. `tests/translator/deployment.test.ts` SHALL be extended (the TODO in that file is resolved) to assert, by reading `Dockerfile.app`: it copies `cobol-samples/` and `src/translator/translations/` into the final stage at the App_Root paths of Requirement 11.4; it copies `public/`; it installs the worker at `/opt/oracle/worker.js`; it places the server bundle at `/app/dist/server/server.js`; its `CMD` is `node dist/server/server.js`; it sets `NECROMANCER_IN_ORACLE_IMAGE=1`; it sets a non-root `USER`; it does not contain `COPY . .` of the whole repository into the final stage. The test SHALL also parse `.dockerignore` with the existing parser and assert that `public/`, the three `.cbl` files and every file in `src/translator/translations/` are not ignored (Requirement 12.3 of the sample-catalog spec).

### Requirement 12: Steering updates

**User Story:** As a developer, I want the steering files to match the architecture, so that later specs do not assume Next.js.

#### Acceptance Criteria

1. `.kiro/steering/tech.md` SHALL replace "Next.js (App Router) + React" and "Next.js API routes or a small Node service" with: a plain Node `node:http` server built with esbuild, no web framework, and a UI made of static files in `public/` (Tailwind and Figma stay as the design inputs; the UI technology is decided in the UI spec). The Deployment line SHALL name Render's free Docker web service and the one-container rule.
2. `.kiro/steering/structure.md` SHALL list `/src/server/` (HTTP server, routes, prove runner, oracle adapter), `/public/` (static UI files served by the server), `Dockerfile.app` (app image) and keep `Dockerfile` described as the Oracle test image. The line about `/src/app/ UI (Next.js)` SHALL be removed or replaced by `public/`.
3. THE two steering files SHALL otherwise be unchanged, and no other steering file SHALL be edited.

### Requirement 13: Tests

**User Story:** As the developer, I want fast route tests and honest real-Oracle tests, so that the server's claims are verified.

#### Acceptance Criteria

1. THE route tests SHALL start the Server on port 0 with an injected fake Oracle port and call it over real HTTP. They SHALL cover: static file served, path traversal rejected, security headers on every response class (static, JSON, stream, error), no `Access-Control-*` header, 405 and 404 cases, and every validation rule of Requirement 7 (415, 413 by header and by streamed body, 400 for each bad field and unknown key, 404 unknown sample).
2. THE route tests SHALL assert, with a fake Engine run (fake Oracle port and a Candidate through the real Engine), that the NDJSON lines are valid JSON, `progress` lines come first, exactly one final line exists, nothing follows it, the `report` has every field of Requirement 8.5, and `progress` lines never contain a score.
3. THE route tests SHALL cover: a second prove request while one runs gets 429 and the first run still completes; the Run_Slot is free again afterwards; client disconnect aborts the Engine (the fake Oracle sees no further calls) and frees the Run_Slot; the Oracle unavailable (fake `compileCobol` returning `environment_error`, and Probe failing) gives HTTP 503 with a single `error` Event and no `matchScore` anywhere in the body; an Engine throw gives an `error` Event and frees the Run_Slot; the Time_Budget from Server_Config is passed to the Engine as `timeBudgetMs` (checked with an injected small budget so the test runs in milliseconds); a run that ends on budget or abort gives a `report` with `complete` false, and a normal run gives `complete` true.
4. THE route tests SHALL assert that `GET /api/samples/:id` JSON, after `JSON.parse`, contains no function and no `candidate` key, and that its translations' `source` equals the file text.
5. A property test (fast-check) SHALL feed arbitrary JSON bodies and arbitrary byte strings to `POST /api/prove` validation and SHALL assert: the outcome is either a valid parsed request or a 4xx error with no Run_Slot taken and no Oracle call.
6. THE integration tests SHALL run through the HTTP layer against the real Oracle (no fake): `interest/correct` gives `matchScore` equal to 1 and `complete` true; `interest/naive` gives a `matchScore` below 1 and a non-empty `mismatches` list where each item has `input`, `oracleOutput`, `candidateOutput`, `group`; `interest/subtle` gives a `matchScore` that is strictly below 1 and strictly above the `naive` score for the same seed. They SHALL use a fixed `seed` and a `caseCount` that keeps each test under the test timeout.
7. THE integration tests SHALL assert `GET /api/health` reports `oracle: "ready"` and a `cobcVersion` starting with `3.1.2`.
8. NO test SHALL skip silently. A test that needs the real Oracle SHALL fail with a message that names the missing piece (Docker daemon, Oracle_Image `necromancer-oracle`, or `cobc`) when it is not available. `it.skip`, `describe.skipIf`, `it.runIf`, `test.todo` and early `return` on a missing dependency SHALL NOT be used in the new tests.
9. THE new tests SHALL live in `tests/server/` and SHALL NOT modify existing tests except `tests/translator/deployment.test.ts` (Requirement 11.10).
10. BEFORE the work is declared done, `npm run typecheck`, `npm run lint` and `npm test` SHALL pass, and the sample equivalence suite (`scripts/run-samples.sh`) SHALL pass.
11. A bundle test SHALL build `dist/server/server.js` with `npm run build:server`, copy it into a temporary App_Root laid out like the image (`<tmp>/dist/server/server.js`, `<tmp>/cobol-samples/`, `<tmp>/src/translator/translations/`, `<tmp>/public/`), and start it from that location as a child process on a free port. WHEN `GET /api/samples/interest` is requested, THE test SHALL assert that `cobolSource` is non-empty and equals the text of `cobol-samples/interest.cbl` on disk, and that the three translation `source` values are non-empty and each equals the text of the matching file in `src/translator/translations/` on disk. THE test SHALL fail, not skip, if the build fails. THE test SHALL also assert that the same bundle started from a location that is not two directories below an App_Root is not relied upon (no copy of the data next to the bundle is made).
12. THE unit tests SHALL cover the Server_Config validation (Requirement 15): every valid default, each invalid value naming its variable, and each cross-field rule.
13. THE Shared_Oracle_Config test of Requirement 16.5 SHALL be part of the new tests.

### Requirement 14: Documentation

**User Story:** As a judge or reviewer, I want to see how the server was built.

#### Acceptance Criteria

1. THE work SHALL add an entry to `docs/kiro-log.md` that records the Render settings used (Docker, port 10000, health check path `/api/health`), the image size, the idle and maximum-caseCount memory figures, the environment variables of Requirement 15 with their defaults, and the commands to build and run the App_Image locally, including `docker run --tmpfs /tmp`.

### Requirement 15: Configuration by environment variables

**User Story:** As the operator, I want to tune run size and time without rebuilding the image, so that the free tier can be protected or relaxed with a setting.

#### Acceptance Criteria

1. THE Server SHALL read `NECROMANCER_DEFAULT_CASE_COUNT` (default 1000), `NECROMANCER_MAX_CASE_COUNT` (default 2000) and `NECROMANCER_TIME_BUDGET_MS` (default 60000) once at startup into the Server_Config. The minimum `caseCount` SHALL stay fixed at 100.
2. THE Server SHALL accept a value only when it is a base-10 integer string with no sign, spaces or decimal point. An unset or empty variable SHALL use its default.
3. IF a variable violates any of these rules, THEN THE Server SHALL exit with a non-zero code before listening and SHALL print a message that names the variable and the rule: `100 <= NECROMANCER_DEFAULT_CASE_COUNT <= NECROMANCER_MAX_CASE_COUNT`; `NECROMANCER_MAX_CASE_COUNT <= 100000`; `1000 <= NECROMANCER_TIME_BUDGET_MS <= 3600000`.
4. THE Server SHALL derive the abort backstop as `NECROMANCER_TIME_BUDGET_MS + 5000` ms (Requirement 9.4).
5. THE Server SHALL NOT change Server_Config after startup and SHALL NOT accept any of these values from a request.
6. THE Server SHALL NOT log environment variables other than the three names and values above and `PORT`.

### Requirement 16: Shared Oracle config

**User Story:** As the operator, I want every Oracle call to use the same config, so that the one Worker client the Oracle creates uses the `--work-root` I set, whichever call comes first.

#### Acceptance Criteria

1. THE Oracle_Port_Adapter SHALL create exactly one Shared_Oracle_Config at startup, frozen with `Object.freeze` (including its `workerCommand` array), before the first Probe.
2. THE Probe and every Prove_Run SHALL pass that same object reference as the config argument of every Oracle `compileCobol` call. No other config object SHALL be created or passed.
3. THE Server SHALL contain no code path that calls the Oracle without the Shared_Oracle_Config, including the Probe, the Engine's OraclePort and any shutdown or cleanup call that accepts a config.
4. THE reason SHALL be documented in the code and the design: the Oracle keeps one Worker client, created with the first config it sees, so a call without the `--work-root` config could start the Worker with the default root `/work`, which a non-root user cannot create.
5. A unit test with a recording fake Oracle SHALL assert, with `toBe` (same reference), that the config received by the Probe's `compileCobol` call and the config received by each `compileCobol` call made by the Engine during a Prove_Run are identical to the Shared_Oracle_Config, that this config's `workerCommand` equals `["node", "/opt/oracle/worker.js", "--work-root", <Work_Root>]`, that the object is frozen, and that the recording fake saw no `compileCobol` call without a config.

## Resolved decisions

1. Catalog paths: option (b). The bundle is `dist/server/server.js` under the App_Root, so `src/translator/files.ts` is unchanged.
2. `cobcVersion`: one fixed `execFile("cobc", ["--version"])` at startup, cached, no shell. Stated as an explicit exception in Requirements 3.6 and 10.8.
3. Oracle unavailable at prove time: HTTP 503 with a single NDJSON `error` line.
4. Partial runs: sent as a `report` with `budgetReached` or `aborted` true and `complete` false. Case counts and time budget are configurable (Requirement 15).
5. Work_Root default `$HOME/work`, override with `NECROMANCER_WORK_ROOT`.
6. `dist/` is built inside `Dockerfile.app` (multi-stage).

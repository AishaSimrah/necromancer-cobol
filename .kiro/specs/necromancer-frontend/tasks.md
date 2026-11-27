# Implementation Plan: necromancer-frontend

## Overview

Implement the static single page in `src/frontend/` (plain TypeScript, strict, no `any`, no runtime dependency), bundled by esbuild into `public/app.js`, plus `public/index.html`, `public/app.css`, `public/decor/*.svg`, the build pipeline, the `Dockerfile.app` changes and `tests/frontend/`. Nothing in `src/server/`, `src/equivalence/`, `src/oracle/` or `src/translator/` is modified. `src/server/wire.ts` is imported as types only. If a change there looks necessary, stop and ask the user.

A working page comes first, decorations come last:

1. **Build pipeline (task 1):** scripts, fonts, tsconfig split, Vitest globalSetup, Docker and ignore files, with a placeholder `main.ts`.
2. **Core modules (task 2):** pure, DOM-free logic and its tests.
3. **DOM and page (task 3):** API layer, proof session, Crypt, Ritual, Verdict, error views, `index.html`, `app.css`. Decorations are omitted or stubbed. Checkpoint (task 4) loads the page against the real server.
4. **Deploy checkpoint (task 5):** app image check and Render deployment (manual steps for the user).
5. **Decorations (task 6):** SVG artwork, `decorations.ts`, skeleton, ghosts, smoke, fog, keyframes, Reduced_Motion block.
6. **Verification (task 7) and final checkpoint (task 8):** static audit, smoke test, full suite and `scripts/run-samples.sh`.

Rules for every task:

- Every file under `src/frontend/` uses explicit types, small functions and no `any`. `core/` never imports from `dom/` and never touches `document`, `window`, `fetch` or timers. DOM code never uses `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `element.style`, `cssText` or `setAttribute("style", ...)`.
- Each task ends by running `npm run typecheck` (both projects), `npm run lint` and the Vitest files it added (`npx vitest --run <file>`). Checkpoints run the full `npx vitest --run`. The sample equivalence suite (`scripts/run-samples.sh`) must pass before any task is declared done and is run at checkpoints 4, 5 and 8.
- New tests live in `tests/frontend/` (plus `tests/setup/`), use no `it.skip`, `describe.skipIf`, `it.runIf` and no early `return` on a missing dependency. Each property test carries the tag comment `// Feature: necromancer-frontend, Property N: <title>`.
- Tests marked `*` are optional. Required tests (no `*`): Property 1 (2.2), Property 3 (2.5), Properties 4 and 5 (2.8), the static audit (7.1) and the smoke test (7.2).
- `public/app.js`, `public/app.js.map` and `public/fonts/` are generated and gitignored. `public/index.html`, `public/app.css` and `public/decor/` are committed.

## Tasks

- [ ] 1. Build pipeline
  - [x] 1.1 Add npm scripts, font dev dependencies, `scripts/copy-fonts.mjs` and placeholder `src/frontend/main.ts`
    - `package.json`: add `build:frontend`, `build:fonts`, `typecheck` (both projects) and extend `build` as in the design. Add `@fontsource/cinzel` and `@fontsource/jetbrains-mono` to `devDependencies` only; `dependencies` stays `decimal.js` only
    - `scripts/copy-fonts.mjs`: copy the three latin `.woff2` files to `public/fonts/jetbrains-mono-400.woff2`, `jetbrains-mono-700.woff2`, `cinzel-400.woff2`; exit non-zero with the missing source path on stderr if any is missing; imports from `node:fs` and `node:path` only
    - `src/frontend/main.ts`: trivial placeholder (for example sets `document.title`) so `npm run build:frontend` produces `public/app.js`
    - Run `npm install`, `npm run build:frontend`, `npm run build:fonts`
    - _Requirements: 1.2, 1.7, 1.9_
  - [ ] 1.2 Split TypeScript projects and add the Vitest globalSetup
    - `tsconfig.json`: add `src/frontend/**` and `tests/frontend/**` to `exclude`
    - New `tsconfig.frontend.json` extending `tsconfig.json` with `lib: ["ES2022", "DOM"]`, `include` of `src/frontend/**/*.ts`, `src/server/wire.ts`, `tests/frontend/**/*.ts`
    - `tests/setup/build-frontend.ts`: named export `runBuild(run)` calling `run("npm run build:frontend")` then `run("npm run build:fonts")`; default `setup()` using `execSync(command, { cwd: <repo root>, stdio: "inherit" })` and rethrowing an `Error` that names the failing command
    - `vitest.config.ts`: add `globalSetup: ["tests/setup/build-frontend.ts"]`
    - Run `npm run typecheck` and `npx vitest --run` on a clean `public/` to confirm the build runs once
    - _Requirements: 1.2, 12.1, 12.7, 12.10_
  - [ ] 1.3 Update `Dockerfile.app`, `scripts/check-app-image.sh`, `.gitignore`, `.dockerignore` and add a placeholder `public/decor/skeleton.svg`
    - `Dockerfile.app` build stage: plain `npm ci`, copy `scripts/copy-fonts.mjs`, `src/`, `public/`, run `build:worker`, `build:server`, `build:frontend`, `build:fonts`. Runtime stage: `COPY --from=build --chmod=a+rX /build/public/ ./public/`. The runtime image never installs `@fontsource/*`
    - `scripts/check-app-image.sh`: also request `/app.js`, `/app.css`, `/fonts/jetbrains-mono-400.woff2` and `/decor/skeleton.svg` and check status 200
    - `.gitignore`: `public/app.js`, `public/app.js.map`, `public/fonts/`. `.dockerignore`: same three entries. `.kiro/` is never ignored
    - Create `public/decor/skeleton.svg` as a minimal valid SVG document (an `<svg xmlns="http://www.w3.org/2000/svg" ...>` with a `viewBox` and one simple shape such as a circle or rect) using presentation attributes only (`fill`, `stroke`, etc.): no `<style>` element, no `style` attribute, no `<script>`, no event-handler attribute, no `data:` URL and no external `href` or `xlink:href`. It is committed (not gitignored), so `scripts/check-app-image.sh` can request `/decor/skeleton.svg` and the Docker build stage's `COPY public/` carries it into the image
    - _Requirements: 1.1, 1.6, 1.7, 1.9, 10.9_
  - [ ]* 1.4 Write unit tests for the pipeline helpers
    - `tests/frontend/copy-fonts.test.ts`: the three targets are produced with non-zero size; a missing source exits non-zero and names the path (temp directory, injected paths)
    - `tests/frontend/build-frontend.setup.test.ts`: `runBuild` calls the two commands in order; a throwing runner propagates and the second command is not run after the first fails
    - _Requirements: 1.7, 1.9_

- [ ] 2. Core modules in `src/frontend/core/`
  - [ ] 2.1 Implement `ndjson.ts` and `classify-line.ts`
    - `createLineSplitter()` with `push` and `flush` as in the design (one buffered partial line, split on `"\n"`)
    - `classifyLine(rawLine)` returning `progress | report | error | unreadable` with explicit `typeof` and `Array.isArray` guards; wire types imported from `src/server/wire.ts` as types only
    - _Requirements: 4.1, 4.7, 12.1_
  - [ ] 2.2 Write property test for the NDJSON splitter
    - File: `tests/frontend/ndjson.property.test.ts`
    - **Property 1: NDJSON splitting round-trips across arbitrary chunk boundaries**
    - **Validates: Requirements 4.1, 12.2**
    - Lines without embedded `\n` joined with `\n`, cut at arbitrary split points including zero-length and single-character chunks; also a case where the stream does not end in `\n` (output of `push` plus `flush`)
    - _Requirements: 4.1, 12.2_
  - [ ]* 2.3 Write property and unit tests for `classifyLine`
    - File: `tests/frontend/classify-line.property.test.ts`
    - **Property 2: Unparseable or unknown-type lines always classify as unreadable**
    - **Validates: Requirements 4.7**
    - Unit examples: a valid progress, report and error line classify to their kinds; object missing a required field is unreadable
    - _Requirements: 4.7_
  - [ ] 2.4 Implement `view-state.ts` and `busy-retry.ts`
    - `ViewState`, `DisplayError`, `StreamEvent`, `initialRitualState`, `isTerminal`, `reduceStreamEvent` with absorbing terminal states, `report` assigned only from a `complete === true` report, `incompleteReport` for `complete === false`
    - `BUSY_RETRY_INTERVAL_MS`, `BUSY_RETRY_MAX`, `initialBusyState`, `nextBusyStep` (at most 7 requests, `wait` attempt 1..6, `give-up` only when the 6th retry answers busy, no `send` after cancel)
    - _Requirements: 4.3, 4.4, 4.8, 4.10, 6.1, 6.2, 6.12, 7.8, 7.14, 7.16, 7.17_
  - [ ] 2.5 Write property test for the view-state reducer
    - File: `tests/frontend/view-state.property.test.ts`
    - **Property 3: The reducer exposes a report only if the first terminal event is a Complete_Report**
    - **Validates: Requirements 4.3, 4.4, 4.8, 4.10, 6.1, 6.2, 6.12, 7.14, 7.16**
    - fast-check over sequences of all event kinds from `initialRitualState()`: `report` defined iff the first terminal event is a complete report; events after the first terminal event change nothing; `view` is `ritual` or `busy` only while `report` is undefined
    - _Requirements: 4.3, 6.1, 6.2, 12.4_
  - [ ]* 2.6 Write property test for busy retry
    - File: `tests/frontend/busy-retry.property.test.ts`
    - **Property 9: Busy retry stays within bounds, never sends after cancel, and gives up exactly at the sixth busy retry**
    - **Validates: Requirements 7.8, 7.16, 7.17**
    - _Requirements: 7.8, 7.16, 7.17_
  - [ ] 2.7 Implement `score-format.ts`, `ghost-count.ts` and `row-rise.ts`
    - `formatMatchScore` (integer tenths, clamped to 999 below 1, never `toFixed`), `headlineFor` (`>= 1`, `>= 0.9`, else), `perfectScoreLine(n)` returning exactly `No mismatches in ${n} conclusive cases.`
    - `ritualGhostCount` (integer 2..12, non-decreasing), `ritualSpeedStep` (1..4 from the same ratio), `verdictGhostCount` (0 at score 1, else `min(20, displayed)`)
    - `ROW_RISE_LIMIT = 20`, `rowRiseClass(index)` returning `row-rise row-rise-<index>` for `index < 20`, else `undefined`
    - _Requirements: 6.5, 6.6, 6.7, 7.3, 8.2, 8.3, 9.1, 9.2, 9.3, 12.3, 12.5, 12.6_
  - [ ] 2.8 Write property tests for the score formatter
    - File: `tests/frontend/score-format.property.test.ts`
    - **Property 4: Match-score formatting never rounds up and is exact only at 1**
    - **Property 5: Headline classification matches the fixed score bands**
    - **Validates: Requirements 6.5, 6.6, 6.7, 12.3**
    - Include generated values just below 1 (for example `1 - Number.EPSILON`, `0.9999999`, `0.99949`) and the boundaries 0, 0.9 and 1
    - _Requirements: 6.5, 6.6, 6.7, 12.3_
  - [ ]* 2.9 Write property tests for ghost counts
    - File: `tests/frontend/ghost-count.property.test.ts`
    - **Property 6: Verdict-ghost count is the capped mismatch count, and zero for a perfect score**
    - **Property 7: Ritual-ghost count stays within range and never decreases with progress**
    - **Property 10: Ritual speed step is bounded and never decreases with progress**
    - **Validates: Requirements 9.1, 9.2, 9.3, 12.5 (P6); 8.3, 12.6 (P7); 8.2 (P10)**
    - _Requirements: 8.2, 8.3, 9.1, 9.2, 9.3, 12.5, 12.6_
  - [ ]* 2.10 Write property test for row rise
    - File: `tests/frontend/row-rise.property.test.ts`
    - **Property 8: Row-rise class is present only for the first 20 rows, with strictly increasing delay step**
    - **Validates: Requirements 7.3**
    - _Requirements: 7.3_
  - [ ]* 2.11 Write unit tests for `perfectScoreLine` and headline copy
    - File: `tests/frontend/score-format.test.ts`
    - Exact string for several `n`; the line and the three headline strings do not match `/proven|proof|guarantee|certain/i`
    - _Requirements: 6.6_
  - [ ] 2.12 Implement `announce.ts`, `wake.ts`, `decor-spec.ts` and `selection.ts`
    - `ANNOUNCE_MIN_INTERVAL_MS`, `shouldAnnounce`; `WAKE_DELAY_MS`, `wakeVisible`
    - `DecorationKind`, `decorationAttrs(kind)`: file-backed kinds get `src` (`/decor/<kind>.svg`), `alt=""`, `aria-hidden="true"`, `data-decoration`, `class`; `fog` has no `src` or `alt`; never `style` or `tabindex`
    - `Selection` interface (`sampleId`, `variant`)
    - _Requirements: 4.11, 5.1, 5.2, 5.3, 6.11, 10.1, 12.8_
  - [ ]* 2.13 Write tests for announce, wake and decor-spec
    - `tests/frontend/announce.property.test.ts`
    - **Property 11: Live-region throttle allows at most one announcement per second**
    - **Validates: Requirements 4.11**
    - `tests/frontend/wake.test.ts`: `wakeVisible` true only with no first byte and `elapsedMs >= 3000`
    - `tests/frontend/decor-spec.test.ts`: every kind has `aria-hidden="true"`, no `style`, no `tabindex`; file-backed kinds have `src` under `/decor/` and `alt=""`; `fog` has no `src`
    - _Requirements: 4.11, 5.1, 5.3, 10.1, 12.8_

- [ ] 3. DOM layer and page (no decorations yet)
  - [ ] 3.1 Implement `api-client.ts`, `proof-session.ts`, `wake-timer.ts` and `copy.ts`
    - `api-client.ts`: `getHealth`, `getSamples`, `getSampleDetail`, `startProve(sampleId, variant, signal)` posting exactly `{ sampleId, variant }`; 200 streams through `TextDecoder` (`stream: true`), the splitter and `classifyLine`; non-200 bodies parsed as Error_Line, else `client-failure` `http-status` with the numeric status; rejected `fetch` becomes `unreachable`
    - `proof-session.ts`: injected `fetch`, `setTimeout`, `clearTimeout`; `AbortController` per request; busy retry execution through `nextBusyStep`; cancel clears the timer and aborts; stops at the first terminal line and aborts on `unreadable`; stream end without terminal line dispatches `stream-ended`; one `pagehide` listener aborts the request and clears the timer
    - `wake-timer.ts`: injected timers and `WAKE_DELAY_MS`; started on request send, cleared on first headers or line
    - `copy.ts`: every fixed string from the design copy table
    - _Requirements: 1.8, 1.10, 3.2, 4.1, 4.7, 4.8, 4.9, 4.10, 5.1, 5.2, 5.3, 7.8, 7.12, 7.13, 7.16, 7.17, 11.9_
  - [ ] 3.2 Implement the Crypt view
    - `dom/crypt-view.ts`: health call once at load (fire-and-forget), catalog render with one card per sample (`name`, `trapLabel`), first sample auto-selected, detail request on selection, retry button on catalog failure, message in place of panels and Summon disabled on detail failure
    - COBOL and TypeScript panels with per-line text nodes and line numbers, `line-curse` and `line-marker` classes, curse chips, `fidelityPact` list, Variant radio selector (`correct` default, no new request on change), provenance text, oracle-unavailable notice with Summon still enabled, "Waking the crypt…" text while the catalog request exceeds the Wake_Delay
    - Summon button disabled until detail loaded and while a Proof runs; cards and selector disabled while a Proof runs. No upload, textarea or drop zone. All source inserted as text
    - _Requirements: 1.10, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12, 2.13, 3.1, 3.3, 3.4, 3.5, 3.7, 5.5, 5.6, 5.7, 11.3, 11.4_
  - [ ] 3.3 Implement the Ritual, Verdict and error views
    - `dom/ritual-view.ts`: "`completed` of `target`", progress bar class `.progress-step-N` (5 percent steps), `matched`, `mismatches`, `inconclusive` counts, latest `group`, cancel button, polite live region throttled by `shouldAnnounce`, busy text with attempt number and cancel button. No score and no percentage
    - `dom/verdict-view.ts`: score, headline and color class, `perfectScoreLine`, counts, `casesRun`, `seed`, `elapsedMs`, group rows, inconclusive section, sample name and Variant, return button restoring the previous Selection, `requestAnimationFrame` count-up of 900 ms using `formatMatchScore(final * t)` (skipped under `matchMedia` reduced motion), mismatch table (`input`, `oracleOutput`, `candidateOutput`, `group`, `white-space: pre` cells, `rowRiseClass`), `shrunkExamples`, truncation notice, no table when `mismatchCount` is 0, Interrupted view (cause, `casesRun`, partial mismatch list, no score)
    - `dom/error-view.ts`: the mapping table from the design, text only, return-to-Crypt button in every error view
    - _Requirements: 4.2, 4.3, 4.4, 4.6, 4.10, 4.11, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 6.12, 6.13, 6.14, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.11, 7.12, 7.13, 7.14, 7.15, 7.16, 7.17_
  - [ ] 3.4 Implement `boot.ts`, `index.html`, `app.css` and wire `main.ts`
    - `boot.ts`: owns the single `ViewState` and `Selection`, calls `reduceStreamEvent`, exhaustive `switch` over `ViewName`; on every view change sets the live region text and moves focus to the heading (`tabindex="-1"`); Summon starts a `ProofSession` and moves to the Ritual
    - `public/index.html`: root `<div id="app">`, stylesheet link, `<script type="module" src="/app.js">`, live region, section shells, same-origin preload of the JetBrains Mono font; no inline script, style, `style` attribute or event attribute, no third-party URL
    - `public/app.css`: palette and typography from the theme (near-black background, `#38F888`, `#FF777A`, Cinzel for logo and screen titles only), three `@font-face` rules with `font-display: swap`, tombstone cards, 900 px breakpoint, panel and table `overflow-x: auto`, 44 px touch targets, `:focus-visible` outline, class families `.ghost-slot-1..12`, `.ghost-speed-1..4`, `.progress-step-0..20`, `.row-rise` and `.row-rise-0..19` (only `transform` and `opacity` in keyframes)
    - `src/frontend/main.ts` imports `dom/boot.ts` only
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 3.3, 3.7, 10.6, 10.7, 10.8, 11.1, 11.2, 11.3, 11.5, 11.6, 11.7, 11.8_
  - [ ]* 3.5 Write unit tests for the DOM-independent helpers
    - `tests/frontend/copy.test.ts`: `httpStatus(status)` contains the status number; `busyWaiting(n)` contains the attempt number and the required text; no copy string matches `/proven|proof of|guarantee/i`
    - `tests/frontend/wake-timer.test.ts`: fake timers; timer cleared before 3000 ms never fires; fires at 3000 ms; cleared on first byte
    - `tests/frontend/proof-session.test.ts`: fake `fetch` and timers; request body has exactly `sampleId` and `variant`; busy retries every 5000 ms and stops after 6; cancel clears the timer and sends no further request; `unreadable` aborts; stream end without terminal line dispatches `stream-ended`; network failure and non-200 without Error_Line map to the fixed client failures
    - _Requirements: 3.2, 4.7, 4.8, 5.1, 5.3, 7.8, 7.12, 7.13, 7.16, 7.17, 11.9_

- [ ] 4. Checkpoint - working page against the real server
  - Run `npm run typecheck`, `npm run lint`, `npx vitest --run` and `npm run build`
  - Start the server (the user starts it manually in a terminal; give the exact command from the repo's README or `package.json`) and load the page. Confirm the Crypt loads the three samples, source panels fill, and a proof runs to a Verdict or to an Error view
  - Run `scripts/run-samples.sh`. Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Deploy checkpoint
  - [ ] 5.1 Build and verify the app image locally
    - `docker build -f Dockerfile.app` and run `scripts/check-app-image.sh`; confirm `/app.js`, `/app.css`, a font and `/decor/skeleton.svg` answer 200 from the container
    - Record observations needed for `docs/kiro-log.md`
    - Run `scripts/run-samples.sh`; it must pass
    - _Requirements: 1.9, 12.11_
  - [ ] 5.2 Deploy to Render and verify in the browser (MANUAL, user's Render account)
    - Manual step for the user: create or update the Render free Docker web service from this repository using `Dockerfile.app`. The agent does not automate this and has no access to the Render account
    - Manual step for the user: open the deployed URL and confirm the page loads, Summon runs a proof to a Verdict, and after the service has slept the "Waking the crypt…" notice appears and then disappears when the server answers
    - Manual step for the user: report any failure so it can be fixed in a follow-up task
    - _Requirements: 1.9, 3.2, 5.1, 5.2, 5.5_

- [ ] 6. Decorations and SVG artwork
  - [ ] 6.1 Create the SVG files, `decorations.ts` and the Skeleton
    - Original artwork in `public/decor/`: `skeleton.svg`, `ghost-a.svg`, `ghost-b.svg` (two distinct shapes), `verdict-ghost.svg` (red `#FF777A`), `smoke.svg`. Presentation attributes only: no `<style>`, `style` attribute, `<script>`, event attribute, `data:` URL or external `href`. The real `skeleton.svg` artwork replaces the placeholder created in task 1.3, keeping the same file name and the same restrictions (presentation attributes only, no style, script, event attribute, `data:` URL or external reference)
    - `dom/decorations.ts`: `createElement("img")` (or `div` for fog) with attributes from `decorationAttrs(kind)` applied by `setAttribute`
    - Show the Skeleton with "Waking the crypt…" in the Crypt and the Ritual while the wake timer has fired, and remove both on first headers or line, on catalog success and on failure
    - _Requirements: 1.6, 5.1, 5.2, 5.4, 5.6, 8.5, 9.5, 10.1, 10.9_
  - [ ] 6.2 Add Ritual ghosts, Summon smoke and Verdict ghosts
    - Ritual: on each progress line set the number of ghost images to `ritualGhostCount`, alternate `ghost-a.svg` and `ghost-b.svg`, give each `.ghost-slot-K`, set one `.ghost-speed-N` from `ritualSpeedStep`, fade out and remove at the end of the Ritual; smoke animation in the Ritual; skip ghosts when `matchMedia` reduced motion matches
    - Summon smoke plume above the button for at most 1200 ms, skipped under reduced motion
    - Verdict: `verdictGhostCount(mismatchCount, displayedRows, matchScore)` red ghosts rising once (cap 20); none at score 1; none in error and Interrupted views
    - _Requirements: 3.6, 4.5, 8.1, 8.2, 8.3, 8.4, 9.1, 9.2, 9.3, 9.4_
  - [ ] 6.3 Add fog, decoration keyframes and the Reduced_Motion block to `app.css`
    - `.decor` rules: `pointer-events: none`, `z-index` below content, opacity at most 0.15 where over text; fog layers and ember drift; Skeleton swing, ghost drift, smoke, Verdict ghost rise keyframes using only `transform` and `opacity`
    - One `@media (prefers-reduced-motion: reduce)` block removing Skeleton swing, ghost drift, smoke, fog, ember drift, row rise and Verdict ghost rise; decorations static or fading in within 300 ms
    - _Requirements: 10.2, 10.3, 10.4, 10.5, 7.3_
  - [ ]* 6.4 Write unit tests for decorations
    - `tests/frontend/decorations.test.ts`: with a minimal fake `document`, every kind from `decorationAttrs` is applied unchanged; no `style` attribute is ever set
    - _Requirements: 10.1, 12.8_

- [ ] 7. Verification
  - [ ] 7.1 Write the static audit test
    - File: `tests/frontend/static-audit.test.ts`
    - Fails if `public/index.html`, `public/app.css` or `public/app.js` contains an inline `style` attribute, an inline `<script>` body, a `<style>` element or a third-party origin URL; `public/app.js` contains no `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `.style.` or `setAttribute("style"`
    - Fails if a Decoration element source lacks `aria-hidden="true"` (check `decorationAttrs` for every kind and the markup in `index.html`)
    - Fails if a `@keyframes` rule used by a Decoration class in `public/app.css` animates a property other than `transform` or `opacity`
    - Checks `package.json`: `@fontsource/*` only in `devDependencies`, `dependencies` equals `decimal.js` only
    - Scans every `public/decor/*.svg` for `<style`, `style=`, `<script`, `on*=` attributes, `data:` and external `href`
    - Uses the shared helper that fails with "Run npm run build:frontend && npm run build:fonts first" when generated files are missing; no skip
    - _Requirements: 1.3, 1.4, 1.6, 1.7, 10.1, 10.4, 10.9, 12.7, 12.8, 12.9_
  - [ ] 7.2 Write the smoke test
    - File: `tests/frontend/static.smoke.test.ts`
    - Starts the Server in process with the fake Oracle backend used by `tests/server/`, requests `GET /`, `GET /app.js`, `GET /app.css`, `GET /fonts/jetbrains-mono-400.woff2` and `GET /decor/skeleton.svg`, and checks status 200 and the content types from the Server's static table
    - _Requirements: 1.9, 12.10_

- [ ] 8. Final checkpoint - Ensure all tests pass
  - Run `npm run typecheck`, `npm run lint`, `npx vitest --run` and `scripts/run-samples.sh`; the sample equivalence result must be unchanged
  - Ensure all tests pass, ask the user if questions arise.
  - _Requirements: 12.11_

## Notes

- Tasks marked with `*` are optional test sub-tasks. Required tests: Property 1 (2.2), Property 3 (2.5), Properties 4 and 5 (2.8), static audit (7.1), smoke test (7.2).
- Property coverage: P1 in 2.2; P2 in 2.3; P3 in 2.5; P4, P5 in 2.8; P6, P7, P10 in 2.9; P8 in 2.10; P9 in 2.6; P11 in 2.13.
- Task 5.2 is a manual step for the user (Render account). It is not automated.
- No task modifies `src/server/`, `src/equivalence/`, `src/oracle/` or `src/translator/`.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "2.1", "2.4", "2.7", "2.12"] },
    { "id": 2, "tasks": ["1.4", "2.2", "2.3", "2.5", "2.6", "2.8", "2.9", "2.10", "2.11", "2.13", "3.1"] },
    { "id": 3, "tasks": ["3.2", "3.3", "3.5"] },
    { "id": 4, "tasks": ["3.4"] },
    { "id": 5, "tasks": ["5.1", "6.1"] },
    { "id": 6, "tasks": ["5.2", "6.2", "6.4"] },
    { "id": 7, "tasks": ["6.3"] },
    { "id": 8, "tasks": ["7.1", "7.2"] }
  ]
}
```

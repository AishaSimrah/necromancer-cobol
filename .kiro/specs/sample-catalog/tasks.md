# Implementation Plan: sample-catalog

## Overview

Implement `src/translator/` and `tests/translator/` in TypeScript (strict, no `any`), with decimal.js, fast-check and Vitest. Nothing in `src/equivalence/`, `src/oracle/`, or any existing test file is changed.

The plan is a thin slice first, then the remaining eight translations:

1. **Foundation (tasks 1 to 3):** types, static data for all three samples, markers, file access, and the COBOL runtime library.
2. **Thin slice (tasks 4 to 6):** the INTEREST `correct` translation, the catalog API, and the real-Oracle test `oracle.test.ts` with `UNDER_TEST = [interest/correct]`. A checkpoint (task 7) runs `tsc`, ESLint, and the full Vitest suite. Nothing else is built before this is green.
3. **INTEREST rest (task 8):** `naive` copy, `subtle` with measurement, the copy-equivalence test.
4. **PAYROLL (task 9) and TAX (task 10):** each in the order `correct`, `naive`, `subtle`. `naive` comes before `subtle` because the ordering rule `naive < subtle < 1` needs both scores.
5. **Cross-cutting tests and wrap-up (tasks 11 to 14):** property tests, static scans, deployment test, the "all nine" assertion, docs, and the final verification.

Rules for every task:

- `oracle.test.ts` runs each Standard_Run once in `beforeAll` and every assertion reads the stored report (design, "oracle.test.ts"). `UNDER_TEST` grows in the same task that adds a translation. A test file never uses `skip`, `skipIf`, `runIf`, or `todo`.
- A translation file is plain TypeScript (design, "Plain TypeScript rule"): only relative `.js` imports, `decimal.js`, and type-only imports from `../equivalence/compare.js` and `../equivalence/descriptors.js`.
- Every risky line carries `// CURSE:<id>`. Provenance is `{ label: "Pre-generated with Kiro", generatedWith: "Kiro", date: "2026-11-12" }`.
- If a measurement does not meet a rule, change the translation, never the engine, the comparison, the ordering rule, or a test. Where the requirements say "stop and ask" (Req 7.4), stop and report the measured scores.
- Each task ends with the sub-task that runs its tests, the full Vitest suite (`npm test`), `npm run typecheck`, and `npm run lint`. The sample equivalence suite required by `tech.md` is run at every checkpoint.
- The Oracle needs Docker and takes time. If the Oracle is unavailable, the Oracle tests fail with the clear message; do not work around it.

## Tasks

- [ ] 1. Types, static data, markers
  - [ ] 1.1 Create `src/translator/types.ts`
    - `SampleId`, `Variant`, `SAMPLE_IDS`, `VARIANTS`, `Curse`, `ExamplePair`, `Provenance`, `SampleData`, `Sample`, `CurseMarker`, `TranslationModule`, `Translation` exactly as in the design
    - Imports only types from `../equivalence/compare.js` and `../equivalence/descriptors.js`; no `node:` imports
    - _Requirements: 1.2, 4.2, 9.4_
  - [ ] 1.2 Create `src/translator/sample-data.ts`
    - `SAMPLE_DATA` for `interest`, `payroll`, `tax`: name, trap label, `fields` by reference to `INTEREST`, `PAYROLL`, `TAX` from `../equivalence/descriptors.js`, default input (the first example), the eight example pairs, the fidelity pacts, and the ten curses with the ids, chip labels and line numbers from Req 3.3
    - A `deepFreeze` helper; the exported record and every nested array and object are frozen
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 1.6, 1.7, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 9.5_
  - [ ] 1.3 Create `src/translator/markers.ts`
    - `extractCurseMarkers(source): readonly CurseMarker[]` with regex `/\/\/\s*CURSE:([a-z0-9-]+)/g` applied per line; 1-based line numbers; two markers on one line give two records
    - _Requirements: 5.1, 5.5_
  - [ ] 1.4 Write unit tests in `tests/translator/static-data.test.ts` (no Oracle)
    - Order of ids; `fields` are the same references as the exported descriptor arrays (`toBe`); default input is one of the examples and has one line per field; pact has 3 to 4 entries of at most 80 characters; trap labels have no line break
    - Curse ids unique across the catalog and match `/^[a-z0-9-]+$/`; labels at most 32 characters
    - Frozen: `Object.isFrozen` on the record, arrays and curses
    - `extractCurseMarkers`: single marker, two markers on one line, no marker, id with digits and hyphens, 1-based line numbers (unit test plus a fast-check property: inserting a marker at line N yields line N)
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 1.6, 1.7, 3.1, 5.5, 9.5_

- [ ] 2. Server-only file access
  - [ ] 2.1 Create `src/translator/files.ts`
    - `repoPath(relative)` and `readRepoText(relative, what)` using `new URL("../../" + relative, import.meta.url)` and `fileURLToPath`; never `process.cwd()`
    - Cache by resolved path in a `Map` (only successful reads are cached)
    - On failure throw `Error("Cannot read <what> at <resolved path>: <cause message>")`; never return an empty string
    - The only file in `src/translator/` allowed to import `node:*`
    - _Requirements: 1.3, 1.3a, 1.3b, 1.3c, 12.5_
  - [ ] 2.2 Write unit tests in `tests/translator/files.test.ts` (no Oracle)
    - Reading `cobol-samples/interest.cbl` equals the bytes read by the test through its own `import.meta.url`-based path
    - The test changes the working directory (`process.chdir` to the OS temp dir inside `try/finally`) and the read still succeeds, proving no `process.cwd()` dependency
    - A missing path throws an error whose message contains the `what` label and the resolved path, and a second call does not return a cached value
    - _Requirements: 1.3a, 1.3b_

- [ ] 3. COBOL runtime library
  - [ ] 3.1 Create `src/translator/cobol-runtime.ts`
    - Isolated `Decimal` clone with `precision: 60`; exports `Dec`, `numval`, `truncTo`, `roundTo` (ROUND_HALF_UP), `storeUnsigned`, `wrap` (abs, then mod 10^digits), `zEdit`, `display` as specified in the design
    - No `number` for field values; no Node imports; no `process` / `Buffer`
    - A comment states that `numval` handles plain decimal text and returns 0 for unparseable text
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
  - [ ] 3.2 Write tests in `tests/translator/cobol-runtime.test.ts` (no Oracle)
    - Unit tests on the values from the example pairs, zero, max, max + one unit, half-unit ties (`0.005`, `2.5` to scale 0), negative input to `storeUnsigned` (absolute value), extra decimals truncated, high-order digits dropped, unparseable text, `zEdit` of zero (`"      0.00"`), `zEdit` width for `Z(6)9.99`, `Z(5)9.99`, `Z(7)9`
    - Property tests (fast-check, `numRuns` 200, fixed seed): `storeUnsigned` result is always in `[0, 10^digits)` and has at most `scale` decimals; `zEdit` output length is constant for a fixed picture; `roundTo(x, s)` is within one unit of `truncTo(x, s)` for non-negative `x`
    - _Requirements: 6.2, 6.3, 6.5, 10.8_
  - [ ] 3.3 Run this task's tests, the full Vitest suite, `npm run typecheck` and `npm run lint`

- [ ] 4. Thin slice: INTEREST `correct` translation and registry
  - [ ] 4.1 Create `src/translator/translations/interest.correct.ts`
    - Exports `candidate: Candidate` and `provenance: Provenance`, built on `cobol-runtime.ts` as in the design
    - Markers: `CURSE:interest-years-pic99` on the `years` line; `CURSE:interest-yearly-rounding` on the loop line and the compute line; `CURSE:interest-overflow` on the compute line
    - Header comment names the COBOL file and the variant
    - _Requirements: 4.1, 4.2, 4.4, 4.6, 5.1, 5.2, 6.1 to 6.5, 6.8_
  - [ ] 4.2 Create `src/translator/translations/registry.ts`
    - Static imports of the translation modules that exist so far, keyed `"<sampleId>/<variant>"`; typed so that a missing key is a clear runtime error `No translation registered for <sample>/<variant>`
    - This partial typing is temporary; task 13.1 tightens it to a complete record
    - _Requirements: 4.1, 4.5_
  - [ ] 4.3 Spot-check without the Oracle
    - A short test in `tests/translator/interest-correct.test.ts`: the three INTEREST example pairs through `candidate` equal the documented outputs (`toBe`)
    - _Requirements: 2.2, 6.8_

- [ ] 5. Thin slice: catalog API
  - [ ] 5.1 Create `src/translator/catalog.ts` and `src/translator/index.ts`
    - `listSamples()`, `getSample(id)`, `getTranslation(sampleId, variant)`; runtime validation of arguments with the messages from the design; lazy build and cache; frozen records; `Translation.source` read with `readRepoText("src/translator/translations/<id>.<variant>.ts", ...)`; `markers` from `extractCurseMarkers`; `Sample.cobolSource` read with `readRepoText("cobol-samples/<id>.cbl", ...)`
    - The API never calls `runEquivalence`, never calls a Candidate, never starts the Oracle
    - `index.ts` re-exports the API and the types
    - _Requirements: 1.3, 4.2, 4.3, 5.5, 9.1 to 9.6_
  - [ ] 5.2 Write `tests/translator/catalog.test.ts` (no Oracle), the parts that apply to the slice
    - `listSamples` order and `getSample(id).cobolSource` equals the file read by the test
    - Examples vs `cobol-samples/EXPECTED.md`: the test parses the markdown tables (INTEREST rows `a / b / c`, PAYROLL three back-ticked segments joined with `\n`, TAX) and compares with the catalog; it asserts the number of pairs found per sample (3, 2, 3) so a format change fails loudly
    - Curses: every line number exists and is not blank; the keyword guard table from the design (all ten curses, since the COBOL files already exist)
    - `getTranslation("interest", "correct")`: `source` equals the file bytes read by the test; provenance fields exact; `date` valid; markers are valid curse ids of `interest`; marker line numbers equal the 1-based line index in `source`; every INTEREST curse appears at least once in the `correct` source
    - API errors: unknown sample id, unknown variant, non-string values; messages name the value and list the valid ones
    - Immutability: frozen records; `getSample("tax") === getSample("tax")`; assignment through a cast throws `TypeError` in strict mode
    - A not-yet-registered translation (for example `payroll/correct`) throws `No translation registered for payroll/correct` (removed in task 13.1)
    - _Requirements: 1.1 to 1.7, 2.1, 2.4, 3.1 to 3.5, 4.3, 4.4, 5.1 to 5.3, 5.5, 9.1 to 9.5, 10.9_

- [ ] 6. Thin slice: real-Oracle test for INTEREST `correct`
  - [ ] 6.1 Create `tests/translator/oracle.test.ts`
    - Structure from the design: `beforeAll` with probe, then one `standardRun` per `UNDER_TEST` entry (sequential), outcomes stored in a `Map`; `reportOf()` for all assertions; `afterAll` prints the score table and calls `shutdown()`
    - `UNDER_TEST = [{ sample: "interest", variant: "correct" }]`
    - `standardRun` uses `runEquivalence({ source, fields, candidate, caseCount: 1000, seed: 1, oracleTimeoutMs: 10_000 })` with the real Oracle (no `oracle` option) and returns a failed outcome for `oracle_unavailable`, `inconclusive`, `inconclusiveCount > 0`, or a missing `matchScore`
    - `beforeAll` timeout 600,000 ms (10 minutes); the `it`s use the default timeout
    - `it` for `interest/correct`: `matchScore === 1`, `mismatchCount === 0`, `conclusiveCount === 1000`, `inconclusiveCount === 0`
    - `it`s for the three INTEREST example pairs: `compileCobol` once, `runCompiled` per pair, `status === "ok"`, `stdout === pair.output`, then `candidate(input) === pair.output`; `releaseHandle` in `finally`
    - No `skip`, `skipIf`, `runIf`, or `todo` in the file
    - _Requirements: 2.4, 6.8, 10.1 to 10.7_
  - [ ] 6.2 Run the Oracle test and record the result
    - Run `npx vitest --run tests/translator/oracle.test.ts`
    - If `interest/correct` does not score exactly 1, fix the translation or the runtime (not the test, not the engine) and rerun
    - Note the score table and the elapsed time for the Standard_Run in the working notes for task 14.2
    - _Requirements: 6.8, 10.10_

- [ ] 7. Checkpoint: thin slice
  - [ ] 7.1 Run `npm run typecheck`, `npm run lint`, `npm test` (full suite), and the sample equivalence suite
    - All must pass. Ask the user if a question comes up. Do not start task 8 before this is green.

- [ ] 8. INTEREST: `naive` and `subtle`
  - [ ] 8.1 Create `src/translator/translations/interest.naive.ts`
    - A copy of `naiveInterestCandidate` from `tests/equivalence/candidates/interest.ts`, as `candidate`, with `provenance`, the header `// DELIBERATELY WRONG: the typical first attempt, floating point and no COBOL field semantics.`, and markers `CURSE:interest-yearly-rounding` (loop line) and `CURSE:interest-overflow` (result line)
    - The `correct` translation from task 4.1 must also be equivalent to `correctInterestCandidate` (checked in 8.4)
    - _Requirements: 4.1, 4.2, 8.1, 8.2, 8.5_
  - [ ] 8.2 Register `interest/naive` and add it to `UNDER_TEST`; add its `it` (`matchScore < 1`, mismatches in at least two groups from `report.groups`)
    - Run the Oracle test; report per-group mismatch counts. If it does not meet the two-group rule, make the naive file worse in a realistic way (Req 8.4, 8.8) and rerun
    - _Requirements: 8.3, 8.4, 10.4_
  - [ ] 8.3 Create `src/translator/translations/interest.subtle.ts` and measure
    - Start from the `correct` file and change exactly one trap, in this order: (1) no `wrap` on the yearly balance (`CURSE:interest-overflow`); (2) `years` stored without `mod 100` (`CURSE:interest-years-pic99`); (3) no absolute value of negative inputs. Put `// CURSE:<id>  NOT HANDLED: <what is missing>` on the changed line and name the chosen trap in the header comment
    - Register `interest/subtle`, add it to `UNDER_TEST`, add its `it` (`matchScore < 1`, `mismatchCount >= 1`) and the per-sample ordering `it` (`naive < subtle < 1`, both scores in the message)
    - Run the Oracle test for each trap tried. Record the score, `mismatchCount` and group counts for every trap tried. Keep the first trap whose score is in 0.90 to 0.995
    - If none of the three is in range, STOP and report the measured scores to the user (Req 7.4). Do not widen the range, and do not continue with PAYROLL until the user answers
    - _Requirements: 4.1, 5.4, 7.1 to 7.6, 10.4_
  - [ ] 8.4 Write `tests/translator/interest-copies.test.ts` (no Oracle)
    - Import `src/translator/translations/interest.{correct,naive}.ts` and the originals in `tests/equivalence/candidates/interest.ts` (read-only)
    - 200 vectors: the three example pairs, about 40 hand-written boundary vectors (zero, max, max + one unit, `x.xx5` rates, 0 / 99 / 100 years, negative principal, ten-digit principal), and the rest from `fc.sample(vectorArb, { seed: 20260101, numRuns })`; total exactly 200; the vectors are the same on every run
    - For each vector `expect(copy(v)).toBe(original(v))` with the input, the original output and the copy output in the failure message; the `correct` pair always, the `naive` pair unless the naive copy was changed per Req 8.8 (then delete that half in the same change and say so in the report)
    - _Requirements: 8.5, 8.6, 8.7, 8.8_
  - [ ] 8.5 Run this task's tests, the full Vitest suite, `npm run typecheck` and `npm run lint`

- [ ] 9. PAYROLL: `correct`, `naive`, `subtle`
  - [ ] 9.1 Create `src/translator/translations/payroll.correct.ts`
    - As in the design: `storeUnsigned` for hours (3, 1) and rate (3, 2); the `hours.gt(40)` split; `regPay`, `otPay` rounded then wrapped to 6 digits; `gross`, `deduct`, `net` truncated then wrapped; three `display` lines in the order GROSS, DEDUCT, NET
    - Markers for all four PAYROLL curses; every PAYROLL curse appears at least once
    - Register `payroll/correct`, add to `UNDER_TEST`, add its `it` and the two PAYROLL example-pair `it`s
    - Run the Oracle test. If the score is below 1, diagnose by looking at the first mismatches in the report. Likely areas: the unsigned `NET` when `gross` wrapped below `deduct`, and the truncation of `otHours`. Fix the translation or the runtime, never the test
    - _Requirements: 4.1, 5.1, 5.2, 6.1 to 6.8, 10.4, 10.5_
  - [ ] 9.2 Create `src/translator/translations/payroll.naive.ts`
    - As in the design: `parseFloat`, `Math.min` / `Math.max` split, one rounding at the end through `toFixed`, `Math.round(gross * 0.0765 * 100) / 100` for the deduction, `padStart(9)`; header `DELIBERATELY WRONG`; markers on the lines that miss each curse
    - Register, add to `UNDER_TEST`, add its `it` (`matchScore < 1`, two groups). Run the Oracle test and report per-group mismatches. If fewer than two groups mismatch, make it worse in a realistic way
    - _Requirements: 8.1 to 8.4, 10.4_
  - [ ] 9.3 Create `src/translator/translations/payroll.subtle.ts` and measure
    - Candidate traps in order: (1) no `wrap` on `regPay`, `otPay` and `gross`; (2) `hours` stored without `mod 1000`; (3) deduction rounded instead of truncated. Mark the changed line `NOT HANDLED`
    - Register, add to `UNDER_TEST`, add its `it` and the ordering `it`. Run the Oracle test per trap and record every score. Keep the first in 0.90 to 0.995; if none, STOP and report the scores to the user
    - _Requirements: 5.4, 7.1 to 7.6, 10.4_
  - [ ] 9.4 Run this task's tests, the full Vitest suite, `npm run typecheck` and `npm run lint`

- [ ] 10. TAX: `correct`, `naive`, `subtle`
  - [ ] 10.1 Create `src/translator/translations/tax.correct.ts`
    - As in the design: `storeUnsigned(…, 8, 0)`, an `if / else if` chain with the same comparisons as the EVALUATE, `roundTo(…, 0)` and `wrap(…, 8)` per bracket, `display("TAX: ", zEdit(tax, 8, 0))`
    - Markers for all three TAX curses; register, add to `UNDER_TEST`, add its `it` and the three TAX example-pair `it`s
    - Run the Oracle test; fix the translation or the runtime if the score is below 1
    - _Requirements: 4.1, 5.1, 5.2, 6.1 to 6.8, 10.4, 10.5_
  - [ ] 10.2 Create `src/translator/translations/tax.naive.ts`
    - Flat rate applied to the whole income, `Math.round`, `padStart(8)`; header `DELIBERATELY WRONG`; markers
    - Register, add to `UNDER_TEST`, add its `it`. The Oracle test must show mismatches in at least two groups; if it does not, change this file, never the requirement
    - _Requirements: 8.1 to 8.4, 10.4_
  - [ ] 10.3 Create `src/translator/translations/tax.subtle.ts` and measure
    - Candidate traps in order: (1) no high-order truncation of `income` (no `mod 10^8` on input); (2) no absolute value of a negative `income`; (3) truncation instead of rounding. Mark the changed line `NOT HANDLED`
    - Register, add to `UNDER_TEST`, add its `it` and the ordering `it`. Run per trap, record every score, keep the first in 0.90 to 0.995; if none, STOP and report to the user
    - _Requirements: 5.4, 7.1 to 7.6, 10.4_
  - [ ] 10.4 Run this task's tests, the full Vitest suite, `npm run typecheck` and `npm run lint`

- [ ] 11. Property tests
  - [ ] 11.1 Write `tests/translator/translations.property.test.ts` (no Oracle)
    - Property 1, shape: for any vector of plain decimal strings (right length, optional minus sign, extra integer and decimal digits), the `correct` translation of each sample does not throw and returns a string matching the sample's output regex from the design
    - Property 2, determinism: two calls give the same string
    - Property 3, subtle agrees with correct outside its trap: per sample, a "safe domain" arbitrary that cannot trigger the chosen trap (named in a comment), then `subtle(x) === correct(x)`
    - Example 4, subtle differs inside its trap: one fixed witness per sample (taken from the measurement in tasks 8.3, 9.3, 10.3) where `subtle(x) !== correct(x)`
    - Example 5, naive is not exact: one fixed witness per sample where `naive(x) !== correct(x)`
    - Each property uses `fc.assert` with `numRuns: 200` and a fixed `seed`; a tag comment `Feature: sample-catalog, Property N: ...` precedes each
    - _Requirements: 6.8, 7.5, 7.6, 8.3, 10.8_

- [ ] 12. Static scans and deployment test
  - [ ] 12.1 Add the static scans to `tests/translator/catalog.test.ts`
    - Read every file under `src/translator/`; none matches `/\beval\s*\(|new\s+Function\b|\bfetch\s*\(|process\.env|XMLHttpRequest|WebSocket|node:(http|https|net|child_process)/`; none contains a dynamic `import(`; none imports from `tests/` or `oracle/`
    - `types.ts`, `sample-data.ts`, `markers.ts`, `cobol-runtime.ts` and `translations/**` have no `node:` import
    - For `translations/**` and `cobol-runtime.ts`: reject `next/`, `server-only`, `client-only`, `"use client"`, `"use server"`, `?raw`, `?url`, `import.meta.glob`, `require.context`, `@/` aliases, `process.`, `Buffer`, and any import specifier that is not relative-with-`.js`, `decimal.js`, or a type-only import
    - The only `src/equivalence` imports are `compare.js` and `descriptors.js`
    - `oracle.test.ts` contains none of `skip`, `skipIf`, `runIf`, `todo` (read as text)
    - _Requirements: 4.5, 4.7, 10.2_
  - [ ] 12.2 Write `tests/translator/deployment.test.ts` (no Oracle)
    - Read `.dockerignore`; fail if any non-comment line would exclude `cobol-samples`, `cobol-samples/`, `cobol-samples/*`, `cobol-samples/*.cbl`, `*.cbl`, `**/*.cbl`, or any of the three file names; `cobol-samples/bin` is allowed
    - The three `.cbl` files exist; the existing Oracle `Dockerfile` still has `COPY cobol-samples/`
    - Add a comment that this test must be extended with the app image `Dockerfile` when it exists (it must copy `cobol-samples/` and `src/translator/translations/`)
    - _Requirements: 12.1, 12.2, 12.3, 12.4_
  - [ ] 12.3 Run this task's tests, the full Vitest suite, `npm run typecheck` and `npm run lint`

- [ ] 13. Complete the registry and the "all nine" guarantee
  - [ ] 13.1 Tighten `translations/registry.ts`
    - Type it as `Readonly<Record<SampleId, Readonly<Record<Variant, TranslationModule>>>>` with all nine static imports, so a missing translation is a compile error; remove the "No translation registered" runtime path and its test from task 5.2
    - _Requirements: 4.1_
  - [ ] 13.2 Complete `catalog.test.ts` for all nine translations
    - Nine records; for every one, `source` equals the file bytes; provenance exact; markers name curses of the same sample; every `correct` source has every curse of its sample; every `subtle` source has a line with both a marker and `NOT HANDLED`; every `naive` source contains `DELIBERATELY WRONG`
    - _Requirements: 4.1 to 4.4, 5.1 to 5.4, 8.2_
  - [ ] 13.3 Complete `oracle.test.ts`
    - `UNDER_TEST` has all nine entries; add the final `it` that asserts `UNDER_TEST.length === 9` and covers every sample and variant, so the suite cannot go green with fewer
    - Confirm the nine `it`s per requirement 10.4 plus three ordering `it`s plus eight example-pair `it`s exist
    - _Requirements: 10.1 to 10.4_

- [ ] 14. Docs and final verification
  - [ ] 14.1 Update `.kiro/steering/structure.md`
    - Replace the `/src/translator/` line with `/src/translator/   COBOL -> TypeScript translations: pre-generated samples, catalog and read-only API`, add `/tests/translator/ catalog unit tests, property tests, and real-Oracle verification`, keep every other line
    - _Requirements: 11.3_
  - [ ] 14.2 Add an entry to `docs/kiro-log.md`
    - The spec, the forgotten trap chosen per sample and why (with the scores of every trap tried), the score table from the Oracle test, the elapsed time of the Oracle test, and any change made to a `naive` file
    - _Requirements: 7.3, 11.6_
  - [ ] 14.3 Final verification and report
    - Confirm `git status` shows no change under `src/equivalence/`, `src/oracle/`, or `tests/equivalence/`, and that `.kiro/specs/sample-catalog/` is not gitignored
    - Run `npm run typecheck`, `npm run lint`, `npm test`, and the sample equivalence suite
    - Report: the commands run, pass counts, and the table of actual scores (`matchScore`, `mismatchCount`, per-group counts) for the nine translations, marking which `subtle` scores are in the 0.90 to 0.995 target. Say what could not be verified (for example Next.js behaviour of `import.meta.url`, or the app image, which does not exist yet)
    - _Requirements: 7.3, 10.10, 11.1, 11.2, 11.4, 11.5_

## Notes

- Requirement 12.3 (the app image `Dockerfile`) cannot be fully implemented now because the app image does not exist. Task 12.2 guards `.dockerignore` and the Oracle image; the app image task must also copy `src/translator/translations/` (design, risk 2).
- Tasks 8.3, 9.3 and 10.3 each contain a "STOP and ask" condition. The tasks after a stop wait for the user's answer.
- Time: nine 1000-case Standard_Runs against the real Oracle are slow, and trap trials in tasks 8.3, 9.3 and 10.3 repeat runs. Rerun only the sample being tuned by temporarily narrowing `UNDER_TEST`; restore it before the checkpoint.

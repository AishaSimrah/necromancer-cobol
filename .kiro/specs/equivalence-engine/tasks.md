# Implementation Plan: equivalence-engine

## Overview

Implement `src/equivalence/` in TypeScript (strict, no `any`) with decimal.js, fast-check and Vitest. The plan is a vertical slice first, then incremental hardening.

1. A fast-check shrinking spike (task 1), because the shrink design depends on it.
2. A minimal end-to-end slice (task 2): basic generator, Oracle port, strict comparison, simple report, minimal `runEquivalence`, and the correct interest Candidate run against the REAL Oracle with `matchScore === 1`. A checkpoint (task 3) runs `tsc` and `vitest`.
3. Each remaining piece is its own top-level task that extends the slice's modules, in this order: config validation (4), evidence groups and classification (5), full edge-case generation (6), inconclusive handling with the fake Oracle (7), progress, abort and time budget (8), shrinking (9), the mismatch list cap (10), the naive Candidate and years 98/99/100 checks (11).
4. Then the public entry point and module boundary tests (12), the determinism property test (13), the full type check and suite (14), the sample equivalence suite (15), and a final checkpoint (16).

Only `oracle-port.ts` may import from `../oracle/index.js`. Tests live in `tests/equivalence/`. Each property test uses `numRuns >= 100` and a tag comment `Feature: equivalence-engine, Property N: ...`. Each module task ends with a sub-task that runs its tests, the full Vitest suite and `tsc --noEmit`.

## Tasks

- [x] 1. Spike: fast-check shrinking from a known failing example
  - [x] 1.1 Write the shrink spike test in `tests/equivalence/shrink-spike.test.ts`
    - Use `fc.check(fc.asyncProperty(fc.tuple(fc.bigInt(...), fc.bigInt(...)), ...), { examples: [[start]], seed, numRuns: 1, endOnFailure: false })` with a property that fails above a threshold
    - Assert the counterexample is smaller than the starting example, proving `examples` entries are shrunk
    - Also write a second test of the fallback: a greedy loop over `arb.shrink(value, undefined)` that keeps the first still-failing candidate and stops at a call limit
    - Record in a comment at the top of the file which approach the installed fast-check version supports; the `shrink.ts` implementation in task 9.1 uses that approach
    - _Requirements: 8.1, 8.3, 8.5_

- [ ] 2. Minimal end-to-end slice (real Oracle, correct interest Candidate)
  - [x] 2.1 Create the basic generator, minimal scaled arithmetic and the INTEREST descriptors
    - `src/equivalence/scaled.ts`: `pow10`, `fieldMaxUnits`, `formatScaled` (plain decimal text, never `-0`, no exponent) and `parseScaled`, using `bigint` only
    - `src/equivalence/descriptors.ts`: `FieldDescriptor` and `INTEREST` (principal 7/2, rate 3/2, years 2/0, all unsigned)
    - `src/equivalence/generate.ts`: simple `generateCases(fields, caseCount, seed)` returning `{ index, lines }` with one plain-decimal line per field and a small deterministic mix (zero, maximum, a few seeded in-range values via `fc.sample` on `fc.bigInt`); no edge corpus, group quotas or `group` field yet
    - _Requirements: 1.2, 3.1, 3.2, 3.10, 3.11_
  - [ ] 2.2 Create `src/equivalence/oracle-port.ts`
    - Define `OraclePort` as a `Pick<typeof realOracle, "compileCobol" | "runCompiled" | "releaseHandle" | "isCompiledHandle">` plus `defaultOracle`; re-export `CompiledHandle`, `RunResult`, `Status` types; this is the only file importing `../oracle/index.js`
    - _Requirements: 12.1, 12.2_
  - [ ] 2.3 Create `src/equivalence/compare.ts`
    - `invokeCandidate` passes a fresh copy of the lines, awaits promises, and converts throws, rejections and non-string returns to `{ kind: "error", text }`
    - Strict `===` comparison with no normalization
    - _Requirements: 2.6, 5.1, 5.2, 5.5, 5.7_
  - [ ] 2.4 Create minimal `report.ts` and `run.ts`
    - `report.ts`: `EquivalenceReport` (minimal: `outcome`, `matchScore`, `seed`, `casesRun`, `conclusiveCount`, `matchedCount`, `mismatchCount`, `mismatches`, `elapsedMs`) and `buildReport` with a single division for `matchScore`
    - `run.ts`: minimal `runEquivalence({ source, fields, candidate, caseCount?, seed?, oracle? })` with inline defaults (caseCount 1000, fixed seed when absent): `compileCobol` once, sequential `runCompiled` per case, strict compare, count matches and mismatches, `releaseHandle` exactly once in `finally`
    - In this slice a non-`ok` Oracle result or a non-handle compile result throws an error so that no score is ever produced from infrastructure failure; task 7 replaces this with proper inconclusive handling
    - _Requirements: 2.1, 2.2, 2.4, 5.3, 5.4, 7.1, 7.2, 7.4, 7.6_
  - [ ] 2.5 Add the correct interest Candidate and the real-Oracle slice test
    - Create `tests/equivalence/candidates/interest.ts` with `correctInterestCandidate` (decimal.js clone with precision 60, `store(value, digits, scale)` truncating toward zero, absolute value, modulo 10^digits; ROUND_HALF_UP each year; modulo 10^7; `Z(6)9.99` formatting after the literal `BALANCE: `)
    - Create `tests/equivalence/slice.real.test.ts`: probe Oracle availability once at module top level with `compileCobol` on `cobol-samples/interest.cbl` (release the handle if one is returned) and use `describe.skipIf(!available)`; run `runEquivalence` with INTEREST and the correct Candidate and assert `matchScore === 1` and `mismatchCount === 0`
    - Use a modest case count and Oracle-friendly settings so the test is fast; no test may rely on a known hang
    - _Requirements: 11.1, 11.3, 11.8_

- [ ] 3. Checkpoint - Slice works end to end
  - Run `npx tsc --noEmit` and `npx vitest --run`; the real-Oracle slice test must pass or be reported as skipped. Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Config validation
  - [ ] 4.1 Create `src/equivalence/config.ts` and complete the descriptors
    - Add `PAYROLL` (hours 3/1, rate 3/2) and `TAX` (income 8/0, unsigned) to `descriptors.ts`, and `validateDescriptors` throwing `EquivalenceConfigError` that names the field and invalid property or the violated list condition (empty, more than 20, duplicate names, name length, digits 1 to 18, scale 0 to 18, integers)
    - `config.ts`: `EquivalenceConfigError`, `Candidate`, `EquivalenceOptions`, `ResolvedConfig` and `resolveConfig` with defaults (caseCount 1000, mismatchListCap 25, shrinkLimit 200), range checks for caseCount, seed (int32), timeBudgetMs, mismatchListCap, shrinkLimit (in that order after descriptors), and a chosen seed when absent
    - Error messages name the setting and its permitted range
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 1.6, 3.12, 8.6, 9.1, 9.2, 9.3, 9.4, 9.8, 9.9, 9.10, 9.14, 9.15_
  - [ ] 4.2 Wire `resolveConfig` into `run.ts`
    - Replace the inline defaults; invalid configuration rejects before any Oracle call; the report carries the resolved seed
    - Update `generate.ts` to reject an empty descriptor list or non-positive digits
    - _Requirements: 1.5, 1.6, 3.12, 9.3, 9.8, 9.9, 9.10_
  - [ ]* 4.3 Write property tests for configuration
    - **Property 1: Invalid configuration is rejected before the Oracle is touched** (at the `resolveConfig` level here; the run-level check is in task 7.7)
    - **Property 2: Valid configuration is accepted**
    - Unit tests: sample descriptor constants for INTEREST, PAYROLL, TAX and defaults
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 8.6, 9.1, 9.2, 9.3, 9.4, 9.8, 9.9, 9.10, 9.14, 9.15**
  - [ ] 4.4 Run tests for this module
    - Run `npx vitest --run tests/equivalence` (including Properties 1 and 2), the full `npx vitest --run`, and `npx tsc --noEmit`; fix any failures

- [ ] 5. Evidence groups and classification
  - [ ] 5.1 Create `src/equivalence/classify.ts`
    - Define `EvidenceGroup`, `GROUP_ORDER` and `classifyVector` using decimal.js with precedence overflow, half-unit, zero or maximum, standard; an unsigned negative counts as overflow, `-0` does not
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_
  - [ ] 5.2 Attach groups to cases and add group summaries to the report
    - `generate.ts`: set each case's `group` from `classifyVector`
    - `report.ts`/`run.ts`: add `GroupSummary` (conclusive, matched, inconclusive per group), always the four groups in `GROUP_ORDER`, and the `group` on each `MismatchRecord`; counters keep group conclusive counts summing to `conclusiveCount`
    - _Requirements: 4.1, 4.8, 4.9, 5.4, 7.5_
  - [ ]* 5.3 Write property test for classification
    - **Property 7: Classification matches an independent specification and is total**
    - Use an independent decimal.js reference in the test; add examples for `0.005` at scale 2 and a negative unsigned field
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6**
  - [ ] 5.4 Run tests for this module
    - Run `npx vitest --run tests/equivalence` (including Property 7), the full `npx vitest --run`, and `npx tsc --noEmit`; fix any failures

- [ ] 6. Full edge-case generation
  - [ ] 6.1 Extend `src/equivalence/generate.ts` to the full design
    - The 8-kind edge corpus (constant size regardless of field count), then group-interleaved random slots using the 10-slot cycle, per-group `fc.bigInt` arbitraries sampled with `fc.sample` and a derived seed, overflow kinds (`aboveMax`, `extraIntegerDigits`, `negativeUnsigned`), and the negative-unsigned budget of `max(1, floor(0.10 * caseCount))`
    - Format with `formatScaled`; the case `group` stays `classifyVector` of the lines
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 3.13, 4.1, 4.7_
  - [ ]* 6.2 Write property test for vector shape
    - **Property 3: Generated vectors have one plain-decimal line per field** (includes the `parseScaled(formatScaled(x, d), d) === x` round trip)
    - File `tests/equivalence/generate.shape.test.ts`
    - **Validates: Requirements 3.1, 3.2, 3.10, 3.11**
  - [ ]* 6.3 Write property test for edge coverage
    - **Property 4: Edge coverage in sets of at least 100 vectors**
    - File `tests/equivalence/generate.coverage.test.ts`
    - **Validates: Requirements 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9**
  - [ ]* 6.4 Write property test for unsigned fields
    - **Property 5: Unsigned fields are non-negative except in a bounded set of vectors**
    - File `tests/equivalence/generate.unsigned.test.ts`
    - **Validates: Requirements 3.9, 3.13**
  - [ ]* 6.5 Write property test for generator determinism
    - **Property 6: Generation is deterministic**
    - File `tests/equivalence/generate.determinism.test.ts`
    - **Validates: Requirements 9.7**
  - [ ]* 6.6 Write property test for group quotas
    - **Property 8: Group quotas and construction agree with classification**
    - File `tests/equivalence/generate.groups.test.ts`
    - **Validates: Requirements 4.7**
  - [ ]* 6.7 Write generator unit tests
    - Empty descriptor list and non-positive digits reject with no vectors; the corpus fits in 100 vectors with 20 fields; `-0` is never emitted
    - File `tests/equivalence/generate.unit.test.ts`
    - _Requirements: 3.2, 3.12_
  - [ ] 6.8 Run tests for this module
    - Run `npx vitest --run tests/equivalence` (including Properties 3 to 6 and 8), the full `npx vitest --run`, and `npx tsc --noEmit`; fix any failures

- [ ] 7. Inconclusive handling and fake Oracle
  - [ ] 7.1 Create the fake Oracle double `tests/equivalence/doubles/fake-oracle.ts`
    - An `OraclePort` with scripted per-call results (or a function of the input), counters for `compileCobol`, `runCompiled` and `releaseHandle`, a call-order log, and options to throw or delay; the real Oracle is never touched
    - _Requirements: 12.2, 12.3, 11.6_
  - [ ] 7.2 Implement inconclusive handling in `run.ts` and `report.ts`
    - Replace the slice's throw: a non-`ok` `runCompiled` result becomes exactly one `InconclusiveCase` (input, group, status, message or `""`); the Candidate is not invoked for it; it is excluded from the score
    - A non-handle `compileCobol` result returns outcome `oracle_unavailable` with `oracleStatus`, `oracleMessage`, no `matchScore`, `casesRun` 0 and no release call
    - Report fields: `inconclusiveCases`, `inconclusiveCount`, `inconclusiveByStatus`, `containsInconclusive`, outcome `inconclusive` with no `matchScore` when there are zero conclusive cases, per-group inconclusive counts
    - Candidate throw, rejection or non-string output on an `ok` result is a Mismatch with the error text; `releaseHandle` runs once in `finally` and a release failure never masks the original error; runtime Oracle errors propagate
    - _Requirements: 2.3, 2.4, 2.5, 2.6, 2.7, 5.6, 5.7, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 7.3_
  - [ ]* 7.3 Write property test for strict comparison
    - **Property 9: Strict comparison and exact counting**
    - File `tests/equivalence/run.compare.test.ts` (fake Oracle)
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5**
  - [ ]* 7.4 Write property test for Candidate failures
    - **Property 10: Candidate failures are Mismatches, never run failures**
    - File `tests/equivalence/run.candidate-failures.test.ts`
    - **Validates: Requirements 2.6, 2.7, 5.6, 5.7**
  - [ ]* 7.5 Write property test for the Oracle lifecycle
    - **Property 11: Oracle lifecycle**
    - File `tests/equivalence/run.lifecycle.test.ts`
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**
  - [ ]* 7.6 Write property test for inconclusive cases
    - **Property 12: Inconclusive cases are recorded and excluded from the score**
    - File `tests/equivalence/run.inconclusive.test.ts`
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 7.1, 7.3**
  - [ ]* 7.7 Write property test for run-level rejection of invalid configuration
    - **Property 1: Invalid configuration is rejected before the Oracle is touched** (run level: the promise rejects and the fake Oracle records 0 calls, including `compileCobol`)
    - File `tests/equivalence/run.config.test.ts`
    - **Validates: Requirements 1.5, 1.6, 8.6, 9.8, 9.9, 9.10, 9.15**
  - [ ]* 7.8 Write fake-Oracle unit tests, one per scenario
    - Inconclusive exclusion from the score denominator
    - Handle release on Candidate failure (exactly 1 release)
    - Handle release on Oracle error (exactly 1 release; original error not masked when `releaseHandle` also throws)
    - Compile-error result: `oracle_unavailable`, no `matchScore`, 0 releases
    - Empty-conclusive outcome: `inconclusive`, no `matchScore`
    - Async Candidate resolves (awaited and compared)
    - Async Candidate rejects (Mismatch with rejection message, exactly 1 release)
    - File `tests/equivalence/run.unit.test.ts`
    - _Requirements: 2.3, 2.4, 2.5, 2.6, 6.2, 6.5, 11.6, 12.9_
  - [ ] 7.9 Run tests for this module
    - Run `npx vitest --run tests/equivalence` (including Properties 1, 9, 10, 11, 12), the full `npx vitest --run`, and `npx tsc --noEmit`; fix any failures

- [ ] 8. Progress, abort and time budget
  - [ ] 8.1 Add progress reporting to `run.ts`
    - `ProgressEvent` and `ProgressCallback` in `report.ts`; invoke `onProgress` once per finished case with `completed`, `target`, `group`, `matched`, `mismatches`, `inconclusive` (no score field), inside try/catch, awaiting a returned promise and discarding any error
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_
  - [ ] 8.2 Add abort, Time_Budget and Oracle timeout passthrough to `run.ts`
    - Pre-aborted signal: aborted report, `casesRun` 0, 0 Oracle calls, outcome `inconclusive`
    - Before each case stop on abort (`aborted`) or when `now() - start >= timeBudgetMs` (`budgetReached`), finishing the case in progress; `casesRun` is the completed count; the handle is released
    - Pass `{ runTimeoutMs: oracleTimeoutMs }` to `runCompiled` only when configured; add `now` injection and `elapsedMs`
    - _Requirements: 7.7, 9.5, 9.11, 9.12, 9.13_
  - [ ]* 8.3 Write property test for progress events
    - **Property 16: Progress events are consistent and isolated from results**
    - File `tests/equivalence/run.progress.test.ts`
    - **Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.6**
  - [ ]* 8.4 Write property test for Oracle timeout passthrough
    - **Property 17: Oracle timeout passthrough**
    - File `tests/equivalence/run.timeout.test.ts`
    - **Validates: Requirements 9.11**
  - [ ]* 8.5 Write unit tests for abort and Time_Budget
    - Time_Budget stop: ends within budget plus 1000 ms, `budgetReached` set, `casesRun` is the completed count
    - Pre-aborted signal: 0 Oracle calls, `aborted`, `casesRun` 0
    - Abort mid-run: stops starting cases, handle released once
    - File `tests/equivalence/run.abort.test.ts`
    - _Requirements: 7.7, 9.5, 9.12, 9.13, 11.6_
  - [ ] 8.6 Run tests for this module
    - Run `npx vitest --run tests/equivalence` (including Properties 16 and 17), the full `npx vitest --run`, and `npx tsc --noEmit`; fix any failures

- [ ] 9. Shrinking
  - [ ] 9.1 Create `src/equivalence/shrink.ts`
    - Implement `shrinkGroup(ctx, start)` using the approach confirmed by the spike (task 1.1): `fc.check` with `examples: [[startUnits]]` over a `bigint` tuple at scale `scale + 3`, or the `arb.shrink` greedy fallback
    - The property answers the starting example from the recorded Mismatch (no Oracle call), stops calling the Oracle at the limit or on abort, treats non-`ok` results as not failing, and keeps the last failing case as `best`; `limitReached` is set only for the limit
    - Return the `ShrunkExample` and the count of Oracle calls
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.7, 8.8, 8.11_
  - [ ] 9.2 Wire shrinking into `run.ts` and the report
    - After all cases finish, shrink each group with a Mismatch in `GROUP_ORDER`, starting from that group's first Mismatch (remembered during the loop independent of any list cap); skip remaining groups once aborted; add `shrunkExamples` and `shrinkOracleCalls` per group, separate from `casesRun`; no examples for groups without a Mismatch
    - _Requirements: 7.5, 8.1, 8.2, 8.8, 8.9, 8.10, 8.11_
  - [ ]* 9.3 Write property test for shrinking
    - **Property 14: Shrinking is bounded, separate, and only for failing groups**
    - File `tests/equivalence/shrink.test.ts` (fake Oracle)
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.8, 8.10**
  - [ ]* 9.4 Write shrinking unit tests
    - Shrinking starts after all cases finish; limit reached sets the flag; abort during shrinking keeps best-so-far and skips later groups; a Candidate mismatching in at least two groups gives exactly one example per mismatching group and `casesRun` is unchanged
    - File `tests/equivalence/shrink.unit.test.ts`
    - _Requirements: 8.7, 8.9, 8.11, 12.10_
  - [ ] 9.5 Run tests for this module
    - Run `npx vitest --run tests/equivalence` (including Property 14), the full `npx vitest --run`, and `npx tsc --noEmit`; fix any failures

- [ ] 10. Mismatch list cap
  - [ ] 10.1 Implement the cap in `report.ts` and `run.ts`
    - Use `mismatchListCap` from `resolveConfig`: store only the first N Mismatches in execution order, keep `mismatchCount` exact, set `mismatchListTruncated` when `mismatchCount > cap`; report invariants for a clean run (`matchScore === 1`, empty `mismatches` and `shrunkExamples`) and for any Mismatch (`matchScore < 1`)
    - _Requirements: 5.4, 7.5, 7.8, 7.9, 7.10, 7.11, 9.14_
  - [ ]* 10.2 Write property test for report count invariants
    - **Property 13: Report count invariants**
    - File `tests/equivalence/run.invariants.test.ts` (fake Oracle)
    - **Validates: Requirements 4.8, 4.9, 7.1, 7.2, 7.4, 7.5, 7.8, 7.9, 7.10, 7.11**
  - [ ]* 10.3 Write unit test for a cap smaller than mismatchCount
    - The list length equals the cap, `mismatchCount` is exact, `mismatchListTruncated` is true, and the listed entries are the first in execution order
    - File `tests/equivalence/run.cap.test.ts`
    - _Requirements: 7.5, 7.11, 12.9_
  - [ ] 10.4 Run tests for this module
    - Run `npx vitest --run tests/equivalence` (including Property 13), the full `npx vitest --run`, and `npx tsc --noEmit`; fix any failures

- [ ] 11. Naive Candidate and years verification (real Oracle)
  - [ ] 11.1 Add the naive Candidate and the real-Oracle interest tests
    - Add `naiveInterestCandidate` to `tests/equivalence/candidates/interest.ts` (floating point, no per-year rounding, no input truncation, no wrap, `balance.toFixed(2).padStart(10)` after `BALANCE: `)
    - Create `tests/equivalence/interest.real.test.ts` with the same top-level availability probe and `describe.skipIf(!available)`: the correct Candidate with the default Case_Count gives `matchScore === 1` and an empty `mismatches` list; the naive Candidate gives `mismatchCount >= 1`, `0 <= matchScore < 1`, and exactly one Shrunk_Example (input, Oracle output, Candidate output) per group that has a Mismatch and none for others
    - A modest `oracleTimeoutMs` keeps the suite fast; no test may rely on a known hang
    - _Requirements: 11.2, 11.3, 11.4, 11.8_
  - [ ] 11.2 Verify years = 98, 99 and 100 against the real Oracle
    - Confirm `cobol-samples/interest.cbl` has `WS-YEAR-IDX` as `PIC 999` (already present in the repo); do not change `WS-YEARS` (`PIC 99`)
    - In the same skip-guarded file, add three example tests with principal `1000.00`, rate `5.00`: `years = 98` and `years = 99` return status `ok` and the Oracle output equals the correct Candidate's output; `years = 100` is stored as `00`, runs zero iterations, and the Oracle output equals `BALANCE: ` followed by the principal in `Z(6)9.99` form (`BALANCE:    1000.00`), and equals the correct Candidate's output
    - If any of the three fails, report the discrepancy rather than editing the Candidate to match
    - _Requirements: 11.1, 11.3, 11.8_
  - [ ] 11.3 Run tests for this module
    - Run `npx vitest --run tests/equivalence`, the full `npx vitest --run`, and `npx tsc --noEmit`; real-Oracle tests must pass or be reported as skipped; fix any failures

- [ ] 12. Public entry point and module boundaries
  - [ ] 12.1 Create `src/equivalence/index.ts`
    - Export `runEquivalence`, `FieldDescriptor`, `EquivalenceReport`, `ProgressCallback`, `INTEREST`, `PAYROLL`, `TAX`, and the supporting types (`EquivalenceOptions`, `Candidate`, `EvidenceGroup`, `OraclePort`, `EquivalenceConfigError`)
    - _Requirements: 12.6_
  - [ ]* 12.2 Write module boundary tests in `tests/equivalence/modules.test.ts`
    - Static scan of `src/equivalence/**/*.ts`: 0 imports of `src/oracle/*` other than the index (and only in `oracle-port.ts`), 0 imports of analyzer, translator or app (relative or alias), 0 occurrences of `any`
    - Check the exports of `index.ts`; check that with an injected Oracle the real Oracle functions are never called
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_
  - [ ] 12.3 Run tests for this module
    - Run `npx vitest --run tests/equivalence`, the full `npx vitest --run`, and `npx tsc --noEmit`; fix any failures

- [ ] 13. Determinism
  - [ ]* 13.1 Write the determinism property test
    - **Property 15: Same inputs, same report**
    - Run at least 20 distinct Seeds with the fake Oracle, comparing reports with `elapsedMs` removed; file `tests/equivalence/determinism.test.ts`
    - **Validates: Requirements 7.6, 9.6, 9.7, 11.5**
  - [ ] 13.2 Run tests for this module
    - Run `npx vitest --run tests/equivalence` (including Property 15), the full `npx vitest --run`, and `npx tsc --noEmit`; fix any failures

- [ ] 14. Type check and full suite
  - [ ] 14.1 Run type check and full test suite
    - Run `npx tsc --noEmit` and `npx vitest --run`; fix all errors, confirm real-Oracle tests either pass or are reported as skipped
    - _Requirements: 11.8, 12.5_

- [ ] 15. Sample equivalence suite
  - [ ] 15.1 Run the sample equivalence suite
    - Run `scripts/run-samples.sh` (via bash/Docker as the repo supports) and confirm it passes before declaring the feature done; report any failure to the user
    - _Requirements: 11.3_

- [ ] 16. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Order: shrink spike, minimal vertical slice against the real Oracle, then incremental modules (config, groups, generation, inconclusive, progress/abort/budget, shrinking, cap, naive Candidate), then entry point, determinism, full verification.
- Tasks marked with `*` are optional and can be skipped for a faster MVP, but the user asked for every property to be tested, so run them unless time forces a cut.
- Task 1.1 decides the shrink implementation used in task 9.1.
- Each module task ends with a "Run tests for this module" sub-task: module tests, the full Vitest suite and `tsc --noEmit`.
- Property 1 is covered at two levels: `resolveConfig` (task 4.3) and run level with the fake Oracle (task 7.7).
- Property tests that need a later module are placed in that module's task: Properties 9 to 12 in task 7 (fake Oracle), Property 13 in task 10 (cap), Property 14 in task 9, Properties 16 and 17 in task 8, Property 15 in task 13.
- Each property is one test with `numRuns >= 100` and the tag `Feature: equivalence-engine, Property N: <text>`; test files are separate per property so parallel tasks do not share files.
- Only the deliberately naive Candidate in `tests/equivalence/candidates/interest.ts` may use floating point.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["2.2", "2.3"] },
    { "id": 2, "tasks": ["2.4"] },
    { "id": 3, "tasks": ["2.5"] },
    { "id": 4, "tasks": ["4.1"] },
    { "id": 5, "tasks": ["4.2"] },
    { "id": 6, "tasks": ["4.3", "4.4"] },
    { "id": 7, "tasks": ["5.1"] },
    { "id": 8, "tasks": ["5.2"] },
    { "id": 9, "tasks": ["5.3", "5.4"] },
    { "id": 10, "tasks": ["6.1"] },
    { "id": 11, "tasks": ["6.2", "6.3", "6.4", "6.5", "6.6", "6.7"] },
    { "id": 12, "tasks": ["6.8"] },
    { "id": 13, "tasks": ["7.1"] },
    { "id": 14, "tasks": ["7.2"] },
    { "id": 15, "tasks": ["7.3", "7.4", "7.5", "7.6", "7.7", "7.8"] },
    { "id": 16, "tasks": ["7.9"] },
    { "id": 17, "tasks": ["8.1"] },
    { "id": 18, "tasks": ["8.2"] },
    { "id": 19, "tasks": ["8.3", "8.4", "8.5"] },
    { "id": 20, "tasks": ["8.6"] },
    { "id": 21, "tasks": ["9.1"] },
    { "id": 22, "tasks": ["9.2"] },
    { "id": 23, "tasks": ["9.3", "9.4"] },
    { "id": 24, "tasks": ["9.5"] },
    { "id": 25, "tasks": ["10.1"] },
    { "id": 26, "tasks": ["10.2", "10.3"] },
    { "id": 27, "tasks": ["10.4"] },
    { "id": 28, "tasks": ["11.1"] },
    { "id": 29, "tasks": ["11.2"] },
    { "id": 30, "tasks": ["11.3"] },
    { "id": 31, "tasks": ["12.1"] },
    { "id": 32, "tasks": ["12.2"] },
    { "id": 33, "tasks": ["12.3"] },
    { "id": 34, "tasks": ["13.1"] },
    { "id": 35, "tasks": ["13.2"] },
    { "id": 36, "tasks": ["14.1"] },
    { "id": 37, "tasks": ["15.1"] }
  ]
}
```

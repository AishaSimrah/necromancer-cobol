# Implementation Plan: equivalence-engine

## Overview

Implement `src/equivalence/` in TypeScript (strict, no `any`) with decimal.js, fast-check and Vitest. Build bottom-up: scaled arithmetic, descriptors and config, classification, generation, the Oracle port, comparison, report counters, the run loop, shrinking, then the public entry point and real-Oracle verification. A fast-check shrinking spike comes first because the shrink design depends on it. Only `oracle-port.ts` may import from `../oracle/index.js`. Tests live in `tests/equivalence/`. Each property test uses `numRuns >= 100` and a tag comment `Feature: equivalence-engine, Property N: ...`.

## Tasks

- [ ] 1. Spike: fast-check shrinking from a known failing example
  - [ ] 1.1 Write the shrink spike test in `tests/equivalence/shrink-spike.test.ts`
    - Use `fc.check(fc.asyncProperty(fc.tuple(fc.bigInt(...), fc.bigInt(...)), ...), { examples: [[start]], seed, numRuns: 1, endOnFailure: false })` with a property that fails above a threshold
    - Assert the counterexample is smaller than the starting example, proving `examples` entries are shrunk
    - Also write a second test of the fallback: a greedy loop over `arb.shrink(value, undefined)` that keeps the first still-failing candidate and stops at a call limit
    - Record in a comment at the top of the file which approach the installed fast-check version supports; the `shrink.ts` implementation in task 7.1 uses that approach
    - _Requirements: 8.1, 8.3, 8.5_

- [ ] 2. Scaled arithmetic, descriptors and configuration
  - [ ] 2.1 Create `src/equivalence/scaled.ts`
    - Implement `pow10`, `fieldMaxUnits`, `formatScaled` (plain decimal text, never `-0`, no exponent) and `parseScaled` (returns null for non plain-decimal text or too many places) using `bigint` only
    - _Requirements: 3.2, 3.10_
  - [ ]* 2.2 Write property test for scaled round trip
    - **Property 3: Generated vectors have one plain-decimal line per field (round-trip part)**
    - **Validates: Requirements 3.2, 3.11**
  - [ ] 2.3 Create `src/equivalence/descriptors.ts`
    - Define `FieldDescriptor`, `INTEREST`, `PAYROLL`, `TAX` and `validateDescriptors`, throwing `EquivalenceConfigError` that names the field and invalid property or the violated list condition
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_
  - [ ] 2.4 Create `src/equivalence/config.ts`
    - Define `EquivalenceConfigError`, `Candidate`, `EquivalenceOptions`, `ResolvedConfig` and `resolveConfig` with defaults (caseCount 1000, mismatchListCap 25, shrinkLimit 200) and range checks for caseCount, seed (int32), timeBudgetMs, mismatchListCap, shrinkLimit; choose a seed when absent
    - Error messages name the setting and its permitted range
    - _Requirements: 1.5, 1.6, 8.6, 9.1, 9.2, 9.3, 9.4, 9.8, 9.9, 9.10, 9.14, 9.15_
  - [ ]* 2.5 Write property tests for configuration
    - **Property 1: Invalid configuration is rejected before the Oracle is touched** (at the `resolveConfig` level here; the Oracle-call count is checked in task 6.4)
    - **Property 2: Valid configuration is accepted**
    - Unit tests: sample descriptor constants for INTEREST, PAYROLL, TAX and defaults
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 8.6, 9.1, 9.2, 9.3, 9.4, 9.8, 9.9, 9.10, 9.14, 9.15**

- [ ] 3. Classification and generation
  - [ ] 3.1 Create `src/equivalence/classify.ts`
    - Define `EvidenceGroup`, `GROUP_ORDER` and `classifyVector` using decimal.js with precedence overflow, half-unit, zero or maximum, standard; unsigned negative counts as overflow, `-0` does not
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_
  - [ ]* 3.2 Write property test for classification
    - **Property 7: Classification matches an independent specification and is total**
    - Use an independent decimal.js reference in the test; add examples for `0.005` at scale 2 and a negative unsigned field
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6**
  - [ ] 3.3 Create `src/equivalence/generate.ts`
    - Implement `generateCases(fields, caseCount, seed)`: the 8-kind edge corpus (constant size regardless of field count), then group-interleaved random slots using the 10-slot cycle, per-group `fc.bigInt` arbitraries sampled with `fc.sample` and a derived seed, overflow kinds, and the negative-unsigned budget of `max(1, floor(0.10 * caseCount))`
    - Format with `formatScaled`; set each case's `group` from `classifyVector`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 3.13, 4.1, 4.7_
  - [ ]* 3.4 Write property tests for generation
    - **Property 3: Generated vectors have one plain-decimal line per field**
    - **Property 4: Edge coverage in sets of at least 100 vectors**
    - **Property 5: Unsigned fields are non-negative except in a bounded set of vectors**
    - **Property 6: Generation is deterministic**
    - **Property 8: Group quotas and construction agree with classification**
    - Each is its own test in `tests/equivalence/generate.test.ts`
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.11, 3.13, 4.7, 9.7**
  - [ ]* 3.5 Write unit tests for generator errors and corpus
    - Empty descriptor list and non-positive digits reject with no vectors; corpus fits in 100 vectors with 20 fields
    - _Requirements: 3.12_

- [ ] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Oracle port, comparison and report counters
  - [ ] 5.1 Create `src/equivalence/oracle-port.ts`
    - Define `OraclePort` as a `Pick<typeof realOracle, ...>` of `compileCobol`, `runCompiled`, `releaseHandle`, `isCompiledHandle`, plus `defaultOracle`; re-export `CompiledHandle`, `RunResult`, `Status` types; this is the only file importing `../oracle/index.js`
    - _Requirements: 12.1, 12.2, 12.3_
  - [ ] 5.2 Create `src/equivalence/compare.ts`
    - Implement `invokeCandidate` passing a fresh copy of the lines, awaiting promises, converting throws, rejections and non-string returns to `{ kind: "error", text }`; strict `===` comparison with no normalization
    - _Requirements: 2.6, 5.1, 5.2, 5.5, 5.7_
  - [ ] 5.3 Create `src/equivalence/report.ts`
    - Define `EquivalenceReport`, `MismatchRecord`, `InconclusiveCase`, `GroupSummary`, `ProgressEvent`, `ProgressCallback`, `Outcome`, a `RunCounters` accumulator (integer counts, capped mismatch list, first mismatch per group, per-status inconclusive counts) and `buildReport` with a single division for `matchScore`, absent when there are no conclusive cases, optional keys omitted
    - _Requirements: 4.8, 4.9, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.11_
  - [ ] 5.4 Create the fake Oracle in `tests/equivalence/doubles/fake-oracle.ts`
    - Scripted per-call results (or a function of the input), counters for `compileCobol`, `runCompiled` and `releaseHandle`, call-order log, options to throw or delay
    - Create `tests/equivalence/candidates/interest.ts` with `correctInterestCandidate` (decimal.js, clone with precision 60, `store(value, digits, scale)` truncating, absolute value, modulo; ROUND_HALF_UP each year; modulo 10^7; `Z(6)9.99` formatting) and `naiveInterestCandidate` (floating point, no rounding, no wrap)
    - _Requirements: 11.1, 11.2, 11.6_

- [ ] 6. Run loop
  - [ ] 6.1 Create `src/equivalence/run.ts` (case loop, without shrinking)
    - `runEquivalence`: `resolveConfig`; pre-aborted returns an aborted report with 0 Oracle calls; `compileCobol` once; a RunResult yields `oracle_unavailable` with no release; otherwise generate cases and run them sequentially with `runCompiled(handle, lines, opts)` where `opts` is `{ runTimeoutMs }` only when configured
    - Handle `ok` (Candidate, compare, count) and non-`ok` (Inconclusive_Case); stop on abort or Time_Budget with the case in progress finished; call `onProgress` once per case inside try/catch discarding errors and awaiting promises
    - `finally` releases the handle exactly once and swallows a release failure so it never masks the original error; runtime Oracle errors propagate
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 5.1, 5.3, 5.4, 5.6, 5.7, 6.1, 9.5, 9.11, 9.12, 9.13, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_
  - [ ]* 6.2 Write property tests for the run loop (fake Oracle)
    - **Property 9: Strict comparison and exact counting**
    - **Property 10: Candidate failures are Mismatches, never run failures**
    - **Property 11: Oracle lifecycle**
    - **Property 12: Inconclusive cases are recorded and excluded from the score**
    - **Property 13: Report count invariants**
    - **Property 16: Progress events are consistent and isolated from results**
    - **Property 17: Oracle timeout passthrough**
    - One test per property in `tests/equivalence/run.test.ts`
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 4.8, 4.9, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 7.1, 7.2, 7.3, 7.4, 7.5, 7.8, 7.9, 7.10, 7.11, 9.11, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6**
  - [ ]* 6.3 Write fake-Oracle unit tests, one per scenario
    - Inconclusive exclusion from the score denominator
    - Handle release on Candidate failure (exactly 1 release)
    - Handle release on Oracle error (exactly 1 release; original error not masked when `releaseHandle` also throws)
    - Compile-error result: `oracle_unavailable`, no `matchScore`, 0 releases
    - Empty-conclusive outcome: `inconclusive`, no `matchScore`
    - Time_Budget stop: ends within budget plus 1000 ms, `budgetReached` set, `casesRun` is the completed count
    - Async Candidate resolves (awaited and compared)
    - Async Candidate rejects (Mismatch with rejection message, exactly 1 release)
    - Mismatch cap smaller than `mismatchCount` (list length equals cap, count exact, `mismatchListTruncated` true)
    - Pre-aborted signal (0 Oracle calls, `aborted`, `casesRun` 0) and abort mid-run
    - _Requirements: 2.3, 2.4, 2.5, 2.6, 6.2, 6.5, 7.5, 9.5, 9.12, 9.13, 11.6, 12.9_
  - [ ]* 6.4 Write property test for the run-level rejection of invalid configuration
    - **Property 1: Invalid configuration is rejected before the Oracle is touched** (run level: the promise rejects and the fake Oracle records 0 calls, including `compileCobol`)
    - **Validates: Requirements 1.5, 1.6, 8.6, 9.8, 9.9, 9.10, 9.15**

- [ ] 7. Shrinking
  - [ ] 7.1 Create `src/equivalence/shrink.ts`
    - Implement `shrinkGroup(ctx, start)` using the approach confirmed by the spike (task 1.1): `fc.check` with `examples: [[startUnits]]` over a `bigint` tuple at scale `scale + 3`, or the `arb.shrink` greedy fallback
    - The property answers the starting example from the recorded Mismatch (no Oracle call), stops calling the Oracle at the limit or on abort, treats non-`ok` results as not failing, and keeps the last failing case as `best`; set `limitReached` only for the limit
    - Return the `ShrunkExample` and the count of Oracle calls
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.7, 8.8, 8.11_
  - [ ] 7.2 Wire shrinking into `run.ts`
    - After all cases finish, shrink each group with a Mismatch in `GROUP_ORDER`, starting from that group's first Mismatch; skip remaining groups once aborted; record `shrinkOracleCalls` per group, separate from `casesRun`; produce no examples for groups without a Mismatch
    - _Requirements: 8.1, 8.2, 8.8, 8.9, 8.10, 8.11_
  - [ ]* 7.3 Write property test and unit tests for shrinking (fake Oracle)
    - **Property 14: Shrinking is bounded, separate, and only for failing groups**
    - Unit tests: shrinking starts after all cases finish; limit reached sets the flag; abort during shrinking keeps best-so-far and skips later groups; a Candidate mismatching in at least two groups gives exactly one example per mismatching group and `casesRun` is unchanged
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.7, 8.8, 8.9, 8.10, 8.11, 12.10**

- [ ] 8. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Public entry point and module boundaries
  - [ ] 9.1 Create `src/equivalence/index.ts`
    - Export `runEquivalence`, `FieldDescriptor`, `EquivalenceReport`, `ProgressCallback`, `INTEREST`, `PAYROLL`, `TAX`, and the supporting types (`EquivalenceOptions`, `Candidate`, `EvidenceGroup`, `OraclePort`, `EquivalenceConfigError`)
    - _Requirements: 12.6_
  - [ ]* 9.2 Write module boundary tests in `tests/equivalence/modules.test.ts`
    - Static scan of `src/equivalence/**/*.ts`: 0 imports of `src/oracle/*` other than the index (and only in `oracle-port.ts`), 0 imports of analyzer, translator or app (relative or alias), 0 occurrences of `any`
    - Check the exports of `index.ts`; check that with an injected Oracle the real Oracle functions are never called
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_

- [ ] 10. Determinism and real-Oracle verification
  - [ ]* 10.1 Write the determinism property test
    - **Property 15: Same inputs, same report**
    - Run at least 20 distinct Seeds with the fake Oracle, comparing reports with `elapsedMs` removed
    - **Validates: Requirements 7.6, 9.6, 9.7, 11.5**
  - [ ] 10.2 Write real-Oracle interest tests in `tests/equivalence/interest.real.test.ts`
    - Probe availability once at module top level with `compileCobol` on `cobol-samples/interest.cbl` (release the handle if one is returned); use `describe.skipIf(!available)` so tests are reported as skipped, not passed or failed, when the Oracle is unavailable
    - Correct Candidate with default Case_Count: `matchScore === 1`, empty `mismatches`
    - Naive Candidate: `mismatchCount >= 1`, `0 <= matchScore < 1`, exactly one Shrunk_Example (with input, Oracle output and Candidate output) per group that has a Mismatch and none for others
    - A modest `oracleTimeoutMs` keeps the suite fast; no test may rely on a known hang
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.8_
  - [ ] 10.3 Verify years = 98, 99 and 100 against the real Oracle
    - Confirm `cobol-samples/interest.cbl` has `WS-YEAR-IDX` as `PIC 999` (already present in the repo); do not change `WS-YEARS` (`PIC 99`)
    - In the same skip-guarded file, add three example tests with principal `1000.00`, rate `5.00`: `years = 98` and `years = 99` return status `ok` and the Oracle output equals the correct Candidate's output; `years = 100` is stored as `00`, runs zero iterations, and the Oracle output equals `BALANCE: ` followed by the principal in `Z(6)9.99` form (`BALANCE:    1000.00`), and equals the correct Candidate's output
    - If any of the three fails, report the discrepancy rather than editing the Candidate to match
    - _Requirements: 11.1, 11.3, 11.8_

- [ ] 11. Final verification
  - [ ] 11.1 Run type check and full test suite
    - Run `npx tsc --noEmit` and `npx vitest --run`; fix all errors, confirm real-Oracle tests either pass or are reported as skipped
    - _Requirements: 12.5, 11.8_
  - [ ] 11.2 Run the sample equivalence suite
    - Run `scripts/run-samples.sh` (via bash/Docker as the repo supports) and confirm it passes before declaring the feature done; report any failure to the user
    - _Requirements: 11.3_

- [ ] 12. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP, but the user asked for every property to be tested, so run them unless time forces a cut.
- Task 1.1 decides the shrink implementation used in task 7.1.
- Property 1 is covered at two levels: `resolveConfig` (task 2.5) and run level with the fake Oracle (task 6.4).
- Property 3 is covered by the round trip in task 2.2 and the vector-shape test in task 3.4.
- Each property is one test with `numRuns >= 100` and the tag `Feature: equivalence-engine, Property N: <text>`.
- Only the deliberately naive Candidate in `tests/equivalence/candidates/interest.ts` may use floating point.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "5.1"] },
    { "id": 1, "tasks": ["2.2", "2.3", "5.2"] },
    { "id": 2, "tasks": ["2.4", "3.1"] },
    { "id": 3, "tasks": ["2.5", "3.2", "3.3", "5.3"] },
    { "id": 4, "tasks": ["3.4", "3.5", "5.4"] },
    { "id": 5, "tasks": ["6.1"] },
    { "id": 6, "tasks": ["6.2", "6.3", "6.4", "7.1"] },
    { "id": 7, "tasks": ["7.2"] },
    { "id": 8, "tasks": ["7.3", "9.1"] },
    { "id": 9, "tasks": ["9.2", "10.1", "10.2"] },
    { "id": 10, "tasks": ["10.3"] },
    { "id": 11, "tasks": ["11.1"] },
    { "id": 12, "tasks": ["11.2"] }
  ]
}
```

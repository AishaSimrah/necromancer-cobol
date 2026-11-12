# Requirements Document

## Introduction

The Sample_Catalog lives in `src/translator/`. It ships the three COBOL samples in `cobol-samples/` (INTEREST, PAYROLL, TAX) together with ready-made TypeScript translations. The existing Equivalence_Engine (`runEquivalence` in `src/equivalence/`) can verify each translation against the real GnuCOBOL Oracle.

Every translation is an ordinary TypeScript module in the repository, written now and imported statically. At runtime there is no LLM call, no network access, and no `eval` or `new Function`. The catalog labels each translation "Pre-generated with Kiro".

Each sample has three translation variants:

- `correct`: exact COBOL semantics, expected to score exactly 1.
- `subtle`: looks right and passes normal inputs, but forgets exactly one realistic COBOL trap, so it fails only on edge cases.
- `naive`: the typical first-attempt translation, clearly wrong.

The variants let the UI demonstrate the product's core claim: the proof is the score, not the translation.

Scope: catalog data, translation modules, a small read-only API, and verification tests against the real Oracle. Out of scope: any UI, the analyzer, LLM-based translation, the repair loop, and any change to `src/equivalence/`, `src/oracle/`, or existing tests.

Written in TypeScript strict mode with no `any`. Decimal math uses decimal.js or bigint. The `correct` translations never use JavaScript floating point. Only `naive` translations may.

## Glossary

- **Sample_Catalog**: The module in `src/translator/` that holds Sample records and Translation records.
- **Sample**: One catalog entry. Its id is `interest`, `payroll`, or `tax`.
- **Variant**: One of `correct`, `subtle`, `naive`.
- **Translation**: A TypeScript module for one Sample and one Variant. It exports a Candidate, its readable source text, and a Provenance record.
- **Candidate**: The type defined in `src/equivalence/compare.ts`: `(inputLines: string[]) => string | Promise<string>`.
- **Provenance**: A record with `label` (the string "Pre-generated with Kiro"), `generatedWith` (the string "Kiro"), and `date` (an ISO 8601 date string, `YYYY-MM-DD`).
- **Curse**: A COBOL trap shown as a chip in the UI. It has an `id`, a short `label`, and `lines`, the COBOL source line numbers it refers to.
- **Curse_Marker**: A comment of the form `// CURSE:<id>` placed on or directly above a risky line in a Translation's source text.
- **Fidelity_Pact**: A checklist of 3 to 4 short statements describing what the translation must preserve.
- **Example_Pair**: One documented input vector with its documented expected output, taken from `cobol-samples/EXPECTED.md`.
- **Oracle**: The existing COBOL runner in `src/oracle`, reached through `runEquivalence`.
- **Match_Score**: `matchScore` in the Equivalence_Report returned by `runEquivalence`.
- **Standard_Run**: A call to `runEquivalence` with `caseCount` 1000 and `seed` 1, using the Sample's COBOL source and its FieldDescriptors.

## Requirements

### Requirement 1: Sample records

**User Story:** As a UI developer, I want one complete record per sample, so that the Crypt and Ritual screens can render without extra lookups.

#### Acceptance Criteria

1. THE Sample_Catalog SHALL contain exactly three Samples, in this order: `interest`, `payroll`, `tax`.
2. THE Sample_Catalog SHALL give each Sample these fields: `id`, a display name (`INTEREST`, `PAYROLL`, `TAX`), a one-line trap label, the COBOL source text, the FieldDescriptors, a default example input, a list of Example_Pairs, a Fidelity_Pact, and a list of Curses.
3. THE Sample_Catalog SHALL take the COBOL source text of each Sample from the matching file in `cobol-samples/` (`interest.cbl`, `payroll.cbl`, `tax.cbl`) and SHALL NOT keep a second copy of that text in the repository.
3a. THE Sample_Catalog SHALL read those files on the server with Node `fs`, and SHALL resolve their paths from `import.meta.url` (the location of the catalog module relative to the repository root). It SHALL NOT use `process.cwd()` or any other working-directory-dependent path.
3b. IF a COBOL source file cannot be read, THEN THE Sample_Catalog SHALL throw an error that names the Sample and the resolved path. It SHALL NOT fall back to an empty string or to embedded text.
3c. THE Sample_Catalog module that reads files SHALL be server-only. It SHALL NOT be imported by client components, and the catalog types and the Curse data SHOULD live in a separate module that has no `fs` import, so a client component can import types without pulling in `fs`.
4. THE Sample_Catalog SHALL reuse the `INTEREST`, `PAYROLL`, and `TAX` FieldDescriptor lists exported from `src/equivalence/descriptors.ts` and SHALL NOT redefine them.
5. THE Sample_Catalog SHALL give each Sample a default example input with exactly one input line per FieldDescriptor, in FieldDescriptor order, formatted as plain decimal text. The default example input of each Sample SHALL be one of that Sample's Example_Pairs.
6. THE Sample_Catalog SHALL give each Sample a trap label of one line (no line break) that names the main trap. The labels SHALL be:
   - INTEREST: per-year rounding and silent overflow.
   - PAYROLL: overtime and truncated deduction.
   - TAX: progressive brackets.
7. THE Sample_Catalog SHALL give each Sample a Fidelity_Pact of 3 to 4 statements. Each statement SHALL be a single line of at most 80 characters.

### Requirement 2: Example pairs

**User Story:** As a judge, I want to see documented input and output pairs, so that I can check the translation by hand.

#### Acceptance Criteria

1. THE Sample_Catalog SHALL hold, for each Sample, every Example_Pair documented in `cobol-samples/EXPECTED.md`: three for INTEREST, two for PAYROLL, three for TAX.
2. Each Example_Pair SHALL store the input as an array of input lines and the expected output as the exact DISPLAY text, including internal spacing and the trailing newline (for example `"BALANCE:    1157.63\n"`).
3. For multi-line outputs (PAYROLL), THE expected output SHALL be the concatenation of the DISPLAY lines, each terminated by a newline, in program order.
4. THE verification tests SHALL fail if any Example_Pair in the catalog differs from the corresponding entry in `cobol-samples/EXPECTED.md`, after the test parses that file.

### Requirement 3: Curses

**User Story:** As a UI developer, I want a list of traps with line numbers, so that I can show curse chips and highlight the risky COBOL lines.

#### Acceptance Criteria

1. THE Sample_Catalog SHALL give each Curse a unique `id` (lowercase letters, digits, and hyphens, unique within the whole catalog), a chip `label` of at most 32 characters, and a non-empty `lines` list of 1-based line numbers of the Sample's COBOL source.
2. EVERY line number in a Curse SHALL be at least 1 and at most the line count of that Sample's COBOL source.
3. THE Sample_Catalog SHALL define these Curses, derived from the comments and behaviour of the programs. The line numbers refer to the current files:

   | Sample | Curse id | Chip label (intent) | COBOL lines |
   |---|---|---|---|
   | interest | `interest-yearly-rounding` | per-year rounding | 29, 30, 31 |
   | interest | `interest-overflow` | silent field overflow | 17, 30 |
   | interest | `interest-years-pic99` | PIC 99 years | 16, 27 |
   | payroll | `payroll-overtime` | overtime over 40 at 1.5x | 29, 30, 31, 37 |
   | payroll | `payroll-compute-rounding` | per-COMPUTE rounding | 36, 37 |
   | payroll | `payroll-deduct-truncated` | deduction truncated, not rounded | 39 |
   | payroll | `payroll-z-format` | Z(5)9.99 output format | 22, 41, 42, 43, 44, 45, 46 |
   | tax | `tax-brackets` | progressive brackets | 20, 22, 23, 24, 25, 26, 27 |
   | tax | `tax-evaluate-first-match` | EVALUATE first match | 19, 20, 22, 24, 26, 28 |
   | tax | `tax-whole-unit-rounding` | whole-unit rounding | 13, 23, 25, 27 |

4. THE verification tests SHALL check that every Curse line number exists in the COBOL source and that the line is not blank.
5. IF the COBOL source file is edited so that a Curse line number no longer points at the intended statement, THE verification tests SHOULD fail. The tests SHALL check this by asserting, for each Curse, that at least one of its lines contains a keyword given in the test for that Curse (for example `ROUNDED` for `interest-yearly-rounding`).

### Requirement 4: Translation modules and provenance

**User Story:** As a developer, I want each translation to be a plain readable module, so that it can be reviewed, tested, and shown next to the COBOL.

#### Acceptance Criteria

1. THE Sample_Catalog SHALL provide exactly nine Translations: three Variants for each of the three Samples.
2. EACH Translation SHALL export a Candidate, its own source text as a string, and a Provenance record.
3. THE source text exported by a Translation SHALL be identical to the text of the module file that defines the Candidate. The verification tests SHALL check this by comparing the exported text with the file content read from disk.
4. EVERY Provenance record SHALL have `label` equal to "Pre-generated with Kiro", `generatedWith` equal to "Kiro", and a `date` that is a valid ISO 8601 date.
5. THE Translations SHALL be imported statically. THE Sample_Catalog SHALL NOT call `eval`, `new Function`, dynamic `import()` of generated text, `fetch`, or any other network API, and SHALL NOT read any API key or environment variable.
6. THE Candidate of every Translation SHALL be synchronous in effect (it SHALL NOT start timers, read files, or call the network), and SHALL return a string for every input vector with one line per FieldDescriptor.
7. THE `src/translator/` code SHALL NOT import from `tests/`. `src/translator/` MAY import from `src/equivalence/` for types and FieldDescriptors only, and SHALL NOT import from `src/oracle/`.

### Requirement 5: Curse markers in source text

**User Story:** As a UI developer, I want risky lines marked in the TypeScript, so that I can highlight them beside the COBOL.

#### Acceptance Criteria

1. EACH Translation source text SHALL mark each risky line with a Curse_Marker `// CURSE:<id>`, where `<id>` is a Curse id of the same Sample.
2. EVERY Curse of a Sample SHALL appear in the source text of the `correct` Translation of that Sample as at least one Curse_Marker.
3. EVERY Curse_Marker in any Translation of a Sample SHALL name an existing Curse id of that Sample. The verification tests SHALL fail on an unknown id.
4. IN the `subtle` Translation, the line that handles the forgotten trap SHALL carry the Curse_Marker of that trap, even though the line is wrong or missing the correct handling. THE `subtle` Translation SHALL include a comment on the line that states what is not handled, so a reader can see the omission.
5. THE Sample_Catalog SHALL expose the Curse_Markers of a Translation as a list of `{ curseId, line }` records, where `line` is the 1-based line number in the Translation source text, computed from the source text.

### Requirement 6: The `correct` Variant

**User Story:** As a judge, I want a translation that is provably faithful, so that I can see a score of 100%.

#### Acceptance Criteria

1. THE `correct` Translation SHALL use bigint or decimal.js for all field values and arithmetic, and SHALL NOT use JavaScript floating point for any field value.
2. THE `correct` Translation SHALL model NUMVAL on the input text, then store the value into the target field as COBOL does: truncate toward zero to the field scale, take the absolute value for unsigned fields, and drop high-order digits (value modulo 10^digits) when the value exceeds the field.
3. THE `correct` Translation SHALL round at every `COMPUTE ... ROUNDED` statement, half away from zero, to the scale of the target field, and SHALL truncate toward zero at every COMPUTE without ROUNDED.
4. THE `correct` Translation SHALL apply silent overflow (modulo 10^digits) on every stored result field, including intermediate fields (for example `WS-REG-PAY`, `WS-OT-PAY`, `WS-GROSS`, `WS-DEDUCT`, `WS-NET`, `WS-TAX`, and the INTEREST balance on every year).
5. THE `correct` Translation SHALL produce the exact DISPLAY text: the literal prefix, the Z-edited value with leading zeros replaced by spaces, the exact number of decimals, and a trailing newline on every DISPLAY line.
6. THE `correct` Translation of PAYROLL SHALL print the three lines `GROSS`, `DEDUCT`, `NET`, in that order.
7. THE `correct` Translation of TAX SHALL pick the first matching branch only, using the same comparisons as the COBOL EVALUATE.
8. WHEN a Standard_Run is made for any Sample with its `correct` Translation, THE Match_Score SHALL be exactly 1, `mismatchCount` SHALL be 0, and `inconclusiveCount` SHALL be 0.

### Requirement 7: The `subtle` Variant

**User Story:** As a judge, I want a translation that looks right but is not, so that I see the proof catch a bug that normal tests would miss.

#### Acceptance Criteria

1. THE `subtle` Translation SHALL be written with the same structure and the same decimal arithmetic as the `correct` Translation, and SHALL differ from it by the handling of exactly one COBOL trap.
2. THE preferred forgotten trap SHALL be silent field overflow (no modulo wrap on the stored result). IF this trap does not give the target score in criterion 3 for a Sample, THEN THE trap forgotten for that Sample MAY be changed to another single realistic COBOL trap of that Sample (for example the high-order truncation of an input field, or the absolute value of a negative input). The change SHALL be made in the Translation only, and SHALL NOT change `src/equivalence/`, `src/oracle/`, any comparison, or any existing test.
3. WHEN a Standard_Run is made for each Sample with its `subtle` Translation, THE Match_Score SHOULD be at least 0.90 and below 0.995. This range is a reported target only. It SHALL NOT be asserted by any test. THE implementation report SHALL state the actual Match_Score, `mismatchCount`, and per-group pass counts for each Sample.
4. IF no single-trap omission gives a Match_Score in the range of criterion 3 for a Sample, THEN the implementer SHALL stop, report the measured scores for each candidate trap, and ask the user for a decision. The implementer SHALL NOT widen the range, pick a score outside it, or continue to later work for that Sample without the answer.
5. WHEN a Standard_Run is made for each Sample with its `subtle` Translation, THE Match_Score SHALL be below 1 and `mismatchCount` SHALL be at least 1. This criterion is a pass/fail condition of the verification tests.
5a. FOR each Sample, THE verification tests SHALL assert the strict ordering `naive Match_Score < subtle Match_Score < 1`, using the Standard_Run scores of the two Translations. The test failure message SHALL show both scores.
5b. IF the ordering of criterion 5a fails for a Sample because the `naive` Translation scores too high, THEN the implementer SHALL make the `naive` Translation worse in a realistic way (Requirement 8.4). IF it fails because the `subtle` Translation scores too low, THEN the implementer SHALL change the forgotten trap of the `subtle` Translation (criterion 2). The implementer SHALL NOT change the ordering rule, the engine, or the comparison.
6. THE `subtle` Translation SHALL return the same output as the `correct` Translation for every example input in the Example_Pairs of that Sample.

### Requirement 8: The `naive` Variant

**User Story:** As a judge, I want to see the typical first attempt fail loudly, so that the value of the proof is clear.

#### Acceptance Criteria

1. THE `naive` Translation SHALL be the kind of translation a developer would write first: JavaScript floating point, rounding once at the end or truncating where COBOL rounds, no wrap-around, and no input truncation.
2. THE `naive` Translation MAY be the only Variant that uses JavaScript floating point. Its source text SHALL carry a comment saying that it is deliberately wrong.
3. WHEN a Standard_Run is made for each Sample with its `naive` Translation, THE Match_Score SHALL be below 1.
4. WHEN a Standard_Run is made for each Sample with its `naive` Translation, THE report SHALL show at least one mismatch in each of at least two Evidence_Groups. This SHALL be a hard test condition for every Sample, TAX included. The implementer SHALL measure the per-group mismatch counts of all three `naive` Translations and report them. IF a `naive` Translation does not meet the condition (for TAX, for example, a naive flat-rate or float translation may mismatch in only one group), THEN the implementer SHALL change that `naive` Translation to a different realistic first attempt that does meet it. The implementer SHALL NOT weaken this requirement, the group definitions, or the engine.
5. THE `naive` Translation of INTEREST SHALL be equivalent to `naiveInterestCandidate` and the `correct` Translation of INTEREST SHALL be equivalent to `correctInterestCandidate`, both in `tests/equivalence/candidates/interest.ts`. Because `src/translator/` must not import from `tests/` (Requirement 4.7), the code SHALL be copied into `src/translator/` with the Curse_Markers and comments added. The original test files SHALL stay unchanged.
6. THE verification tests SHALL check criterion 5 with a test that imports both the copies in `src/translator/` and the originals in `tests/equivalence/candidates/interest.ts`, and compares their outputs, with `toBe` on the raw strings, for 200 input vectors. The vectors SHALL be generated from a fixed seed (the Equivalence_Engine's generator is not required; a fast-check generator with a fixed seed over the INTEREST FieldDescriptors is enough), SHALL be the same on every run, and SHALL include the three INTEREST Example_Pairs. The 200 vectors SHALL cover overflowing, zero, maximum, and half-unit-rounding inputs.
7. IF the copy and the original differ in output for any of the 200 vectors, THEN the test SHALL fail and show the input, the original output, and the copy output. The copy SHALL be fixed, not the test.
8. IF the `naive` INTEREST copy needs to change in order to satisfy Requirement 7.5a or criterion 4, THEN criterion 5 no longer applies to it. The implementer SHALL then report the change and the reason, and remove the equivalence test for that variant only. The `correct` copy SHALL always stay equivalent to the original.

### Requirement 9: Read-only API

**User Story:** As an app developer, I want a small, safe API, so that the UI and the API routes can use the catalog without knowing its layout.

#### Acceptance Criteria

1. THE Sample_Catalog SHALL export `listSamples()`, which returns the three Samples in the order of Requirement 1.1.
2. THE Sample_Catalog SHALL export `getSample(id)`, which returns the Sample with that id. IF the id is not `interest`, `payroll`, or `tax`, THEN it SHALL throw an error whose message names the unknown id and lists the valid ids.
3. THE Sample_Catalog SHALL export `getTranslation(sampleId, variant)`, which returns the Translation. IF the sample id or the variant is not valid, THEN it SHALL throw an error whose message names the invalid value and lists the valid values.
4. THE types of the API arguments SHALL be string-literal unions (`SampleId`, `Variant`), so that invalid values are rejected by the compiler. THE functions SHALL also validate their arguments at runtime, because API routes pass strings.
5. THE returned records SHALL be read-only (`readonly` properties and `readonly` arrays) and SHALL be frozen, so that a caller cannot change the catalog. Two calls with the same arguments SHALL return equal data.
6. THE API SHALL NOT start the Oracle, call `runEquivalence`, or run any Candidate. It only returns data.

### Requirement 10: Verification tests against the real Oracle

**User Story:** As a developer, I want tests that run the real COBOL, so that "it lives" is always backed by evidence.

#### Acceptance Criteria

1. THE verification tests SHALL use the existing `runEquivalence` with the real Oracle (no `oracle` option, no fake) for the Standard_Run.
2. THE verification tests SHALL NOT use `skipIf`, `skip`, `todo`, `runIf`, or any conditional that silently skips a test when the Oracle is unavailable.
3. IF the Oracle is unavailable (the report outcome is `oracle_unavailable` or `inconclusive`, or `inconclusiveCount` is above 0), THEN the test SHALL fail with a message that names the Sample, the Variant, and the Oracle status and message. It SHALL NOT pass.
4. THE verification tests SHALL contain these checks for each of the three Samples:
   - `correct`: `matchScore` equals 1 exactly, `mismatchCount` equals 0, `conclusiveCount` equals 1000, `inconclusiveCount` equals 0.
   - `subtle`: `matchScore` is below 1 and `mismatchCount` is at least 1.
   - `naive`: `matchScore` is below 1, and the mismatches fall in at least two Evidence_Groups (Requirement 8.4). The test reads this from `report.groups` (a group counts when `conclusive - matched` is at least 1).
   - ordering: `naive matchScore < subtle matchScore < 1` (Requirement 7.5a).
5. THE verification tests SHALL check each Example_Pair against both sides: the Oracle output for the input lines equals the documented output, and the `correct` Translation output equals the documented output. The Oracle side SHALL use `compileCobol`, `runCompiled`, and `releaseHandle` from `src/oracle`, and SHALL release every handle, also on failure.
6. THE verification tests SHALL shut the Oracle down after the suite (`shutdown()` from `src/oracle`).
7. THE verification tests SHALL use a test timeout that fits 1000 real Oracle runs per Standard_Run, and SHALL NOT lower `caseCount`, change `seed`, or loosen any comparison to make a test pass.
8. THE verification tests SHALL be written with Vitest. THE tests SHALL include fast-check property tests where a property exists, for example: for any input vector, the `correct` Translation returns a string that ends with a newline, has the expected line count, and does not throw; the `subtle` Translation equals the `correct` Translation when no input value overflows its field (properties for this are defined in the design).
9. THE catalog unit tests (shape, order, Curses, markers, provenance, API errors, immutability) SHALL run without the Oracle and SHALL be separate from the Oracle tests, so that a missing Oracle is visible only in the Oracle tests.
10. BEFORE the work is declared done, THE implementer SHALL run the full test suite and the sample equivalence suite, and SHALL report the commands run, the pass counts, and the actual Match_Score of each `subtle` and `naive` Translation.

### Requirement 11: Repository hygiene

**User Story:** As a maintainer, I want the new code to fit the repo, so that modules stay independent and testable.

#### Acceptance Criteria

1. THE implementation SHALL NOT modify any file in `src/equivalence/` or `src/oracle/`, or any existing test file.
2. THE implementation SHALL put all new source code under `src/translator/` and new tests under `tests/translator/`.
3. THE implementation SHALL update `.kiro/steering/structure.md` to describe `src/translator/` (pre-generated sample translations and catalog) and `tests/translator/`, and SHALL keep the existing lines of that file.
4. THE implementation SHALL pass `tsc` in strict mode and the project's ESLint configuration with no `any`, no `@ts-ignore`, and no `eslint-disable` comments.
5. THE `.kiro/specs/sample-catalog/` files SHALL be committed (not gitignored).
6. THE implementation SHALL add a short entry to `docs/kiro-log.md` describing this spec and its outcome.

### Requirement 12: Deployment

**User Story:** As a deployer, I want the app image to contain the COBOL files the catalog reads, so that the catalog works outside the dev machine.

#### Acceptance Criteria

1. ANY deployment image that runs the app (the Next.js server or the Node service that imports the Sample_Catalog) SHALL contain the directory `cobol-samples/` with `interest.cbl`, `payroll.cbl`, and `tax.cbl`, at the same position relative to the compiled catalog module that the path resolution of Requirement 1.3a expects.
2. THE `.dockerignore` file SHALL NOT exclude those three `.cbl` files. It MAY keep excluding `cobol-samples/bin`.
3. THE `Dockerfile` of the app image SHALL contain an explicit `COPY` of `cobol-samples/`. IF the app image is not yet in the repository, THEN this requirement SHALL be recorded as a task in the plan for the app image, and the implementation SHALL add a test that fails when `.dockerignore` excludes the `.cbl` files.
4. THE existing Oracle image already copies `cobol-samples/` (the `Dockerfile` in the repository root). THE implementation SHALL NOT change it to satisfy this requirement.
5. IF the files are missing at runtime, THE error of Requirement 1.3b SHALL make the cause visible (the Sample id and the resolved path), instead of a silent empty catalog.

## Decisions recorded

1. **INTEREST candidates:** copied into `src/translator/` with Curse_Markers; originals untouched; a 200-vector seeded test compares copies and originals (Requirement 8.5 to 8.8).
2. **COBOL text:** read on the server with `fs`, paths resolved from `import.meta.url`, deployment image must contain `cobol-samples/` (Requirements 1.3a to 1.3c, 12).
3. **Subtle range:** 0.90 to 0.995 is a reported target only. Hard test rule: `naive < subtle < 1` with at least one subtle mismatch. If no single trap lands in the target range, stop and ask (Requirements 7.3 to 7.5b).
4. **Naive TAX:** measure the `naive` variants. A `naive` Translation that does not show mismatches in at least two Evidence_Groups is changed, never the requirement (Requirement 8.4).

## Notes

- The line numbers in Requirement 3.3 count from line 1 = `>>SOURCE FORMAT FREE` in the current files. The tests in 3.4 and 3.5 guard against drift.
- Requirement 12.3: the repository currently has only the Oracle image `Dockerfile`, and `deploy-test/` has a separate test Dockerfile. I have not read `deploy-test/`; the design will check whether it is the app image.

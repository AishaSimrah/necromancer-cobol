# Requirements Document

## Introduction

The Equivalence_Engine lives in `src/equivalence/`. It proves that a candidate TypeScript translation behaves identically to a COBOL program. It compiles the COBOL once with the existing Oracle (`compileCobol`, `runCompiled`, `releaseHandle` from `src/oracle`), generates many inputs with fast-check biased toward COBOL edge cases, runs the Oracle and the Candidate on each input, and compares the DISPLAY output character for character.

The result is an Equivalence_Report containing a match score, the number of cases run, an exact mismatch count, a capped list of mismatches, at most one shrunk minimal example per Evidence_Group, inconclusive cases, and named Evidence_Groups with pass counts. The match score is the core product artifact: it is reported only after the tests have actually run.

The Equivalence_Engine is independent of the analyzer and translator. For now, Field_Descriptors are written by hand for the three samples in `cobol-samples/` (interest, payroll, tax). A later analyzer spec will produce them from the PIC clauses.

Scope: single-file calculation programs, inputs via ACCEPT (stdin), outputs via DISPLAY. Written in TypeScript strict mode with no `any`. Decimal math uses decimal.js; JavaScript floating point is never used for field values in the engine.

## Glossary

- **Equivalence_Engine**: The module in `src/equivalence/` that proves a Candidate matches a COBOL program.
- **Oracle**: The existing COBOL runner in `src/oracle` (`compileCobol`, `runCompiled`, `releaseHandle`).
- **Candidate**: A function `(inputLines: string[]) => string | Promise<string>` that returns the program's DISPLAY output text, either directly or as a promise that the Equivalence_Engine awaits. A Candidate that throws, or whose promise rejects, is a failing Candidate.
- **Negative_Unsigned_Vector**: An Input_Vector in which at least one unsigned field has a negative value. COBOL stores the absolute value when a negative number is moved into an unsigned field, so these vectors probe that behavior.
- **Field_Descriptor**: A record describing one input field: `name`, `digits` (count of integer digits, the n in `9(n)`), `scale` (count of implied decimal places, the digits after `V`), and `signed` (true or false), taken from the PIC clause. For example, `PIC 9(7)V99` gives digits 7 and scale 2.
- **Input_Vector**: An ordered list of input lines, one per Field_Descriptor, in the order the COBOL program ACCEPTs them.
- **Test_Case**: One Input_Vector together with the Oracle output and the Candidate output for it.
- **Conclusive_Case**: A Test_Case whose Oracle result has status `ok`.
- **Inconclusive_Case**: A Test_Case whose Oracle result has a status other than `ok` (`timeout`, `resource_limit`, `compile_error`, `environment_error`, or any other non-ok status).
- **Matched_Case**: A Conclusive_Case whose Oracle stdout equals the Candidate output character for character.
- **Mismatch**: A Conclusive_Case whose Oracle stdout differs from the Candidate output in at least one character.
- **Match_Score**: The count of Matched_Cases divided by the count of Conclusive_Cases.
- **Equivalence_Report**: The result object returned by the Equivalence_Engine.
- **Evidence_Group**: A named category of generated inputs with its own case count and pass count. The four groups are `standard computation`, `zero and maximum boundaries`, `half-unit rounding boundary`, and `field overflow behavior`.
- **Seed**: An integer that determines the full sequence of generated Input_Vectors.
- **Time_Budget**: The maximum wall-clock duration, in milliseconds, for a single engine run.
- **Case_Count**: The configured number of Test_Cases to attempt.
- **Shrunk_Example**: The minimal failing Input_Vector produced by fast-check shrinking for an Evidence_Group, with its Oracle output and Candidate output. At most one exists per Evidence_Group.
- **Mismatch_Count**: The exact number of Mismatches in a run, reported as `mismatchCount`, independent of how many Mismatches are listed.
- **Mismatch_List_Cap**: The configurable maximum number of Mismatch entries stored in the `mismatches` list of the Equivalence_Report. The default is 25.
- **Mismatch_List_Truncated**: A boolean flag in the Equivalence_Report that is true if and only if Mismatch_Count is greater than the Mismatch_List_Cap.
- **Progress_Callback**: A caller-supplied function the Equivalence_Engine invokes to report run progress.
- **Field_Maximum**: The largest magnitude a field can hold, equal to 10^digits minus 10^(-scale).

## Requirements

### Requirement 1: Field descriptors and sample definitions

**User Story:** As a developer, I want hand-written Field_Descriptors for the three samples, so that the engine can be exercised before the analyzer exists.

#### Acceptance Criteria

1. THE Equivalence_Engine SHALL accept a list of 1 to 20 Field_Descriptors in which each entry has a name (a non-empty string of 1 to 64 characters, unique within the list), an integer digits value from 1 to 18, an integer scale value from 0 to 18, and a boolean signed flag.
2. THE Equivalence_Engine SHALL provide Field_Descriptors for `cobol-samples/interest.cbl` with three fields in this order: principal (digits 7, scale 2, unsigned), rate (digits 3, scale 2, unsigned), and years (digits 2, scale 0, unsigned).
3. THE Equivalence_Engine SHALL provide Field_Descriptors for `cobol-samples/payroll.cbl` with two fields in this order: hours (digits 3, scale 1, unsigned) and rate (digits 3, scale 2, unsigned).
4. THE Equivalence_Engine SHALL provide Field_Descriptors for `cobol-samples/tax.cbl` with one field: income (digits 8, scale 0, unsigned).
5. IF a Field_Descriptor has a digits value less than 1 or greater than 18, a scale value less than 0 or greater than 18, or a non-integer digits or scale value, THEN THE Equivalence_Engine SHALL reject the run with an error message identifying the offending field name and the invalid property, and THE Equivalence_Engine SHALL invoke the Oracle 0 times.
6. IF the list of Field_Descriptors is empty, contains more than 20 entries, or contains two entries with the same name, THEN THE Equivalence_Engine SHALL reject the run with an error message identifying which condition was violated, and THE Equivalence_Engine SHALL invoke the Oracle 0 times.

### Requirement 2: Oracle lifecycle

**User Story:** As a developer, I want the COBOL compiled once and always cleaned up, so that runs are fast and leak no resources.

#### Acceptance Criteria

1. WHEN a run starts, THE Equivalence_Engine SHALL call `compileCobol` exactly once with the COBOL source, before any Input_Vector is executed against the Oracle.
2. WHEN `compileCobol` returns a handle, THE Equivalence_Engine SHALL execute every Oracle call for that run through `runCompiled` with that handle, and SHALL NOT call `compileCobol` again during the same run.
3. IF `compileCobol` returns a RunResult instead of a handle, THEN THE Equivalence_Engine SHALL return an Equivalence_Report with outcome `oracle_unavailable`, the Oracle status, the Oracle message, and no Match_Score, SHALL execute zero Input_Vectors, and SHALL call `releaseHandle` zero times.
4. WHEN a run finishes, THE Equivalence_Engine SHALL call `releaseHandle` exactly once for each handle obtained, after the last `runCompiled` call for that handle and before the Equivalence_Report is returned to the caller.
5. IF an error is thrown during a run after a handle has been obtained, THEN THE Equivalence_Engine SHALL call `releaseHandle` exactly once for each handle obtained before propagating or reporting the error, and SHALL NOT mask the original error if `releaseHandle` itself throws.
6. IF the Candidate throws an exception or returns a rejected promise for an Input_Vector and the Oracle result for that Input_Vector is Conclusive, THEN THE Equivalence_Engine SHALL count a Mismatch for that Input_Vector, SHALL use the exception's or rejection's message as the Candidate output of that Mismatch, and SHALL continue the run with the next Input_Vector.
7. IF the Candidate throws an exception or returns a rejected promise for an Input_Vector and the Oracle result for that Input_Vector is not Conclusive, THEN THE Equivalence_Engine SHALL NOT record a Mismatch for that Input_Vector, and SHALL continue the run with the next Input_Vector.

### Requirement 3: Input generation

**User Story:** As a developer, I want inputs biased toward COBOL edge cases, so that translation traps are found quickly.

#### Acceptance Criteria

1. WHEN the Equivalence_Engine generates an Input_Vector, THE Equivalence_Engine SHALL use fast-check to produce exactly one input line per Field_Descriptor, in Field_Descriptor order.
2. THE Equivalence_Engine SHALL format every generated input line as plain decimal text, consisting of an optional leading minus sign, digits, and an optional decimal point followed by digits, with no exponent notation, no thousands separators, and no leading or trailing whitespace, so that the COBOL NUMVAL function can parse the line.
3. WHEN the Equivalence_Engine generates a set of at least 100 Input_Vectors, THE Equivalence_Engine SHALL include, for each Field_Descriptor, at least one vector in which that field has the value zero.
4. WHEN the Equivalence_Engine generates a set of at least 100 Input_Vectors, THE Equivalence_Engine SHALL include, for each Field_Descriptor, at least one vector in which that field has the Field_Maximum.
5. WHEN the Equivalence_Engine generates a set of at least 100 Input_Vectors, THE Equivalence_Engine SHALL include, for each Field_Descriptor, at least one vector with the value Field_Maximum minus one unit of the least significant digit, and at least one vector with the value Field_Maximum plus one unit of the least significant digit.
6. WHEN the Equivalence_Engine generates a set of at least 100 Input_Vectors, THE Equivalence_Engine SHALL include, for each Field_Descriptor with scale greater than 0, at least one vector whose value has exactly scale plus 1 decimal places with a final digit of 5 (for example `x.xx5` for scale 2).
7. WHEN the Equivalence_Engine generates a set of at least 100 Input_Vectors, THE Equivalence_Engine SHALL include, for each Field_Descriptor, at least one vector whose value has between 1 and 3 more decimal places than the Field_Descriptor scale.
8. WHERE a Field_Descriptor is signed, THE Equivalence_Engine SHALL include at least one negative value and at least one positive value for that field in every set of at least 100 Input_Vectors.
9. WHERE a Field_Descriptor is unsigned, WHEN the Equivalence_Engine generates a set of at least 100 Input_Vectors, THE Equivalence_Engine SHALL include at least one Negative_Unsigned_Vector with a negative value (leading minus sign) for that field, and SHALL generate every other value for that field as greater than or equal to zero with no minus sign.
10. THE Equivalence_Engine SHALL construct generated values using decimal.js or integer arithmetic on scaled values, without JavaScript floating point.
11. FOR ALL generated Input_Vectors, THE Equivalence_Engine SHALL produce a vector whose length equals the number of Field_Descriptors (invariant property).
12. IF the Equivalence_Engine receives an empty list of Field_Descriptors or a Field_Descriptor with a non-positive digit count, THEN THE Equivalence_Engine SHALL reject generation with an error indicating the invalid descriptor and SHALL produce no Input_Vectors.
13. WHEN the Equivalence_Engine generates a set of at least 100 Input_Vectors, THE Equivalence_Engine SHALL limit the Negative_Unsigned_Vectors to no more than 10 percent of the Input_Vectors in the set, counted per unsigned field.

### Requirement 4: Evidence groups

**User Story:** As a judge, I want results grouped by kind of risk, so that I can see which COBOL traps were exercised.

#### Acceptance Criteria

1. THE Equivalence_Engine SHALL assign every generated Test_Case to exactly one of the four Evidence_Groups: `standard computation`, `zero and maximum boundaries`, `half-unit rounding boundary`, `field overflow behavior`.
2. THE Equivalence_Engine SHALL classify an Input_Vector as qualifying for `zero and maximum boundaries` IF at least one of its fields equals zero or equals the Field_Maximum of that field.
3. THE Equivalence_Engine SHALL classify an Input_Vector as qualifying for `half-unit rounding boundary` IF at least one of its fields has a fractional part whose digits beyond the field's declared scale are exactly 5 followed by zeros only (for example, 0.005 for a field with 2 decimal places).
4. THE Equivalence_Engine SHALL classify an Input_Vector as qualifying for `field overflow behavior` IF at least one of its fields has a value greater than the Field_Maximum, has more integer digits than the field's declared integer digit count, or is an unsigned field with a negative value (a Negative_Unsigned_Vector).
5. THE Equivalence_Engine SHALL assign to `standard computation` each Input_Vector that qualifies for none of `zero and maximum boundaries`, `half-unit rounding boundary` and `field overflow behavior`.
6. WHEN an Input_Vector qualifies for more than one group, THE Equivalence_Engine SHALL assign it to the first qualifying group in this order: `field overflow behavior`, `half-unit rounding boundary`, `zero and maximum boundaries`, `standard computation`.
7. WHERE the Case_Count is at least 40, THE Equivalence_Engine SHALL schedule each Evidence_Group to receive at least floor(Case_Count multiplied by 0.10) generated Test_Cases.
8. WHEN an Equivalence_Report is produced, THE Equivalence_Report SHALL list, for each of the four Evidence_Groups, the group name, the number of Conclusive_Cases, the number of Matched_Cases, and the number of Inconclusive_Cases, listing a group with zero cases with all three counts equal to 0.
9. FOR ALL runs, the sum of Conclusive_Cases over all four Evidence_Groups SHALL equal the total Conclusive_Cases in the Equivalence_Report (invariant property).

### Requirement 5: Comparison

**User Story:** As a developer, I want exact comparison, so that formatting differences such as leading-zero suppression are caught.

#### Acceptance Criteria

1. WHEN the Oracle returns status `ok` for an Input_Vector, THE Equivalence_Engine SHALL invoke the Candidate exactly once with the same input lines in the same order, and SHALL await the Candidate's result when the Candidate returns a promise.
2. THE Equivalence_Engine SHALL compare Oracle stdout and Candidate output with strict string equality over every character, without trimming, case folding, line-ending normalization, or whitespace normalization.
3. WHEN the Oracle stdout equals the Candidate output, THE Equivalence_Engine SHALL count the Test_Case as a Matched_Case.
4. WHEN the Oracle stdout differs from the Candidate output, THE Equivalence_Engine SHALL count the Test_Case as a Mismatch in Mismatch_Count and, WHILE the number of listed Mismatches is less than the Mismatch_List_Cap, SHALL record the exact Input_Vector, the Oracle stdout, the Candidate output, and the Evidence_Group for that Test_Case in the mismatches list.
5. THE Equivalence_Engine SHALL invoke the Candidate with a fresh copy of the input lines for each Test_Case, so that Candidate mutation cannot affect later cases.
6. IF the Oracle returns a status other than `ok` for an Input_Vector, THEN THE Equivalence_Engine SHALL NOT invoke the Candidate for that Input_Vector and SHALL NOT count the Test_Case as a Matched_Case or a Mismatch.
7. IF the Candidate throws an error, returns a rejected promise, or fails to return output for a Test_Case whose Oracle status is `ok`, THEN THE Equivalence_Engine SHALL count the Test_Case as a Mismatch, record the error indication in place of the Candidate output, and continue with the remaining Test_Cases.

### Requirement 6: Inconclusive handling

**User Story:** As a developer, I want infrastructure failures kept out of the score, so that a slow Oracle never looks like a wrong translation.

#### Acceptance Criteria

1. IF the Oracle returns a status other than `ok` for an Input_Vector, THEN THE Equivalence_Engine SHALL record exactly one Inconclusive_Case for that Input_Vector containing the Input_Vector, the Oracle status, and the Oracle message (an empty string if the Oracle supplied none).
2. THE Equivalence_Engine SHALL exclude Inconclusive_Cases from both the numerator and the denominator of the Match_Score, so that Match_Score equals matching Conclusive_Cases divided by total Conclusive_Cases.
3. THE Equivalence_Report SHALL include the total count of Inconclusive_Cases and a count per distinct Oracle status, where the per-status counts sum to the total count.
4. THE Equivalence_Report SHALL list Inconclusive_Cases in a collection separate from the Mismatches, and no Input_Vector SHALL appear in both collections for the same Test_Case.
5. IF a run produces zero Conclusive_Cases (including a run of zero Input_Vectors), THEN THE Equivalence_Engine SHALL return an Equivalence_Report with outcome `inconclusive`, no Match_Score value (absent, not 0 and not 100), and the Inconclusive_Cases listed.
6. IF a run contains at least one Inconclusive_Case and at least one Conclusive_Case, THEN THE Equivalence_Engine SHALL still compute the Match_Score from the Conclusive_Cases only and SHALL mark the Equivalence_Report as containing inconclusive cases.

### Requirement 7: Match score and report

**User Story:** As a judge, I want a trustworthy score, so that "It lives" is only shown when the proof ran.

#### Acceptance Criteria

1. WHEN a run completes with at least one Conclusive_Case, THE Equivalence_Engine SHALL set matchScore to the count of Matched_Cases divided by the count of Conclusive_Cases, where Conclusive_Cases are the Test_Cases that are not Inconclusive_Cases.
2. THE Equivalence_Engine SHALL compute matchScore from integer counts of Matched_Cases and Conclusive_Cases, performing exactly one division, so that no floating-point error accumulates across cases.
3. IF no Test_Case has been executed, or every executed Test_Case is an Inconclusive_Case, THEN THE Equivalence_Report SHALL omit the matchScore field, set casesRun to the number of Test_Cases executed (0 if none), and SHALL NOT present any success state.
4. THE Equivalence_Report SHALL include casesRun, equal to the number of Test_Cases executed against the Oracle, including Inconclusive_Cases.
5. THE Equivalence_Report SHALL include mismatchCount, equal to the exact number of Mismatches; a mismatches list containing the first Mismatches in execution order, up to the Mismatch_List_Cap, where each entry SHALL contain the Input_Vector, the Oracle output, the Candidate output, and the Evidence_Group; a Mismatch_List_Truncated flag; and a shrunkExamples collection containing at most one Shrunk_Example per Evidence_Group.
6. THE Equivalence_Report SHALL include the Seed used for the run, such that re-running with the same Seed, Oracle, and Candidate reproduces the same Test_Cases and the same matchScore.
7. THE Equivalence_Report SHALL include the elapsed duration as a non-negative integer number of milliseconds, and a boolean flag that is true if and only if the run stopped because the Time_Budget was reached.
8. WHEN every Conclusive_Case is a Matched_Case and at least one Conclusive_Case exists, THE Equivalence_Report SHALL have matchScore equal to exactly 1, mismatchCount equal to 0, an empty mismatches list, and an empty shrunkExamples collection.
9. WHEN at least one Mismatch exists, THE Equivalence_Report SHALL have matchScore less than 1, mismatchCount of at least 1, and a mismatches list with at least one entry.
10. FOR ALL Equivalence_Reports with a matchScore, matchScore SHALL be between 0 and 1 inclusive, and the count of Matched_Cases plus mismatchCount SHALL equal the count of Conclusive_Cases, and the count of Conclusive_Cases plus the count of Inconclusive_Cases SHALL equal casesRun (invariant property).
11. FOR ALL Equivalence_Reports, the length of the mismatches list SHALL equal the smaller of mismatchCount and the Mismatch_List_Cap, and the Mismatch_List_Truncated flag SHALL be true if and only if mismatchCount is greater than the Mismatch_List_Cap (invariant property).

### Requirement 8: Shrinking

**User Story:** As a developer, I want a minimal failing example, so that I can see exactly where the translation diverges.

#### Acceptance Criteria

1. WHEN all Test_Cases of a run have finished and an Evidence_Group contains at least one Mismatch, THE Equivalence_Engine SHALL run fast-check shrinking exactly once for that Evidence_Group, starting from the first Mismatch of that group in execution order, to find a smaller Input_Vector that still produces a Mismatch, where "smaller" is the ordering defined by the fast-check arbitraries used to generate the Input_Vector.
2. WHEN shrinking for an Evidence_Group completes or is stopped, THE Equivalence_Engine SHALL include in the shrunkExamples collection of the Equivalence_Report exactly one Shrunk_Example for that Evidence_Group, containing the Evidence_Group name, the shrunk Input_Vector, the Oracle output for it, and the Candidate output for it.
3. IF no smaller Input_Vector than the starting failing Input_Vector produces a Mismatch, THEN THE Equivalence_Engine SHALL report the starting failing Input_Vector as the Shrunk_Example of that Evidence_Group, together with its Oracle output and Candidate output.
4. IF an Oracle call during shrinking yields an Inconclusive_Case, THEN THE Equivalence_Engine SHALL treat that candidate Input_Vector as not failing, so that shrinking never converges on an infrastructure failure.
5. THE Equivalence_Engine SHALL limit shrinking to a configurable maximum number of Oracle calls per Evidence_Group, with a default of 200 and an accepted range of 1 to 10,000.
6. IF the configured shrinking limit is outside the range 1 to 10,000 or is not an integer, THEN THE Equivalence_Engine SHALL reject the configuration with an error indicating the invalid limit and SHALL NOT start the run.
7. WHEN the shrinking limit is reached for an Evidence_Group, THE Equivalence_Engine SHALL stop shrinking that group and report the smallest failing Input_Vector found so far as its Shrunk_Example, with a flag on that Shrunk_Example indicating that the limit was reached.
8. THE Equivalence_Engine SHALL count Oracle calls made during shrinking separately from casesRun, SHALL report the count per Evidence_Group, and SHALL exclude them from the Match_Score, mismatchCount and the Evidence_Group case counts.
9. THE Equivalence_Engine SHALL finish all Test_Cases of the run before shrinking any Evidence_Group, so that the Match_Score and mismatchCount reflect all Conclusive_Cases.
10. WHEN a Mismatch has been found, THE Equivalence_Engine SHALL produce zero Shrunk_Examples for any Evidence_Group that contains no Mismatch, so that the shrunkExamples collection holds at most four entries.
11. WHEN the AbortSignal is aborted during shrinking, THE Equivalence_Engine SHALL stop shrinking, report the smallest failing Input_Vector found so far for the group in progress, skip shrinking for the remaining groups, and release all handles before returning.

### Requirement 9: Configuration, budget and reproducibility

**User Story:** As a developer, I want configurable and reproducible runs, so that failures can be replayed and runs fit in a UI session.

#### Acceptance Criteria

1. THE Equivalence_Engine SHALL accept a Case_Count as a positive integer from 1 to 100,000, with a default of 1000 when none is supplied.
2. THE Equivalence_Engine SHALL accept a Seed as a 32-bit integer from -2,147,483,648 to 2,147,483,647.
3. WHERE no Seed is supplied, THE Equivalence_Engine SHALL choose a Seed and return it in the Equivalence_Report.
4. THE Equivalence_Engine SHALL accept a Time_Budget as a positive integer number of milliseconds from 1 to 3,600,000, with no Time_Budget applied when none is supplied.
5. WHEN the Time_Budget elapses before the Case_Count is reached, THE Equivalence_Engine SHALL stop starting new Test_Cases, finish the Test_Case in progress, set the budget flag in the Equivalence_Report, and report in casesRun the number of Test_Cases actually completed.
6. WHEN the same COBOL source, Field_Descriptors, Candidate, Seed and Case_Count are supplied and neither the Time_Budget nor an abort is reached, THE Equivalence_Engine SHALL produce Equivalence_Reports with identical matchScore, casesRun, mismatchCount, mismatches, Mismatch_List_Truncated, shrunkExamples, Evidence_Group counts and Inconclusive_Cases.
7. FOR ALL Seeds, running the Equivalence_Engine twice with the same Seed and configuration SHALL produce identical sequences of Input_Vectors, compared element by element in order (determinism property).
8. IF Case_Count is not an integer from 1 to 100,000, THEN THE Equivalence_Engine SHALL reject the run with an error message identifying Case_Count and the permitted range, before invoking the Oracle, and SHALL NOT produce an Equivalence_Report.
9. IF Time_Budget is supplied and is not an integer from 1 to 3,600,000, THEN THE Equivalence_Engine SHALL reject the run with an error message identifying Time_Budget and the permitted range, before invoking the Oracle, and SHALL NOT produce an Equivalence_Report.
10. IF Seed is supplied and is not a 32-bit integer, THEN THE Equivalence_Engine SHALL reject the run with an error message identifying Seed and the permitted range, before invoking the Oracle, and SHALL NOT produce an Equivalence_Report.
11. THE Equivalence_Engine SHALL pass the per-call Oracle timeout to `runCompiled` as a configurable value in milliseconds, and WHERE no timeout is supplied, THE Equivalence_Engine SHALL pass the Oracle default timeout.
12. WHERE an AbortSignal is supplied, WHEN the signal is aborted, THE Equivalence_Engine SHALL stop starting new Test_Cases, release all handles before returning, and return an Equivalence_Report with the abort flag set and casesRun equal to the number of Test_Cases completed.
13. IF an AbortSignal is already aborted when the run starts, THEN THE Equivalence_Engine SHALL run zero Test_Cases, invoke the Oracle zero times, and return an Equivalence_Report with the abort flag set and casesRun equal to 0.
14. THE Equivalence_Engine SHALL accept a Mismatch_List_Cap as a positive integer from 1 to 10,000, with a default of 25 when none is supplied.
15. IF Mismatch_List_Cap is supplied and is not an integer from 1 to 10,000, THEN THE Equivalence_Engine SHALL reject the run with an error message identifying Mismatch_List_Cap and the permitted range, before invoking the Oracle, and SHALL NOT produce an Equivalence_Report.

### Requirement 10: Progress reporting

**User Story:** As a UI developer, I want progress events, so that The Ritual can animate while tests run.

#### Acceptance Criteria

1. WHEN each Test_Case finishes, THE Equivalence_Engine SHALL invoke the Progress_Callback exactly once with a payload containing: the number of Test_Cases completed (integer, 1 to Case_Count), the target Case_Count (positive integer), the current Evidence_Group (the group of the Test_Case that just finished), the running Matched_Case count, the running Mismatch count, and the running Inconclusive_Case count (each an integer from 0 to the completed count).
2. THE Equivalence_Engine SHALL invoke the Progress_Callback with a completed count that starts at 1 for the first invocation and increases by exactly one between successive invocations, so that the final invocation reports a completed count equal to the number of Test_Cases that finished.
3. THE Equivalence_Engine SHALL ensure that, in every Progress_Callback payload, the running Matched_Case count plus the running Mismatch count plus the running Inconclusive_Case count equals the completed count.
4. THE Equivalence_Engine SHALL omit any running match score from Progress_Callback payloads.
5. IF the Progress_Callback throws an exception or returns a rejected promise, THEN THE Equivalence_Engine SHALL discard the error, SHALL NOT alter any Test_Case result or count, and SHALL continue the run with the next Test_Case and invoke the Progress_Callback again for it.
6. WHERE no Progress_Callback is supplied, THE Equivalence_Engine SHALL complete the run with the same results as a run with a Progress_Callback and SHALL NOT raise an error.

### Requirement 11: Verification with sample candidates

**User Story:** As a developer, I want a correct and a naive candidate for interest, so that the engine is shown to accept faithful translations and catch unfaithful ones.

#### Acceptance Criteria

1. THE Equivalence_Engine test suite SHALL include a correct decimal.js Candidate for `cobol-samples/interest.cbl` that applies ROUNDED half away from zero to scale 2 at every year, drops high-order digits beyond 7 integer digits (the result is taken modulo 10^7), and formats output as the literal text `BALANCE: ` followed by a `Z(6)9.99` value (7 integer positions with leading zeros replaced by spaces, except the last integer digit, and exactly 2 decimals).
2. THE Equivalence_Engine test suite SHALL include a naive floating-point Candidate for `cobol-samples/interest.cbl` that uses JavaScript numbers, does not round at each year, and does not drop high-order digits on overflow.
3. WHEN the Equivalence_Engine runs the correct Candidate against the real Oracle with the default Case_Count, THE Equivalence_Report SHALL have a matchScore equal to 1 and an empty mismatches list.
4. WHEN the Equivalence_Engine runs the naive Candidate against the real Oracle with the default Case_Count, THE Equivalence_Report SHALL contain a mismatchCount of at least 1, a matchScore less than 1 and greater than or equal to 0, and exactly 1 Shrunk_Example for each Evidence_Group that contains at least one Mismatch (and none for the other groups), where each Shrunk_Example contains the input vector, the Oracle output and the Candidate output.
5. THE Equivalence_Engine test suite SHALL include a property test, run with at least 20 distinct Seeds, that two runs with the same Seed and the same Candidate produce deeply equal Equivalence_Reports, excluding the elapsed duration field.
6. THE Equivalence_Engine test suite SHALL include unit tests, using a fake Oracle, with one test per scenario for each of: inconclusive exclusion (inconclusive cases are excluded from the matchScore denominator), handle release on Candidate failure (exactly 1 release call per acquired handle), handle release on Oracle error (exactly 1 release call per acquired handle), compile-error result (report indicates `oracle_unavailable` and contains no matchScore), empty-conclusive outcome (zero conclusive cases yields a report with no matchScore), and Time_Budget stop (the run ends within the Time_Budget plus 1000 ms and the report indicates the stop reason).
7. THE Equivalence_Engine test suite SHALL include property tests, each run for at least 100 generated cases, for generator bounds (unsigned fields are non-negative except in Negative_Unsigned_Vectors, which number at least 1 and at most 10 percent of the vectors per unsigned field in sets of at least 100 vectors, the input vector length equals the field count, and every value parses as decimal text) and for the group-count invariants in Requirement 4 and Requirement 7.
8. WHERE the Oracle is available in the test environment, THE Equivalence_Engine test suite SHALL run the interest comparisons against the real Oracle; WHERE the Oracle is unavailable, THE test suite SHALL mark those tests as skipped, report them as skipped in the test runner output, and not report them as passed or failed.

### Requirement 12: Module boundaries and code quality

**User Story:** As a maintainer, I want the engine independent of other modules, so that each can be tested alone.

#### Acceptance Criteria

1. THE Equivalence_Engine SHALL import from `src/oracle` only through its public index (`compileCobol`, `runCompiled`, `releaseHandle`, `isCompiledHandle` and the exported types), such that 0 import statements in `src/equivalence` reference any other file path under `src/oracle`.
2. THE Equivalence_Engine SHALL accept the Oracle functions (`compileCobol`, `runCompiled`, `releaseHandle`, `isCompiledHandle`) through an injectable interface, with the real `src/oracle` functions as the default used when the caller supplies no override.
3. WHEN a caller supplies an injected Oracle implementation to the run function, THE Equivalence_Engine SHALL invoke only the injected functions and SHALL make 0 calls to the real `src/oracle` functions during that run.
4. THE Equivalence_Engine SHALL contain 0 import statements referencing `src/analyzer`, `src/translator` or `src/app`, including via relative paths or path aliases.
5. THE Equivalence_Engine SHALL compile under TypeScript strict mode with 0 compiler errors and 0 occurrences of the `any` type (explicit or via `as any`) in `src/equivalence`.
6. THE Equivalence_Engine SHALL expose a single public entry point at `src/equivalence/index.ts` that exports the run function, the Field_Descriptor type, the Equivalence_Report type, the Progress_Callback type, and the sample Field_Descriptors (INTEREST, PAYROLL and TAX).
9. THE Equivalence_Engine test suite SHALL include unit tests, using a fake Oracle, with one test per scenario for each of: an asynchronous Candidate that resolves (output compared after awaiting), an asynchronous Candidate that rejects (counted as a Mismatch with the rejection message as Candidate output, and exactly 1 release call per acquired handle), and a mismatch list cap smaller than mismatchCount (the mismatches list length equals the cap, mismatchCount is exact, and Mismatch_List_Truncated is true).
10. THE Equivalence_Engine test suite SHALL include a unit test, using a fake Oracle and a Candidate that mismatches in at least two Evidence_Groups, verifying that the report contains exactly 1 Shrunk_Example per mismatching Evidence_Group and that shrinking Oracle calls do not change casesRun.

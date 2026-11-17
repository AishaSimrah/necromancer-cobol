# Translation scores (sample-catalog)

Measured against the real GnuCOBOL Oracle by `npx vitest --run tests/translator/oracle.test.ts` (one Standard_Run per translation, from `tests/translator/oracle.test.ts`).

- Run date: 2026-11-17 (system date on the machine that reran the test). The same table was first recorded in `docs/kiro-log.md` during task 14.2; the rerun on this date gave identical numbers. 21 tests passed, duration about 77 s.
- Settings: 1000 cases, seed 1.
- Oracle: GnuCOBOL 3.1.2.0 (`cobc`) in the Docker image (Docker 29.9.2).
- Groups, in the order of the columns: overflow = field overflow behavior, half-unit = half-unit rounding boundary, zero+max = zero and maximum boundaries, standard = standard computation. Each cell is matched/conclusive.

| Sample | Variant | matchScore | mismatchCount | overflow | half-unit | zero+max | standard | Cases | Seed | GnuCOBOL | Date |
|---|---|---|---|---|---|---|---|---|---|---|---|
| interest | correct | 1.000 | 0 | 200/200 | 199/199 | 300/300 | 301/301 | 1000 | 1 | 3.1.2.0 | 2026-11-17 |
| interest | subtle | 0.958 | 42 | 158/200 | 199/199 | 300/300 | 301/301 | 1000 | 1 | 3.1.2.0 | 2026-11-17 |
| interest | naive | 0.132 | 868 | 1/200 | 8/199 | 114/300 | 9/301 | 1000 | 1 | 3.1.2.0 | 2026-11-17 |
| payroll | correct | 1.000 | 0 | 200/200 | 199/199 | 300/300 | 301/301 | 1000 | 1 | 3.1.2.0 | 2026-11-17 |
| payroll | subtle | 0.933 | 67 | 133/200 | 199/199 | 300/300 | 301/301 | 1000 | 1 | 3.1.2.0 | 2026-11-17 |
| payroll | naive | 0.195 | 805 | 0/200 | 6/199 | 165/300 | 24/301 | 1000 | 1 | 3.1.2.0 | 2026-11-17 |
| tax | correct | 1.000 | 0 | 200/200 | 199/199 | 300/300 | 301/301 | 1000 | 1 | 3.1.2.0 | 2026-11-17 |
| tax | subtle | 0.948 | 52 | 148/200 | 199/199 | 300/300 | 301/301 | 1000 | 1 | 3.1.2.0 | 2026-11-17 |
| tax | naive | 0.260 | 740 | 15/200 | 40/199 | 152/300 | 53/301 | 1000 | 1 | 3.1.2.0 | 2026-11-17 |

Every row has 1000 conclusive cases and 0 inconclusive (the groups sum to 1000). `mismatchCount` equals 1000 minus the matched total.

Reading the table: the three `subtle` scores are inside the 0.90 to 0.995 target and below 1, and `naive < subtle < 1` holds for every sample. All three `subtle` variants mismatch only in the overflow group. See "Spec 2: sample-catalog" in `docs/kiro-log.md` for the forgotten trap chosen per sample.

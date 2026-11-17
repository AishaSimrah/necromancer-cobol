# Repo structure

```
/.kiro/            steering, specs, hooks  (MUST be committed, never gitignored)
/cobol-samples/    original COBOL programs + known-good outputs
/scripts/          helper scripts (run-samples.sh)
/docs/             kiro-log.md, SCHEDULE.md, KIRO_PROMPTS.md, write-up drafts
/src/analyzer/     extracts inputs, outputs, rules, traps from COBOL
/src/translator/   COBOL -> TypeScript translations: pre-generated samples, catalog and read-only API
The translation .ts files and cobol-samples/*.cbl are read at runtime (the UI shows their source), so any deployed image must copy src/translator/translations/ and cobol-samples/.
/src/oracle/       compiles and runs COBOL via cobc, returns stdout
/src/equivalence/  input generators, comparison, match score (fast-check)
/src/app/          UI (Next.js)
/tests/            unit and property tests
/tests/translator/ catalog unit tests, property tests, and real-Oracle verification
```

Keep the oracle, translator and equivalence engine independent so each can be tested alone.

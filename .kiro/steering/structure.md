# Repo structure

```
/.kiro/            steering, specs, hooks  (MUST be committed, never gitignored)
/cobol-samples/    original COBOL programs + known-good outputs
/scripts/          helper scripts (run-samples.sh)
/docs/             kiro-log.md, SCHEDULE.md, KIRO_PROMPTS.md, write-up drafts
/src/analyzer/     extracts inputs, outputs, rules, traps from COBOL
/src/translator/   COBOL -> TypeScript generation
/src/oracle/       compiles and runs COBOL via cobc, returns stdout
/src/equivalence/  input generators, comparison, match score (fast-check)
/src/app/          UI (Next.js)
/tests/            unit and property tests
```

Keep the oracle, translator and equivalence engine independent so each can be tested alone.

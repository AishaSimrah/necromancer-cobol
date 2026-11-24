# Kiro usage log

The submission requires a write-up of how Kiro was used. Fill this in at the end of every work session (5 minutes). Screenshots go in `docs/screens/`.

## Write-up checklist (judges look for each of these)
- [ ] Kiro IDE vs CLI vs Web vs Crew: which I tried, how they differed
- [ ] Custom agents: what I created, effect on the build
- [ ] Agent hooks: which workflows I automated, how it helped
- [ ] Spec-driven development: how I structured specs, comparison with vibe coding
- [ ] Steering docs: which strategy made the biggest difference
- [ ] MCP: what it enabled that would have been hard otherwise
- [ ] Property-based testing: bugs it caught that unit tests missed
- [ ] Powers: which I used, any third-party tooling

## Session log
Format: date | hours | what I did in Kiro | what worked | what failed | screenshot?

| Date | Hrs | Done | Worked | Failed / surprised | Screenshot |
|---|---|---|---|---|---|
| 2026-11-07 | 2.5 | Spec 1 (COBOL oracle runner) in Kiro: requirements, design, tasks. Used spec mode with Autopilot off, reviewed each phase, used "Analyze requirements". Credits used so far: ~20 of 4000 | Kiro read the steering docs and repo samples; its own requirements analysis caught an ambiguity (13.10: detection rules must apply to any one construct, not only all three) | First draft missed a performance gap (container per run) and security gaps (secrets in environment, no sandbox in direct mode); first design used docker exec per run, which I measured at 143 ms per call and could not meet the 3000 runs in 60 s target, so the design was replaced with a long-lived Worker | |


## Best "before / after" moments (save for the write-up)
1. Before: container started for every run (about 7 minutes for 3000 runs). After: measured docker exec at 143 ms per call, then redesigned around a long-lived Worker with a 10 ms overhead budget and a spike task as a gate.
2. Before: requirements covered only the happy path. After: reviewing them found missing security rules (clean environment, unprivileged user, no external CALL, no file I/O or COPY) which Kiro then added.
3. Before: tasks started with the hardest infrastructure. After: reordered into a minimal working path first, then hardening, then verification, so the equivalence engine can start early.

## Bugs caught by property-based testing (very important)
| Input that failed | COBOL output | TS output | Root cause | Fix |
|---|---|---|---|---|
| | | | | |

## Spec vs vibe coding comparison
Pick one small task. Do it once by vibe coding and once from a spec. Record time, bugs, and quality.

## Spike 1.2: Worker overhead (PASS)
Image: ubuntu:24.04 + gnucobol, Node 22.11.0 from node:22.11.0-bookworm-slim, Docker 29.9.2. 500 sequential runs after 20 warmup, spawn with uid/gid 20000, detached, fixed env.

| Measurement | mean (ms) | p95 (ms) |
|---|---|---|
| (a) frame round trip only | 0.359 | 0.640 |
| (b) prlimit + program (worker-side) | 6.159 | 9.255 |
| (b') same incl. frame round trip (client) | 6.641 | 9.774 |
| (c) program without prlimit (worker-side) | 5.085 | 7.641 |

Worker overhead = (b - c) + a = 1.434 ms, limit 10 ms. PASS, so the C helper fallback is not needed. Phase A may start.
## Task 2.8: Oracle image Dockerfile
Multi-stage build. Stage 1 base pinned: `node:22.11.0-bookworm-slim@sha256:f035ba7ffee18f67200e2eb8018e0f13c954ec16338f264940f701997e3c12da` (Docker 29.9.2). Stage 2: ubuntu:24.04 + gnucobol + libstdc++6, node binary and `dist/worker.js` (0555) at `/opt/oracle/worker.js`, group `oracle-run` / user `oracle` (20000), `NECROMANCER_IN_ORACLE_IMAGE=1`, `USER root`. Verified: `cobc --version` = 3.1.2.0; a framed `ping` to `node /opt/oracle/worker.js` returns a `pong`.

## Spec 2: sample-catalog (tasks 1 to 13, entry written at task 14.2)
Spec in `.kiro/specs/sample-catalog/` (requirements, design, tasks), built with the same spec flow as spec 1. It adds `src/translator/`: the nine pre-generated translations (INTEREST, PAYROLL, TAX, each as `correct`, `naive`, `subtle`), a read-only catalog API, a COBOL runtime library on decimal.js, and `tests/translator/`. Nothing in `src/equivalence/`, `src/oracle/` or `tests/equivalence/` was changed. Every translation is scored against the real GnuCOBOL Oracle in `tests/translator/oracle.test.ts` (1000 cases, seed 1, one Standard_Run per translation).

### Spec-driven steps
1. Requirements: `.kiro/specs/sample-catalog/requirements.md` (commit `a43bd41`, "Spec 2: sample catalog and translations"). Defines the catalog API, the three variants, the curse markers, the 0.90 to 0.995 rule for `subtle`, the `naive < subtle < 1` ordering and the Oracle test (Req 10).
2. Design: `design.md` (same commit). Key choices: translation modules export only `candidate` and `provenance` and the catalog reads the file for `source`; a shared `cobol-runtime.ts` on decimal.js; static data separate from the `fs` module; one `oracle.test.ts` with one Standard_Run per translation.
3. Tasks: `tasks.md` (same commit). A thin slice first (INTEREST `correct`, catalog API, real-Oracle test, checkpoint at task 7), then the other eight translations, with "STOP and ask" gates when no `subtle` trap lands in range.
4. Execution: one commit per task or task group, `1.1` to `13` (`df61c6e` to `b34f418`). Task 14.1 updated `structure.md`; this entry is task 14.2. Task 14.3 (final verification report) is still open.

### Measurements
All nine scores, mismatch counts and per-group counts are in `docs/translation-scores.md`. That file comes from a rerun of `npx vitest --run tests/translator/oracle.test.ts` on 2026-11-17 and matches the table below.

### Property tests
`tests/translator/translations.property.test.ts` (task 11, commit `87081ed`; fast-check, 200 runs, fixed seed). Per sample it checks that `correct` never throws and returns the expected output shape, that it is deterministic, and that `subtle` equals `correct` on a safe domain that cannot trigger the one forgotten trap. A fixed witness per sample shows that `subtle` differs from `correct` inside its trap, and another that `naive` differs from `correct`. `tests/translator/interest-copies.test.ts` (task 8.4) compares the INTEREST `correct` and `naive` files with the originals in `tests/equivalence/candidates/interest.ts` on 200 fixed vectors. The log does not record a bug that these property tests found; no such entry is made here.

### Review catches that became tasks
Both catches changed the spec before or while the code was written. The repo shows the changes, not who found them or how, so the "how found" is not recorded.
- Shared-descriptor freeze (task 1.2, commit `590dac5`). The first draft of the design and Req 4 (item 4) had `SAMPLE_DATA.fields` point at the exported `INTEREST`, `PAYROLL`, `TAX` arrays from `src/equivalence/descriptors.ts`, while the data is deep-frozen (Req 9.5). That would have frozen the equivalence engine's own descriptors as a side effect of importing the catalog. The spec was changed to use copies (`copyFields`), freeze only the copies, and test that the originals are not frozen and are `toEqual` but not `toBe` the copies (tasks 1.2 and 1.4, `tests/translator/sample-data.test.ts`). No later change under `src/equivalence/` was needed.
- Misleading curse markers. Three tasks came from markers that named a curse the code did not match:
  - Task 9.5 (commit `623b409`): `payroll.subtle.ts` carried `CURSE:payroll-overtime` on the line that stores `hours` in a field one digit too wide. The new curse `payroll-hours-pic` was added (eleven curses, lines 13 and 27 of `payroll.cbl`) and the marker and comment were rewritten. Behavior and the 0.933 score did not change.
  - Task 10.4 (commit `ffe07d9`): the same fix for TAX with `tax-unsigned-income` (twelve curses, lines 12 and 18 of `tax.cbl`). The header of `tax.subtle.ts` had to name the real forgotten trap (negative income keeps its sign) and not describe the rejected trap 1 (no `mod 10^8`, 0.873).
  - Task 10.5 (same commit): comment-only cleanup that removed `CURSE:tax-whole-unit-rounding` from the `income` line in `tax.correct.ts` and `tax.naive.ts`.

  The earlier INTEREST markers were not part of these changes. Whether a reviewer or a test failure first noticed the markers is not in the repo.

### Real-Oracle verification
`tests/translator/oracle.test.ts` runs every translation through `runEquivalence` against the real GnuCOBOL 3.1.2.0 Oracle in Docker (no mock, no `skip`), plus the eight example pairs from `cobol-samples/EXPECTED.md` against both the Oracle and the candidate. It was rerun on 2026-11-17: 21 passed in about 77 s, scores identical to the table below.

### Forgotten trap per `subtle` sample (Req 7.3)
Each `subtle` file is the `correct` file with exactly one trap removed. The target range is 0.90 to 0.995 and the hard rule is `naive < subtle < 1`. The first trap in range is kept.

| Sample | Trap kept | Score | Mismatches | Why this one |
|---|---|---|---|---|
| interest | `interest-years-pic99`: `years` stored in a 4-digit field, no `mod 100` | 0.958 | 42 | Trap 2 of 3 in the task order; the score is inside the target range, which is the selection rule. Why interest trap 1 (no `wrap` on the balance) was not kept is not recorded (see below). |
| payroll | `payroll-hours-pic`: hours stored as `9(4)V9` instead of `9(3)V9`, no `mod 1000` | 0.933 | 67 | Trap 2 of 3 in the task order; the score is inside the target range. Why payroll trap 1 was not kept is not recorded (see below). |
| tax | `tax-unsigned-income`: a negative income keeps its sign instead of becoming its absolute value | 0.948 | 52 | Trap 2 of 3. Trap 1 scored 0.873, below the range. |

Scores of every trap tried:
- tax trap 1 (no `mod 10^8` on income): 0.873, rejected, below 0.90 (figure from the task 10.4 note in tasks.md).
- tax trap 2 (no absolute value of negative income): 0.948, kept. Confirmed in the Oracle run below.
- payroll trap 2 (hours without `mod 1000`, the one finally kept as `payroll-hours-pic`): 0.933. Confirmed in the Oracle run below. The earlier task 9.5 cleanup moved the marker from `payroll-overtime` to the new `payroll-hours-pic` curse without changing the score.
- NOT VERIFIED: the scores of interest traps tried before `interest-years-pic99`, and of payroll trap 1 (no `wrap` on `regPay`, `otPay`, `gross`). The task list orders interest trap 1 (no `wrap` on the yearly balance) before `years`, but the commits and notes in the repo do not record its score, so no figure is given. The same applies to payroll trap 1 and to tax trap 3, which was not needed because trap 2 was in range. The per-trap measurements were not saved.

### Oracle test score table (real run in task 14.2, `npx vitest --run tests/translator/oracle.test.ts`)
| Translation | matchScore | mismatchCount | Groups matched / conclusive (overflow, half-unit, zero+max, standard) |
|---|---|---|---|
| interest/correct | 1 | 0 | 200/200, 199/199, 300/300, 301/301 |
| interest/naive | 0.132 | 868 | 1/200, 8/199, 114/300, 9/301 |
| interest/subtle | 0.958 | 42 | 158/200, 199/199, 300/300, 301/301 |
| payroll/correct | 1 | 0 | 200/200, 199/199, 300/300, 301/301 |
| payroll/naive | 0.195 | 805 | 0/200, 6/199, 165/300, 24/301 |
| payroll/subtle | 0.933 | 67 | 133/200, 199/199, 300/300, 301/301 |
| tax/correct | 1 | 0 | 200/200, 199/199, 300/300, 301/301 |
| tax/naive | 0.26 | 740 | 15/200, 40/199, 152/300, 53/301 |
| tax/subtle | 0.948 | 52 | 148/200, 199/199, 300/300, 301/301 |

Ordering `naive < subtle < 1` holds for all three samples. All three `subtle` scores are inside the 0.90 to 0.995 target. All three `naive` translations mismatch in all four groups (at least two required).

### Elapsed time of the Oracle test (Req 11.6)
21 tests passed. Two runs on the same machine: 76.03 s and 70.58 s (vitest "Duration"; the second run reports 70116 ms for the file). This covers nine 1000-case Standard_Runs plus the eight example-pair checks.

### Changes to `naive` files
- `interest.naive.ts`, `payroll.naive.ts`: none after creation (one commit each, 0.132 and 0.195 met the two-group rule on the first run).
- `tax.naive.ts`: one comment-only change in task 10.5 (`ffe07d9`): the marker on the `income` line went from `CURSE:tax-whole-unit-rounding` to `CURSE:tax-unsigned-income`. No behavior change; the score stayed 0.26.
- No naive file was made worse to meet the two-group rule, so the INTEREST copy-equivalence test keeps both halves (`correct` and `naive`).

## Spec 3: necromancer-server (task 13.3): deployment and app image

### Render settings
- Service type: Web Service, runtime Docker, plan Free. Dockerfile path `Dockerfile.app`, build context the repo root.
- Port: 10000 (`PORT` default and `EXPOSE 10000`). Health check path: `/api/health` (always answers 200; the body says `ok` or `degraded`).
- One container holds the server, the Worker and GnuCOBOL. Runs as uid 10001.

### Environment variables
| Variable | Default | Rule |
|---|---|---|
| `PORT` | 10000 | 1..65535 |
| `NECROMANCER_DEFAULT_CASE_COUNT` | 1000 | 100 up to the maximum |
| `NECROMANCER_MAX_CASE_COUNT` | 2000 | up to 100000 |
| `NECROMANCER_TIME_BUDGET_MS` | 60000 | 1000..3600000 |
| `NECROMANCER_WORK_ROOT` | `$HOME/work` (`/home/necro/work`) | absolute path, must allow executing files |

An invalid value stops the server at startup with a message that names the variable.

### Build and run
```
docker build -f Dockerfile.app -t necromancer-app .
docker run -d --name necromancer -p 10000:10000 --tmpfs /tmp necromancer-app
curl http://localhost:10000/api/health?probe=1
docker rm -f necromancer
```
`--tmpfs /tmp` is the recommended way to run it. A fully locked-down run also works: `--read-only --tmpfs /tmp --tmpfs /home/necro/work:rw,exec,nosuid,uid=10001,gid=10001,mode=0700,size=128m`. The work directory must not be mounted `noexec`; if it is, health stays `degraded` and the log names the path. `scripts/check-app-image.sh` runs these configurations (it needs a real bash; on this Windows host bash is the WSL stub, so the checks below were run by hand in PowerShell).

### Measurements (Windows host, Docker Engine 29.9.2, Docker Desktop, 3.718 GiB visible to containers)
| Figure | Value |
|---|---|
| Image size | 630,770,691 bytes (about 631 MB); build about 76 s with a warm layer cache (about 85 s on the first build) |
| GnuCOBOL | `cobc` 3.1.2.0, reported in `/api/health` |
| Startup | first `/api/health` answered 0.85 s to 1.3 s after `docker run -d` (server `uptimeMs` 266 to 451 ms); one cold Docker Desktop start took 3.4 to 3.7 s, of which the server needed under 0.7 s |
| First health body | `degraded` / `unavailable` until the first probe finishes; `ok` / `ready` about 0.5 s later (`uptimeMs` 881 to 901) |
| Idle memory (`docker stats --no-stream`, about 3 s after the probe) | 27 to 40 MiB: 40.0 default Work_Root, 34.9 `--tmpfs /tmp`, 27.8 read-only; 27.3 to 31.4 on the 2000-case reruns |
| Memory during a 2000-case run (`caseCount` 2000, sample `interest`, variant `correct`, `--tmpfs /tmp`) | peak sampled 73.8 MiB in the first run and 68.6 MiB in the second (9 to 11 samples, one per 200 ms or more); back to 50 to 57 MiB after the run |
| Result of that run | `matchScore` 1, `complete` true, 2000 of 2000 cases run, 0 mismatches |

Memory is far below the 512 MB limit of the Render free plan. The peak figure comes from sampling `docker stats`, so a shorter spike could be missed.

Other image checks (all passed):
- `GET /api/samples/interest` returns `cobolSource` (1201 characters) and three non-empty translations (`correct` 1016, `subtle` 1153, `naive` 844), so the catalog paths resolve from `/app/dist/server/server.js`.
- `docker top` shows `node dist/server/server.js` and its child Worker `node /opt/oracle/worker.js --work-root /home/necro/work`, both uid 10001.
- `--tmpfs /tmp:rw,noexec` with `NECROMANCER_WORK_ROOT=/tmp/work`: health is `degraded` even after `?probe=1`, the log has `work root /tmp/work does not allow executing files (noexec mount?)`, and the server keeps listening.

### Trust boundary (Req 10.9)
The server relies on no user-provided COBOL ever reaching the Phase A Oracle. `POST /api/prove` accepts only a catalog `sampleId`, a `variant`, `caseCount` and `seed`. The COBOL compiled is always `getSample(sampleId).cobolSource` and the candidate is always the catalog's. Phase A has no per-program user separation, no `prlimit` and no network isolation: the Worker runs as the same uid as the server, in the same container, with the container's network. Accepting uploaded COBOL would need all three first. Static `public/` and the JSON catalog routes are the only other surface.

The earlier scratch file `docs/app-image-observations.md` was folded into this entry and removed.

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

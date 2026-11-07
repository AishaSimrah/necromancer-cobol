# Implementation Plan: COBOL Oracle Runner

## Overview

Implementation language: TypeScript (strict mode, no `any`), Vitest and fast-check, as set by the workspace tech rules and the design. The plan is ordered in three phases so that the equivalence engine can start using the oracle as early as possible.

- **Phase A (tasks 1 to 3): minimal working path.** A scaffold and the Worker performance spike (a gate on mean overhead under 10 ms), then a vertical slice: public types and config, capture helpers, framing and protocol, a minimal Worker (compile and run through `spawn`, timeout, output cap, handle directories; no per-program uid, no `prlimit`, no source scans), the Dockerfile, minimal launchers and `WorkerClient`, and a minimal public API (`runCobol`, `compileCobol`, `runCompiled`, `releaseHandle`, `shutdown`) with basic validation and basic classification. Checkpoint 3 runs the three samples through compile once, run many against `cobol-samples/EXPECTED.md`. From that checkpoint the equivalence engine can integrate. The public signatures in `src/oracle/types.ts` and `src/oracle/index.ts` are stable and MUST NOT change in Phases B and C.
- **Phase B (tasks 4 to 7): hardening.** Source scans, per-program slot uid and gid with scratch directories, `prlimit` wrapping and `resource_limit` classification, the fixed environment allowlist, network isolation and Docker flags, version check caching and gating, Worker-lost recovery and the full handle lifecycle. Every Phase B task extends the Phase A code in the named file. It does not replace it, and it does not change public signatures.
- **Phase C (tasks 8 to 10): verification.** The remaining property tests, unit tests, real-image sandbox and resource-limit tests, determinism properties 21 and 22, the 1000-run performance test, and the final checkpoint with the sample equivalence suite.

Code lives in `src/oracle/` (Worker code in `src/oracle/worker/`). Tests live in `tests/oracle/`. Where a Phase A task is deliberately minimal, it names the later task that hardens it. Pure modules and test doubles come early so that Worker and client logic can be tested without Docker.

## Tasks

- [x] 1. Phase A: Scaffold and performance spike
  - [x] 1.1 Scaffold the TypeScript project
    - Create `package.json` with exact, pinned versions of `typescript`, `vitest`, `fast-check`, `esbuild`, `eslint`, `@typescript-eslint/*`, `@types/node`
    - Create `tsconfig.json` with `"strict": true`, and an ESLint config with `@typescript-eslint/no-explicit-any` set to error
    - Add scripts: `build:worker` (esbuild bundle of `src/oracle/worker/main.ts` to `dist/worker.js`), `typecheck` (`tsc --noEmit`), `lint`, `test` (`vitest --run`)
    - Create `src/oracle/` and `tests/oracle/` directories with a Vitest config
    - _Requirements: 8.5_
  - [x] 1.2 Write and run the spike script
    - Add `scripts/spike-worker.mjs` and a throwaway `scripts/Dockerfile.spike` (Ubuntu 24.04, `gnucobol`, `libstdc++6`, Node copied from the pinned `node:22.11.0-bookworm-slim` image) that are not part of the final image
    - In the image, run a minimal framed-stdio echo Worker that spawns `prlimit --as --cpu --nproc --fsize --core -- <compiled interest>` with `uid`, `gid`, `detached` and a fixed `env`
    - Measure mean and 95th percentile over at least 500 sequential runs for: (a) frame round trip only, (b) spawn of `prlimit` plus the program, (c) the program spawned without `prlimit`
    - Exit non-zero when the mean Worker overhead (b minus the program's own run time) is 10 ms or more, and print the numbers
    - If the check fails, record the numbers in `docs/kiro-log.md` and stop; the fallback in the design is a small C helper that calls `setrlimit` and `execve`
    - This gate covers the full Phase B cost (uid switch and `prlimit`) even though Phase A does not use them; Phase A must not start before it passes
    - _Requirements: 11.4, 11.12, 12.4_

- [x] 2. Phase A: Minimal vertical slice
  - [x] 2.1 Define public types and configuration
    - Create `src/oracle/types.ts` with `Status`, `RunRequest`, `RunResult`, `CompiledHandle` (branded) and `isCompiledHandle`; these signatures are final and MUST NOT change in Phases B and C
    - Create `src/oracle/config.ts` with `OracleConfig`, `ResourceLimits`, `SandboxPolicy` and the full default values from the design (65536 bytes, 30 s, 5 s, 60 s, 1 MiB, `3.1.2`, 8 slots, uid base 20000, run and compile limits, fixed environment allowlist), so later phases only start using fields that already exist
    - Export a `Logger` interface and a `mergeConfig` helper
    - Phase A code reads only the size, timeout, output and image fields; Tasks 5.4 and 5.5 start using the sandbox fields
    - _Requirements: 8.1, 8.3, 8.4, 8.5, 7.8, 12.1, 12.4_
  - [x] 2.2 Implement output capture helpers
    - Create `src/oracle/capture.ts` with `appendCapped`, `decodeUtf8` (`TextDecoder` with `ignoreBOM: true`) and `encodeStdin`
    - _Requirements: 1.5, 1.7, 1.8, 5.3, 5.4_
  - [ ]* 2.3 Write property tests for capture helpers
    - **Property 8: Stdin encoding**
    - **Property 9: UTF-8 decoding preserves content**
    - **Property 10: Output capture is bounded**
    - Tag each test `Feature: cobol-oracle-runner, Property N: <title>`; at least 100 runs
    - **Validates: Requirements 1.5, 1.7, 1.8, 5.3, 5.4**
  - [x] 2.4 Implement framing and the Worker protocol types
    - Create `src/oracle/protocol.ts` with `WorkerRequest`, `WorkerResponse`, `RawOutcomeFields`, `EndedBy`, `BreachedLimit`, `WorkerMessage`; define the complete protocol now (including `ping` with `withVersion` and the `limit` outcome fields) so the Worker and client can be hardened later without a protocol change
    - Create `src/oracle/framing.ts` with `encodeFrame`, incremental `FrameDecoder`, `MAX_FRAME_BYTES` (8 MiB) and protocol errors for oversized prefixes and invalid JSON
    - _Requirements: 11.3, 11.5_
  - [ ]* 2.5 Write property test for framing
    - **Property 17: Frame round trip**
    - Use generators `arbWorkerMessage` and `arbChunking` (one byte at a time, several frames per chunk)
    - **Validates: Requirements 11.3, 11.5, 11.12**
  - [x] 2.6 Implement the minimal child spawner, work filesystem and test double
    - Create `src/oracle/worker/spawner.ts` with `SpawnSpec`, `ChildTermination`, `ChildSpawner` and a real implementation using `child_process.spawn` (`detached`, piped stdio)
    - Phase A scope: swallow `EPIPE` on stdin, cap each stream with `appendCapped`, enforce the timeout and the output cap by killing the process group, and wait for `close`. No `uid`, `gid`, `env` allowlist or `kill -9 -1` sweep yet; Task 5.4 extends this file with them
    - Create `src/oracle/worker/workfs.ts` with a `WorkFs` interface and real implementation: `mkdtemp` handle directories, write `prog.cob`, recursive removal that logs failures and does not throw. Task 5.1 extends this file with ownership and modes
    - Create `tests/oracle/doubles/fake-spawner.ts` that returns scripted terminations and records every `SpawnSpec`; Task 5.4 extends it to record uid, gid and env
    - _Requirements: 3.1, 3.2, 3.3, 3.6, 5.3, 5.4, 5.5, 6.2, 6.4, 6.5, 6.6_
  - [x] 2.7 Implement the minimal Worker server and entry point
    - Create `src/oracle/worker/server.ts` with transport-agnostic `serve(io, deps)` handling `ping` (reply with pid and `liveHandles`), `compile`, `run`, `release`, `shutdown`
    - Phase A scope: run `cobc -x -free -o prog prog.cob` and `<handle>/prog` directly through the spawner, with the compile timeout, run timeout and output cap; delete the handle directory on compile failure and on `release`; answer `unknown_handle` for unknown handles; run requests one after another or with a simple concurrency counter
    - No slots, no `prlimit`, no per-program uid, no environment allowlist, no `withVersion`; Task 5.5 extends this file with them
    - Create `src/oracle/worker/main.ts` that parses `--policy` (base64 JSON) and `--work-root`, wires stdin and stdout, and logs only to stderr
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 6.2, 6.3, 6.5, 11.2, 11.4, 11.5, 11.8_
  - [x] 2.8 Write the Oracle image Dockerfile
    - Rewrite `Dockerfile` as a multi-stage build: stage 1 on `node:22.11.0-bookworm-slim` pinned by tag and digest runs `npm ci`, copies the Worker modules and the shared modules the Worker imports (`protocol.ts`, `framing.ts`, `capture.ts`, and `types.ts` or `config.ts` if imported as values) and runs `npm run build:worker`
    - Stage 2 on `ubuntu:24.04` installs `gnucobol` and `libstdc++6` with `--no-install-recommends`, copies the `node` binary and `dist/worker.js` to `/opt/oracle/worker.js` (mode 0555), creates group `oracle-run` and user `oracle` (uid and gid 20000), sets `NECROMANCER_IN_ORACLE_IMAGE=1`, keeps the sample copy and the `interest` compile line, and keeps `USER root`
    - Record the digest used in a comment and in `docs/kiro-log.md`
    - Build the image and confirm `cobc --version` reports 3.1.2 and `node /opt/oracle/worker.js` starts
    - The image is complete for Phase B; Task 5.5 changes only Worker code, not the Dockerfile
    - _Requirements: 7.2, 7.3, 12.3_
  - [x] 2.9 Implement basic validation and basic classification
    - Create `src/oracle/validate.ts` with `validateSource` (size in UTF-8 bytes, empty or whitespace only, NUL), `validateInputLines`, `validateTimeout` and `validateRequest` in the fixed check order of the design, with a placeholder step where the scans will run; Task 4.1 extends this file with the scan checks
    - Create `src/oracle/classify.ts` (runner side) mapping Worker outcomes and phase to `RunResult` for `ok` (non-zero exit codes kept), `compile_error`, `timeout` (naming the compile or run phase), `environment_error` (spawn failure) and the output-limit case (`resource_limit`, `truncated: true`); `message` only when the status is not `ok`
    - The `resource_limit` labels for memory, CPU, processes and file size are added by Task 5.2
    - _Requirements: 3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 1.4, 1.6, 2.1, 2.2, 2.3, 3.3, 8.3, 8.4_
  - [ ]* 2.10 Write property test for RunResult serialization
    - **Property 14: RunResult JSON round trip**
    - Use generator `arbRunResult` including `null` exit codes and optional `message`
    - **Validates: Requirements 8.6**
  - [x] 2.11 Implement the minimal Worker client and launchers
    - Create `src/oracle/worker-client.ts` with `WorkerTransport`, `WorkerLauncher`, `WorkerClient` (lazy launch, `ping` handshake, id-keyed pending map, `WorkerLostError` thrown to all pending requests on EOF, exit or protocol error, `stop`); remove pending entries on response or loss. No `restart` yet; Task 6.3 extends this file
    - Create `src/oracle/launcher.ts` (selection by `NECROMANCER_IN_ORACLE_IMAGE`), `src/oracle/docker-launcher.ts` and `src/oracle/direct-launcher.ts`
    - Phase A scope: the Docker launcher runs `docker run -i --rm --name necromancer-oracle-<random> <image> node /opt/oracle/worker.js --policy <b64>` and rejects with a message naming a missing Docker daemon or image; the direct launcher spawns `node /opt/oracle/worker.js` with the same stdio. Arguments are passed as an array, never through a shell. Task 6.1 adds network isolation, capability, read-only and kill-fallback flags
    - _Requirements: 7.1, 7.5, 7.6, 11.5_
  - [x] 2.12 Implement the minimal handle registry and public API
    - Create `src/oracle/handles.ts` and `src/oracle/index.ts` exporting `runCobol`, `compileCobol`, `runCompiled`, `releaseHandle`, `shutdown`, `isCompiledHandle` with the final signatures from the design
    - Phase A scope: validate before any Worker request; resolve every outcome as a `RunResult` and map internal exceptions and launch failures to `environment_error`; omit `message` when `ok`; `runCobol` compiles, runs and releases in a `finally`; unknown or released handles return `invalid_request` without sending a frame; `shutdown` releases all handles, sends `shutdown` and stops the transport
    - No version check, no Worker restart or retry; Task 6.2 adds the version check and Task 6.4 adds recovery, the `bypassScans` test option and the full lifecycle
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6, 8.1, 8.2, 8.3, 8.4, 11.1, 11.2, 11.3, 11.9, 11.10_
  - [x] 2.13 Write the slice smoke test
    - Create `tests/oracle/slice-smoke.test.ts` that compiles `interest.cbl`, `payroll.cbl` and `tax.cbl` once each through `compileCobol`, runs each handle several times through `runCompiled` with the inputs listed in `cobol-samples/EXPECTED.md`, and compares stdout with the verified values
    - Assert that `runCobol` returns the same stdout as a handle run, that an infinite loop returns `timeout`, and that a syntax error returns `compile_error`
    - Runs against the real Oracle image and calls `shutdown()` in `afterAll`
    - _Requirements: 10.3, 11.2, 11.4_

- [~] 3. Checkpoint - Phase A slice works; the equivalence engine can integrate
  - Run `npm run typecheck`, `npm run lint` and `npm test`; the slice smoke test must pass for all three samples against `cobol-samples/EXPECTED.md` through compile once, run many.
  - State clearly to the user that from this point the equivalence engine can integrate against `runCobol`, `compileCobol`, `runCompiled`, `releaseHandle` and `shutdown`, and that these signatures in `src/oracle/types.ts` and `src/oracle/index.ts` do not change in later phases.
  - State clearly that the slice is not yet safe for untrusted COBOL (no scans, no uid separation, no `prlimit`, no network isolation); Phase B closes those gaps.
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Phase B: Source scans
  - [~] 4.1 Implement source scanning and wire it into validation
    - Create `src/oracle/scan.ts` with `maskCommentsAndLiterals`, `findExternalCall` (any `CALL` token on the masked text) and `findForbiddenConstruct` using the hyphen-aware boundary pattern so `OPENING-BALANCE` does not match `OPEN`
    - Extend (do not replace) `src/oracle/validate.ts` from Task 2.9: fill the placeholder step so `validateRequest` and `compileCobol` run the external call and forbidden construct checks in the fixed order of the design, after NUL and before input lines
    - Messages must name the rejected call or construct; the Phase A size, empty, NUL, input line and timeout checks stay unchanged
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.8, 13.9, 13.10_
  - [ ]* 4.2 Write property and unit tests for validation and scans
    - **Property 1: Source validation classification**
    - **Property 2: Input line validation**
    - **Property 3: Timeout validation**
    - **Property 4: External call detection**
    - **Property 5: Forbidden construct detection**
    - **Property 6: Comments and literals are ignored by scans**
    - Unit tests: each `CALL "SYSTEM"` spelling (lower, mixed case, repeated whitespace, single quotes, double quotes, identifier), each of `SELECT`, `FD`, `OPEN`, `COPY` with case and whitespace variants, source of limit plus 1 bytes, source of exactly the limit, and `interest.cbl`, `payroll.cbl`, `tax.cbl` accepted
    - Use generators `arbSourceWithCall`, `arbSourceWithConstruct`, `arbCommentedOrQuoted`; at least 100 runs
    - **Validates: Requirements 3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 10.5, 10.11, 10.12, 10.13, 13.1, 13.2, 13.3, 13.4, 13.5, 13.7, 13.8, 13.9, 13.10**

- [ ] 5. Phase B: Per-program sandbox in the Worker
  - [~] 5.1 Add slots and work directory ownership
    - Create `src/oracle/worker/slots.ts` with a `SlotPool` (uid `uidBase + n`, scratch dir mode 0700, wipe before release, FIFO queue when all slots are busy)
    - Extend (do not replace) `src/oracle/worker/workfs.ts` from Task 2.6: after compile `chown root:oracle-run` and mode 0750 on the handle directory and 0550 on the executable, scratch directory creation and wipe
    - Create an in-memory `WorkFs` double at `tests/oracle/doubles/memory-workfs.ts` that can inject delete failures
    - _Requirements: 6.1, 6.2, 6.4, 6.6, 12.3_
  - [~] 5.2 Add limit classification
    - Create `src/oracle/worker/limits.ts` with the pure `classifyChild` function (timer, output cap, `SIGXCPU`, `SIGXFSZ`, memory and process heuristics)
    - Extend (do not replace) `src/oracle/classify.ts` from Task 2.9: map `endedBy = limit` outcomes to `resource_limit` with a message naming memory, CPU time, process count or file size, keeping the Phase A cases unchanged
    - _Requirements: 3.3, 5.4, 12.5_
  - [ ]* 5.3 Write property test for limit classification
    - **Property 20: Limit classification**
    - Use generator `arbTermination`
    - **Validates: Requirements 3.3, 5.4, 12.5**
  - [~] 5.4 Add uid, gid, environment allowlist and kill sweep to the spawner
    - Extend (do not replace) `src/oracle/worker/spawner.ts` from Task 2.6: pass `uid`, `gid` and a replacing `env` to `spawn`; after a timeout or output cap kill, run `kill -9 -1` as the slot uid and wait for `close` before returning
    - Extend `tests/oracle/doubles/fake-spawner.ts` so it records uid, gid and env of every `SpawnSpec`
    - _Requirements: 3.2, 3.6, 5.5, 6.5, 12.1, 12.3_
  - [~] 5.5 Wire sandbox, prlimit and limits into the Worker
    - Extend (do not replace) `src/oracle/worker/server.ts` from Task 2.7: take a slot per compile and run, build commands as `prlimit <limits> -- cobc -x -free -o prog prog.cob` and `prlimit <limits> -- <handle>/prog`, pass the fixed environment from the policy with `HOME` set to the slot scratch directory, set cwd to the scratch directory, and classify terminations with `classifyChild`
    - Add `ping` with optional `cobc --version` output and `busySlots`, run concurrent runs up to `workerConcurrency`, free the slot and wipe scratch only after the process group has exited and before answering, and repeat the cheap size, NUL and input checks defensively
    - Extend `src/oracle/worker/main.ts` to log once when uid separation or network isolation is unavailable
    - _Requirements: 6.1, 6.3, 7.3, 11.6, 12.3, 12.4, 12.5, 12.7, 12.8, 12.9_

- [ ] 6. Phase B: Docker isolation, environment check, recovery and lifecycle
  - [~] 6.1 Harden the launchers
    - Extend (do not replace) `src/oracle/docker-launcher.ts` from Task 2.11: add `--network none --memory 1g --pids-limit 256 --read-only --tmpfs /work:rw,exec,nosuid,size=256m --cap-drop ALL` with exactly the six `--cap-add` entries and `--security-opt no-new-privileges`, and a `docker kill` fallback on stop
    - Extend `src/oracle/direct-launcher.ts`: apply the same Sandbox_Policy inside the image, and log once when network isolation is unavailable while keeping every other restriction
    - _Requirements: 7.5, 7.7, 12.6, 12.7, 12.8_
  - [~] 6.2 Implement the environment check and wire it into the API
    - Create `src/oracle/environment.ts` with `parseCobcVersion` and `ensureEnvironment` that memoizes one in-flight promise, runs `ping` with `withVersion` once, caches a version mismatch permanently with both versions in the message, and does not cache launch failures
    - Extend (do not replace) `src/oracle/index.ts` from Task 2.12: call `ensureEnvironment` before the first Worker request and return `environment_error` for every request after a cached mismatch without launching anything again
    - _Requirements: 7.3, 7.4, 7.5_
  - [~] 6.3 Add restart to the Worker client
    - Extend (do not replace) `src/oracle/worker-client.ts` from Task 2.11: add `restart` (new launch and handshake, no new version check) and make sure no pending entry survives a response or a loss
    - _Requirements: 11.7_
  - [~] 6.4 Add Worker-lost recovery and the full handle lifecycle
    - Extend (do not replace) `src/oracle/handles.ts` and `src/oracle/index.ts` from Tasks 2.12 and 6.2: keep the validated source per handle; on `WorkerLostError` restart once and retry once, recompiling on `unknown_handle`; return `environment_error` if the retry also fails and keep the handle registered
    - Make `releaseHandle` idempotent, make `shutdown` wait up to 2 s for the Worker and then kill the transport, and add an internal, test-only `bypassScans` option that is not part of the public types
    - _Requirements: 11.7, 11.8, 11.9_

- [~] 7. Checkpoint - Phase B hardening complete
  - Run `npm run typecheck`, `npm run lint` and `npm test`; rebuild the image and re-run the slice smoke test so the Phase A behavior is unchanged.
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Phase C: Remaining property and unit tests with test doubles
  - [ ]* 8.1 Write property tests for the Worker with doubles
    - **Property 11: Sandbox environment is fixed**
    - **Property 15: Cleanup after every outcome**
    - Connect a `serve()` instance to the fake spawner and in-memory `WorkFs`; use generator `arbParentEnv` including names like `OPENAI_API_KEY`; inject delete failures; at least 100 runs
    - **Validates: Requirements 6.2, 6.3, 6.4, 6.5, 7.8, 12.1, 12.2, 12.3**
  - [ ]* 8.2 Write unit tests for Worker command construction
    - Assert `prlimit` arguments for run and compile limits, uid not equal to 0, gid 20000, cwd equal to the slot scratch directory, queueing when concurrent runs exceed slots, `unknown_handle` response, and empty-stdin runs
    - _Requirements: 1.7, 11.9, 12.3, 12.4_
  - [ ]* 8.3 Write property tests for the API with doubles
    - **Property 7: Rejected requests are deterministic and start no process**
    - **Property 12: Version check runs once and gates all runs**
    - **Property 13: Result structure and message presence**
    - **Property 16: Compile once, run many**
    - Use a recording `WorkerLauncher` double connected to a fake Worker or to `serve()` with the fake spawner; at least 100 runs
    - **Validates: Requirements 3.5, 4.2, 4.4, 4.5, 5.1, 5.2, 7.3, 7.4, 8.2, 8.3, 8.4, 9.4, 11.2, 11.4, 11.5, 11.9, 13.2, 13.6, 13.9, 13.11**
  - [ ]* 8.4 Write property tests for the client
    - **Property 18: Request-id multiplexing**
    - **Property 19: Worker-lost recovery**
    - Use generators `arbResponseOrder` and `arbLossPoint`
    - **Validates: Requirements 9.3, 11.5, 11.6, 11.7**
  - [ ]* 8.5 Write unit tests for launchers, statuses and handle lifecycle
    - Assert the `docker run` argument list (network none, memory, pids, read-only, `--cap-drop ALL` with the six `--cap-add`, `no-new-privileges`) and that direct mode uses no `docker` command
    - Cover each Status value with doubles: `ok`, `compile_error`, `timeout`, `source_too_large`, `invalid_request`, `resource_limit`, `environment_error` (Docker missing, image missing, version mismatch)
    - Cover release, run of a released handle, and `shutdown` releasing everything
    - _Requirements: 7.5, 7.6, 7.7, 10.2, 11.8, 11.9, 12.8_

- [ ] 9. Phase C: Real-image integration, sandbox and performance tests
  - [ ]* 9.1 Write sample integration tests
    - Run `interest.cbl`, `payroll.cbl`, `tax.cbl` through `runCobol` against the Oracle_Image and compare stdout with the verified values in `cobol-samples/EXPECTED.md`
    - Assert the three samples pass the External_Call, file I/O and `COPY` checks
    - _Requirements: 10.3, 10.12, 13.7_
  - [ ]* 9.2 Write timeout, size and environment tests against the image
    - Infinite loop returns `timeout` within 2 s of the timeout, partial output kept, and a `ping` reports zero live handles and zero busy slots
    - Compile timeout returns `timeout` naming the compile phase; a compile error returns `compile_error` with empty stdout
    - A fake secret set in the runner process is not visible to a COBOL program reading its environment
    - Early stdin close with a program that never reads input
    - _Requirements: 1.6, 2.1, 2.2, 2.3, 3.2, 3.6, 5.5, 6.2, 6.3, 10.4, 10.10_
  - [ ]* 9.3 Write real-compiler property tests
    - **Property 21: Determinism and isolation (real compiler)**
    - **Property 22: Handle run equals single-shot run (real compiler)**
    - Use the three samples with generated numeric input lines; at least 25 runs each, at least 3 repetitions, concurrent versus sequential comparison
    - **Validates: Requirements 9.1, 9.2, 9.3, 10.6, 10.8, 11.11**
  - [ ]* 9.4 Write sandbox and resource-limit tests against the image
    - A program cannot create or modify a file outside its scratch directory or modify its own binary (scans bypassed)
    - A program runs with a uid other than 0 and an empty capability set, and cannot read another slot's scratch directory
    - One test each for memory, CPU time, process count and file size: status `resource_limit`, message naming the limit, and a following run succeeds
    - Concurrent runs beyond the slot count all complete with distinct uids
    - Kill the Worker idle and during a run, and assert recovery with the handle still usable
    - _Requirements: 6.6, 11.7, 12.3, 12.4, 12.5, 12.9, 10.14, 10.15_
  - [ ]* 9.5 Write the performance test
    - Compile each of `interest.cbl`, `payroll.cbl`, `tax.cbl` once; make 1000 runs of each on its handle with bounded concurrency; assert each batch completes in under 60 s excluding compile
    - Add a sequential batch of 200 runs per program asserting a mean under 20 ms; report mean and 95th percentile; assert the launcher call count stays at 1 during the timed section
    - _Requirements: 10.9, 11.12_

- [~] 10. Final checkpoint - Run the sample equivalence suite
  - Run `npm run typecheck`, `npm run lint`, `scripts/run-samples.sh` (the sample equivalence suite) and `npm test`; ensure all pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Task 1.2 is a gate: if the mean Worker overhead is 10 ms or more, stop and revisit the design (C helper fallback) before starting Task 2
- Phase A is deliberately minimal: no source scans (hardened by Task 4.1), no per-program uid, slots or scratch directories (Tasks 5.1, 5.4, 5.5), no `prlimit` or limit classification (Tasks 5.2, 5.5), no environment allowlist (Tasks 5.4, 5.5), no Docker isolation flags (Task 6.1), no version check (Task 6.2) and no Worker restart or retry (Tasks 6.3, 6.4). Do not expose the slice to untrusted COBOL before Phase B is done
- Phase B tasks extend the Phase A files named in each task and do not replace them; the public signatures in `src/oracle/types.ts` and `src/oracle/index.ts` and the Worker protocol in `src/oracle/protocol.ts` are fixed in Phase A and MUST NOT change afterwards
- Property tests for pure Phase A modules sit next to their implementation (Tasks 2.3, 2.5, 2.10), those for Phase B modules sit in Phase B (Tasks 4.2, 5.3), and the properties that need the hardened Worker, client or API are in Phase C (Tasks 8.1 to 8.4, 9.3)
- Property tests use fast-check with Vitest, at least 100 runs with test doubles and at least 25 against the real image
- Each property test carries the tag `Feature: cobol-oracle-runner, Property N: <title>`
- Tests that need the real image require a running Docker daemon; run `vitest --run`, never watch mode
- Within each wave of the dependency graph, no two tasks write the same file

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["2.1"] },
    { "id": 3, "tasks": ["2.2", "2.4", "2.9"] },
    { "id": 4, "tasks": ["2.3", "2.5", "2.6", "2.10", "2.11"] },
    { "id": 5, "tasks": ["2.7", "2.12"] },
    { "id": 6, "tasks": ["2.8"] },
    { "id": 7, "tasks": ["2.13"] },
    { "id": 8, "tasks": ["4.1", "5.1", "5.2", "5.4", "6.1", "6.3"] },
    { "id": 9, "tasks": ["4.2", "5.3", "5.5"] },
    { "id": 10, "tasks": ["6.2"] },
    { "id": 11, "tasks": ["6.4"] },
    { "id": 12, "tasks": ["8.1", "8.2", "8.3", "8.4", "8.5"] },
    { "id": 13, "tasks": ["9.1", "9.2", "9.3", "9.4", "9.5"] }
  ]
}
```

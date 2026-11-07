# Requirements Document

## Introduction

The COBOL Oracle Runner is a TypeScript module (planned location: `src/oracle/`) that takes COBOL source code and a list of input lines, compiles the source with GnuCOBOL (`cobc -x -free`) in a temporary directory, runs the resulting executable with the input lines on standard input, and returns standard output, standard error and the exit code.

The Oracle Runner is the reference ("oracle") for the Necromancer equivalence proof, so its results must be reproducible. It therefore executes inside the project Docker image (Ubuntu 24.04 with GnuCOBOL 3.1.2, defined in `necromancer/Dockerfile`), which fixes the compiler version. The runner enforces a timeout, a source size limit and temporary file cleanup so that it is safe to call thousands of times from the property-based equivalence engine.

Existing context: `cobol-samples/` holds `interest.cbl`, `payroll.cbl` and `tax.cbl` with verified outputs in `cobol-samples/EXPECTED.md`. Those outputs serve as known-good examples for the runner.

## Glossary

- **Oracle_Runner**: The module that compiles and executes COBOL source and returns the result.
- **Run_Request**: The input to the Oracle_Runner, consisting of COBOL source text and an ordered list of input lines.
- **Run_Result**: The output of the Oracle_Runner, consisting of stdout, stderr, exit code and a status.
- **Status**: One of `ok`, `compile_error`, `timeout`, `source_too_large`, `invalid_request`, `resource_limit` or `environment_error`. `resource_limit` means a memory, CPU time, process count or file size limit of the Sandbox_Policy was breached.
- **GnuCOBOL**: The COBOL compiler, invoked as `cobc`, pinned to version 3.1.2.
- **Oracle_Image**: The Docker image built from `necromancer/Dockerfile` (Ubuntu 24.04, GnuCOBOL 3.1.2).
- **Work_Directory**: A uniquely named temporary directory created for one Run_Request and holding the source file and executable.
- **Source_Size_Limit**: The maximum accepted COBOL source size, 65536 bytes (UTF-8 encoded) by default, configurable.
- **Compile_Timeout**: The maximum wall-clock time allowed for compilation, 30 seconds by default, configurable.
- **Run_Timeout**: The maximum wall-clock time allowed for program execution, 5 seconds by default, configurable.
- **Output_Limit**: The maximum number of bytes captured per output stream, 1048576 bytes by default, configurable.
- **Input_Lines**: The ordered list of strings written to the program's stdin, each terminated by a line feed.
- **Compiled_Handle**: An opaque, reusable reference to a program compiled once by the Oracle_Runner, which can be run many times against different Input_Lines.
- **Worker**: A long-lived process or container, started from the Oracle_Image, that executes runs of Compiled_Handles without a new container start per run.
- **Sandbox_Policy**: The fixed set of restrictions applied to every compiled program: environment allowlist, unprivileged user, resource limits and disabled network.
- **External_Call**: A COBOL `CALL` statement, including `CALL "SYSTEM"`, that invokes a routine outside the submitted source.

## Requirements

### Requirement 1: Execute COBOL source and return results

**User Story:** As an equivalence engineer, I want to submit COBOL source and input lines and receive the program's output, so that I can use real GnuCOBOL behavior as the reference.

#### Acceptance Criteria

1. WHEN a valid Run_Request is received, THE Oracle_Runner SHALL write the source to a file inside a new Work_Directory.
2. WHEN the source file is written, THE Oracle_Runner SHALL compile it with the command `cobc -x -free` and an output path inside the Work_Directory.
3. WHEN compilation succeeds, THE Oracle_Runner SHALL execute the compiled program with the Input_Lines on stdin.
4. WHEN the program terminates, THE Oracle_Runner SHALL return a Run_Result containing the captured stdout, the captured stderr, the exit code and the Status `ok`.
5. WHEN the Input_Lines are written to stdin, THE Oracle_Runner SHALL terminate each line with a single line feed character and close stdin after the last line.
6. WHEN the program exits with a non-zero exit code, THE Oracle_Runner SHALL return the Status `ok` together with that exit code.
7. WHEN the Input_Lines list is empty, THE Oracle_Runner SHALL run the program with an empty stdin that is closed immediately.
8. THE Oracle_Runner SHALL return stdout and stderr as UTF-8 decoded strings without altering line endings or whitespace.

### Requirement 2: Report compilation failures

**User Story:** As an equivalence engineer, I want compiler diagnostics when the COBOL does not compile, so that I can tell a bad program from a bad run.

#### Acceptance Criteria

1. IF `cobc` exits with a non-zero exit code, THEN THE Oracle_Runner SHALL return the Status `compile_error` with the compiler's stderr and the compiler's exit code.
2. IF the Status is `compile_error`, THEN THE Oracle_Runner SHALL leave stdout empty and SHALL NOT execute any program.
3. IF compilation exceeds the Compile_Timeout, THEN THE Oracle_Runner SHALL terminate the compiler process, and return the Status `timeout` with a message identifying the compile phase.

### Requirement 3: Enforce execution timeout

**User Story:** As an equivalence engineer, I want runaway programs stopped, so that an infinite loop cannot block the equivalence run.

#### Acceptance Criteria

1. WHILE a compiled program is running, THE Oracle_Runner SHALL measure elapsed wall-clock time against the Run_Timeout.
2. IF the program is still running when the Run_Timeout elapses, THEN THE Oracle_Runner SHALL kill the program process and all of its child processes.
3. IF the Run_Timeout elapses, THEN THE Oracle_Runner SHALL return the Status `timeout` together with the stdout and stderr captured up to the kill.
4. WHEN a Run_Timeout is supplied in the Run_Request, THE Oracle_Runner SHALL use it in place of the default, within a maximum of 60 seconds.
5. IF the supplied Run_Timeout is not a positive number or exceeds 60 seconds, THEN THE Oracle_Runner SHALL return the Status `invalid_request` and SHALL NOT compile the source.
6. WHEN a program is terminated by a timeout, THE Oracle_Runner SHALL return within 2 seconds after the Run_Timeout elapses.

### Requirement 4: Enforce source size limit

**User Story:** As an operator, I want oversized source rejected up front, so that the compiler is not fed abusive input.

#### Acceptance Criteria

1. WHEN a Run_Request is received, THE Oracle_Runner SHALL measure the source size in UTF-8 bytes before creating a Work_Directory.
2. IF the source size exceeds the Source_Size_Limit, THEN THE Oracle_Runner SHALL return the Status `source_too_large` and SHALL NOT create a Work_Directory or start any process.
3. WHEN the source size equals the Source_Size_Limit, THE Oracle_Runner SHALL accept the source for compilation.
4. IF the source is empty or contains only whitespace, THEN THE Oracle_Runner SHALL return the Status `invalid_request` and SHALL NOT start any process.
5. IF the source contains a NUL character, THEN THE Oracle_Runner SHALL return the Status `invalid_request` and SHALL NOT start any process.

### Requirement 5: Validate input lines and bound output

**User Story:** As an operator, I want inputs and outputs bounded, so that one run cannot exhaust memory or disk.

#### Acceptance Criteria

1. IF an input line contains a line feed or carriage return character, THEN THE Oracle_Runner SHALL return the Status `invalid_request` and SHALL NOT start any process.
2. IF the total size of the Input_Lines exceeds 65536 bytes, THEN THE Oracle_Runner SHALL return the Status `invalid_request` and SHALL NOT start any process.
3. WHILE a program is running, THE Oracle_Runner SHALL count the bytes captured from each output stream against the Output_Limit.
4. IF a stream reaches the Output_Limit, THEN THE Oracle_Runner SHALL kill the program process, truncate that stream at the Output_Limit and mark the Run_Result as truncated.
5. WHEN a program closes stdin early or never reads it, THE Oracle_Runner SHALL complete the run without failing on the broken pipe.

### Requirement 6: Clean up temporary files

**User Story:** As an operator, I want every run to leave nothing behind, so that thousands of runs do not fill the disk.

#### Acceptance Criteria

1. WHEN a Run_Request creates a Work_Directory, THE Oracle_Runner SHALL create it with a unique name and restricted permissions that deny access to all other users, with the Worker as owner and the program's group granted read and execute access only (for example mode 0750).
2. WHEN a run finishes with any Status, THE Oracle_Runner SHALL delete the Work_Directory and all files inside it before returning.
3. IF the run ends by timeout, THEN THE Oracle_Runner SHALL delete the Work_Directory after the killed processes have exited.
4. IF deleting the Work_Directory fails, THEN THE Oracle_Runner SHALL log the failure and still return the Run_Result.
5. WHEN a run finishes, THE Oracle_Runner SHALL leave no `cobc` or compiled program process running.
6. THE Oracle_Runner SHALL run concurrent Run_Requests in separate Work_Directories that share no files.

### Requirement 7: Run inside the pinned Docker image

**User Story:** As a project maintainer, I want the oracle to run in the project Docker image, so that the GnuCOBOL version is always 3.1.2.

#### Acceptance Criteria

1. THE Oracle_Runner SHALL execute `cobc` and compiled programs inside a container started from the Oracle_Image.
2. THE Oracle_Image SHALL be built from `necromancer/Dockerfile`, which installs GnuCOBOL on Ubuntu 24.04.
3. WHEN the Oracle_Runner starts, THE Oracle_Runner SHALL run `cobc --version` in the Oracle_Image once, compare the reported version with the expected version `3.1.2`, and cache the result for all later runs.
4. IF the cached version check result shows a GnuCOBOL version other than `3.1.2`, THEN THE Oracle_Runner SHALL return the Status `environment_error` for every Run_Request without starting any container, and report both versions, without running `cobc --version` again.
5. IF the Docker daemon or the Oracle_Image is unavailable, THEN THE Oracle_Runner SHALL return the Status `environment_error` with a message describing the missing component.
6. WHERE the Oracle_Runner is already executing inside the Oracle_Image, THE Oracle_Runner SHALL invoke `cobc` directly without starting a nested container.
7. WHILE the Oracle_Runner executes a program in a container, THE Oracle_Runner SHALL disable container network access and apply memory and process-count limits.
8. THE Oracle_Runner SHALL pass the same locale and environment variables to every run.

### Requirement 8: Typed interface and structured result

**User Story:** As a developer of the equivalence engine, I want a strictly typed function with a structured result, so that callers can handle every outcome without parsing text.

#### Acceptance Criteria

1. THE Oracle_Runner SHALL expose an asynchronous function that accepts a Run_Request and resolves to a Run_Result.
2. THE Oracle_Runner SHALL resolve with a Run_Result for every outcome instead of rejecting, including invalid requests and environment errors.
3. THE Run_Result SHALL contain the fields `status`, `stdout`, `stderr`, `exitCode`, `truncated` and `durationMs`.
4. WHEN the Status is not `ok`, THE Run_Result SHALL include a `message` field describing the cause.
5. THE Oracle_Runner SHALL be implemented in TypeScript strict mode without the `any` type.
6. WHEN the Run_Result is serialized to JSON and parsed again, THE Oracle_Runner SHALL produce a Run_Result equal to the original (round-trip property).

### Requirement 9: Deterministic results

**User Story:** As an equivalence engineer, I want identical requests to give identical results, so that the oracle can be trusted as a reference.

#### Acceptance Criteria

1. FOR ALL valid Run_Requests with Status `ok`, running the same Run_Request twice SHALL produce identical stdout, stderr and exit code (determinism property).
2. FOR ALL generated Input_Lines applied to a fixed sample program, running the Run_Request repeatedly SHALL produce identical stdout, stderr and exit code across at least 3 repetitions.
3. FOR ALL Run_Requests run concurrently and sequentially, THE Oracle_Runner SHALL produce identical stdout, stderr and exit code for each request (isolation property).
4. FOR ALL invalid Run_Requests, running the same request twice SHALL produce the same Status and message (error-condition determinism).
5. THE Oracle_Runner SHALL exclude `durationMs` from determinism comparisons.

### Requirement 10: Test coverage

**User Story:** As a maintainer, I want unit, property and integration tests, so that the oracle's guarantees are verified automatically.

#### Acceptance Criteria

1. THE Oracle_Runner SHALL have fast-check property tests run with Vitest for the determinism, isolation and round-trip properties in Requirements 8 and 9.
2. THE Oracle_Runner SHALL have unit tests that cover each Status value: `ok`, `compile_error`, `timeout`, `source_too_large`, `invalid_request`, `resource_limit` and `environment_error`.
3. THE Oracle_Runner SHALL have integration tests that run `interest.cbl`, `payroll.cbl` and `tax.cbl` and compare stdout with the verified values in `cobol-samples/EXPECTED.md`.
4. THE Oracle_Runner SHALL have a test that runs a source with an infinite loop and verifies the Status `timeout` and removal of the Work_Directory.
5. THE Oracle_Runner SHALL have a test that submits source of Source_Size_Limit plus 1 bytes and verifies the Status `source_too_large`.
6. WHERE a property test requires the real compiler, THE Oracle_Runner test suite SHALL run it against the Oracle_Image with no fewer than 25 generated cases.
7. WHERE a test only exercises validation logic, THE Oracle_Runner test suite SHALL run it with the process layer replaced by a test double and no fewer than 100 generated cases.
8. THE Oracle_Runner SHALL have a fast-check property test, run against the Oracle_Image, that verifies a run of a Compiled_Handle equals the single-shot Run_Request for the same source and Input_Lines in stdout, stderr and exit code (Requirement 11.11).
9. THE Oracle_Runner SHALL have a performance test that compiles each of `interest.cbl`, `payroll.cbl` and `tax.cbl` once, makes 1000 runs of each on its Compiled_Handle, and verifies the 1000 runs of each program complete in under 60 seconds (Requirement 11.12).
10. THE Oracle_Runner SHALL have a test that sets a fake secret environment variable in the runner process and verifies that a COBOL program reading its environment cannot see it.
11. THE Oracle_Runner SHALL have tests that verify `CALL "SYSTEM"` is rejected with the Status `invalid_request` and no started process, in at least these spellings: lower case, mixed case, repeated whitespace between `CALL` and the routine name, single quotes, double quotes, and an identifier as the routine name.
12. THE Oracle_Runner SHALL have a test that verifies `interest.cbl`, `payroll.cbl` and `tax.cbl` are still accepted by the External_Call, file I/O and `COPY` checks.
13. THE Oracle_Runner SHALL have tests that verify sources containing `SELECT`, `FD`, `OPEN` or `COPY` are rejected with the Status `invalid_request` and no started process, including a case-variation and a repeated-whitespace variant of each.
14. THE Oracle_Runner SHALL have a test that verifies a program cannot create or modify a file outside its Work_Directory, running the program with the source scans bypassed in the test.
15. THE Oracle_Runner SHALL have one test for each resource limit (memory, CPU time, process count and file size) that runs a program breaching that limit, with the source scans bypassed where the program needs a construct the scans reject, and verifies the Status `resource_limit`, the message naming the breached limit, and that a following run still succeeds.

### Requirement 11: Compile once, run many

**User Story:** As an equivalence engineer, I want to compile a program once and run it against thousands of inputs, so that the property tests are not slowed by a compile and a container start for every case.

#### Acceptance Criteria

1. THE Oracle_Runner SHALL expose an asynchronous function that accepts COBOL source and resolves to either a Compiled_Handle or a Run_Result with a Status other than `ok`.
2. WHEN compilation succeeds, THE Oracle_Runner SHALL compile the source exactly once and return a Compiled_Handle.
3. THE Oracle_Runner SHALL expose an asynchronous function that accepts a Compiled_Handle, Input_Lines and an optional Run_Timeout, and resolves to a Run_Result.
4. WHEN a Compiled_Handle is run, THE Oracle_Runner SHALL NOT invoke `cobc` and SHALL NOT start a new container for that run.
5. THE Oracle_Runner SHALL execute every run of a Compiled_Handle in a Worker that stays alive across runs.
6. WHEN a run of a Compiled_Handle is made, THE Oracle_Runner SHALL apply the validation, timeout, Output_Limit, determinism and Sandbox_Policy rules of Requirements 1 to 9 and 12 to that run.
7. IF a run times out or is killed, THEN THE Oracle_Runner SHALL keep the Compiled_Handle usable and SHALL replace the Worker if the Worker itself was lost.
8. THE Oracle_Runner SHALL expose a function that releases a Compiled_Handle and deletes its Work_Directory, and SHALL release every remaining Compiled_Handle and stop the Worker on shutdown.
9. IF a released or unknown Compiled_Handle is run, THEN THE Oracle_Runner SHALL return the Status `invalid_request` and SHALL NOT start any process.
10. THE Oracle_Runner SHALL keep the single-shot Run_Request interface of Requirement 1 available for simple use, with unchanged behavior.
11. FOR ALL Input_Lines, running a Compiled_Handle SHALL produce the same stdout, stderr and exit code as the single-shot Run_Request for the same source (equivalence property).
12. WHEN 1000 runs of each of `interest.cbl`, `payroll.cbl` and `tax.cbl` are made on a Compiled_Handle after compilation, THE Oracle_Runner SHALL complete the 1000 runs of each program in under 60 seconds, excluding compilation time.

### Requirement 12: Sandbox untrusted COBOL

**User Story:** As an operator, I want untrusted COBOL to run with minimal privileges, so that a hostile program cannot read secrets, exhaust the host or reach the network.

#### Acceptance Criteria

1. THE Oracle_Runner SHALL start every compiled program with an environment built only from a fixed allowlist of variables with fixed values, and SHALL NOT inherit any variable from the parent process.
2. THE Oracle_Runner SHALL NOT pass API keys, tokens or any other secret into the program's environment, command line or Work_Directory.
3. THE Oracle_Runner SHALL run every compiled program as an unprivileged user, never as root.
4. THE Oracle_Runner SHALL apply limits on memory, CPU time, number of processes and maximum file size to every compiled program.
5. IF a program exceeds the memory, CPU time, process or file size limit, THEN THE Oracle_Runner SHALL stop it and return the Status `resource_limit` with a message naming the breached limit, together with the stdout and stderr captured up to the stop, without affecting later runs.
6. WHERE the platform supports it, THE Oracle_Runner SHALL disable network access for every compiled program.
7. IF the platform cannot disable network access, THEN THE Oracle_Runner SHALL log that network isolation is unavailable and SHALL still apply every other restriction in this requirement.
8. WHERE the Oracle_Runner is already executing inside the Oracle_Image (requirement 7.6), THE Oracle_Runner SHALL apply the same Sandbox_Policy to compiled programs as it does when using a container.
9. THE Oracle_Runner SHALL apply the Sandbox_Policy to the compiled program and SHALL NOT apply the program's restrictions in a way that changes the output of a well-behaved program.

### Requirement 13: Reject external calls, file I/O and COPY

**User Story:** As an operator, I want programs that call external routines, use file I/O or include other files refused, so that `CALL "SYSTEM"` cannot run shell commands and the oracle stays within the project scope of single-file calculation programs.

#### Acceptance Criteria

1. WHEN a Run_Request or compile request is received, THE Oracle_Runner SHALL scan the source for External_Calls before creating a Work_Directory.
2. IF the source contains `CALL "SYSTEM"` or any other External_Call, THEN THE Oracle_Runner SHALL return the Status `invalid_request` with a message naming the rejected call, and SHALL NOT create a Work_Directory or start any process.
3. THE Oracle_Runner SHALL detect an External_Call regardless of letter case, repeated whitespace, single or double quotes around the routine name, or a routine named by an identifier instead of a literal.
4. THE Oracle_Runner SHALL ignore the word `CALL` inside free-format comments (lines or line endings starting at `*>`).
5. WHEN the source contains no External_Call, THE Oracle_Runner SHALL accept it for the checks in Requirements 4 and 5.
6. FOR ALL sources containing an External_Call, running the same request twice SHALL return the same Status and message (error-condition determinism).
7. THE Oracle_Runner SHALL accept `interest.cbl`, `payroll.cbl` and `tax.cbl` without rejection.
8. WHEN a Run_Request or compile request is received, THE Oracle_Runner SHALL scan the source for file I/O statements (`SELECT`, `FD` and `OPEN`) and for `COPY` statements before creating a Work_Directory.
9. IF the source contains a `SELECT`, `FD`, `OPEN` or `COPY` statement, THEN THE Oracle_Runner SHALL return the Status `invalid_request` with a message naming the rejected construct and SHALL NOT create a Work_Directory or start any process.
10. WHEN the source contains any one of `SELECT`, `FD`, `OPEN` or `COPY`, THE Oracle_Runner SHALL detect that construct regardless of letter case or repeated whitespace, and SHALL ignore it inside free-format comments (`*>`) and inside quoted string literals.
11. FOR ALL sources containing file I/O or a `COPY` statement, running the same request twice SHALL return the same Status and message (error-condition determinism).

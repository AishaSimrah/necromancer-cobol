# Prompts to paste into Kiro

Kiro generates the specs (requirements.md, design.md, tasks.md) itself. Paste these into Kiro's spec mode, one per spec. The steering docs in `.kiro/steering/` are picked up automatically.

Keep a note in `docs/kiro-log.md` after each one: what Kiro produced, what you changed, what surprised you.

## Spec 1: COBOL oracle
Create a spec for a module that takes COBOL source code and a list of input lines, compiles it with GnuCOBOL (`cobc -x -free`) in a temporary directory, runs it with the inputs on stdin, and returns stdout, stderr and the exit code. It must enforce a timeout, clean up temp files, and reject source over a size limit. Include property tests that the oracle is deterministic for the same input.

## Spec 2: Analyzer
Create a spec for a COBOL analyzer. Given a program, it extracts the ACCEPT inputs (name, PIC clause, scale), DISPLAY outputs, and flags semantic traps: ROUNDED usage, unrounded COMPUTE into a smaller scale, potential overflow, unsigned fields, EVALUATE branches. Output a structured JSON description and a plain-English summary of the business rules. Support only the three sample programs' constructs first.

## Spec 3: Translator
Create a spec for a COBOL to TypeScript translator that follows `.kiro/steering/cobol-semantics.md`. It uses an LLM to draft the TypeScript, then validates it compiles and exports a function from input strings to output text matching the COBOL DISPLAY formatting exactly. Use decimal arithmetic only.

## Spec 4: Equivalence engine (the core)
Create a spec for an equivalence engine using fast-check. It generates inputs from the analyzer's field descriptions, biased toward edge cases (zero, max value, rounding boundaries like x.xx5, overflow). It runs the oracle and the translated TypeScript on each input, compares outputs character for character, and returns a match score, the number of cases run, and the minimal failing examples. Express the main property as: for all valid inputs, oracle output equals translated output. Include a requirement that the match score is only reported after the tests actually ran.

## Spec 5: UI
Create a spec for three screens (The Crypt, The Ritual, The Verdict) following `.kiro/steering/spooky-theme.md` and the Figma designs. Show the proof: match score, cases run, and each mismatch as a "ghost" with input, COBOL output and TypeScript output.

## Hooks to create (Kiro Agent Hooks panel)
1. On save of any file in `src/translator/` or `src/equivalence/`: run the equivalence suite on the sample programs.
2. On save of a `.kiro/specs/**/requirements.md`: update `docs/kiro-log.md` with a one-line note.
3. On commit or manual trigger: check that `.kiro` is not in `.gitignore` and the LICENSE file exists.

## Custom agent
Create a "Necromancer" agent focused on legacy-code translation: it must read `cobol-semantics.md` first, never use floating point for money, and always run the equivalence suite before saying a task is done.

## MCP servers worth setting up
- Figma MCP (design to code). Check the Powers panel for a Figma power first.
- GitHub MCP (manage repo and issues).
Log which ones you used and what they enabled, since the write-up asks for this.

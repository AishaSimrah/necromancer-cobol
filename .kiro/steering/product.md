# Product: Necromancer

Tagline: "Legacy code never dies. Necromancer raises it from the dead, and proves the resurrection is faithful."

## What it does
1. User picks or uploads a COBOL program (business calculation: interest, payroll, tax).
2. The app analyzes it: inputs, outputs, business rules, and traps (rounding, truncation, overflow).
3. The app generates a TypeScript translation.
4. The app PROVES equivalence: it runs the original COBOL (compiled with GnuCOBOL, the "oracle") and the TypeScript on thousands of generated inputs and compares outputs.
5. Any mismatch is shown with the exact input, expected vs actual output.
6. Stretch goal only: an automatic repair loop that feeds mismatches back to the translator.

## Core principle
The proof is the product. A translation without an equivalence score is worthless here. Never show a "success" state unless the property tests ran and passed.

## Scope (hard limits)
- Source language: COBOL only.
- Target language: TypeScript only.
- Program type: single-file calculation programs. Inputs via ACCEPT (stdin), outputs via DISPLAY.
- Out of scope: file I/O, databases, screen sections, CICS, multi-file programs, other languages.

## Audience
Hackathon judges (developers). They should understand the value in 20 seconds.

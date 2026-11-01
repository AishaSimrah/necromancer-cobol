# COBOL semantics the translator MUST preserve

These are the exact traps that make naive translations wrong. The equivalence suite exists to catch them.

1. **Fixed-point decimals.** `PIC 9(7)V99` is a number with 2 implied decimal places. Use decimal arithmetic, never floats.
2. **ROUNDED vs not.** `COMPUTE X ROUNDED = ...` rounds half away from zero to the field's scale. Without ROUNDED the result is TRUNCATED toward zero to the field's scale.
3. **Per-statement rounding.** Rounding happens at every COMPUTE into a stored field, not only at the end. A loop that rounds each iteration gives a different answer than one rounding at the end.
4. **Silent overflow.** When a result is larger than the field allows and there is no ON SIZE ERROR clause, high-order digits are dropped (the value wraps modulo 10^digits). Example: a `PIC 9(7)V99` field cannot exceed 9,999,999.99.
5. **Unsigned fields.** `PIC 9` fields hold no sign. A negative result is stored as its absolute value.
6. **Input parsing.** Inputs arrive as text via ACCEPT and are converted with NUMVAL, then stored into the target field (which truncates extra decimals and high-order digits).
7. **Output formatting.** `PIC Z(6)9.99` suppresses leading zeros with spaces and always shows 2 decimals. DISPLAY output must match character for character.
8. **EVALUATE TRUE** takes the first matching WHEN branch only.

Never "improve" COBOL behavior. If COBOL truncates or wraps, the TypeScript must truncate or wrap the same way.

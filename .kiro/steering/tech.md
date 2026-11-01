# Tech stack (defaults: edit if your skills differ)

- Language: TypeScript everywhere (strict mode on).
- Front end: Next.js (App Router) + React. Styling: Tailwind CSS. Design source: Figma.
- Back end: Next.js API routes or a small Node service. Keep it one deployable unit if possible.
- Oracle: GnuCOBOL (`cobc`) running inside a Docker container. Compile with `cobc -x -free`.
- Property-based testing: fast-check with Vitest.
- Decimal math: decimal.js (or integer arithmetic on scaled values). Never use JS floating point for money.
- LLM calls: provider key comes from environment variables. Never hard-code or commit keys.
- Deployment: a host that can run Docker (needed for `cobc`). Verify this in week 1.

## Rules
- Every module has unit tests AND property tests where a property exists.
- Small functions, explicit types, no `any`.
- Run the sample equivalence suite before declaring any task done.

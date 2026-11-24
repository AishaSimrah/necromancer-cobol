# Tech stack (defaults: edit if your skills differ)

- Language: TypeScript everywhere (strict mode on).
- Front end: static files in public/ served by the Node server. Styling: Tailwind CSS (build output or CDN-free static CSS). Design source: Figma. The UI technology is decided in the UI spec.
- Back end: one plain Node server (node:http, built with esbuild into dist/server/server.js). No web framework.
- Oracle: GnuCOBOL (`cobc`) running inside a Docker container. Compile with `cobc -x -free`.
- Property-based testing: fast-check with Vitest.
- Decimal math: decimal.js (or integer arithmetic on scaled values). Never use JS floating point for money.
- LLM calls: provider key comes from environment variables. Never hard-code or commit keys.
- Deployment: Render free Docker web service (Dockerfile.app), one container that holds the server, the Worker and GnuCOBOL.

## Rules
- Every module has unit tests AND property tests where a property exists.
- Small functions, explicit types, no `any`.
- Run the sample equivalence suite before declaring any task done.

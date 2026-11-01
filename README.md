# Necromancer

> Legacy code never dies. Necromancer raises it from the dead, and proves the resurrection is faithful.

Kiroween 2026 entry, **Resurrection** category.

Necromancer takes a COBOL program, translates it to TypeScript, then proves the two behave identically: it runs the original (compiled with GnuCOBOL) and the translation on thousands of generated inputs using property-based testing, and shows a match score and every mismatch.

## Status
Starter kit. The app itself is built with Kiro, spec by spec. See `docs/SCHEDULE.md`.

## Run the COBOL samples
Requires GnuCOBOL (`cobc`).

- Ubuntu/Debian/WSL: `sudo apt-get install gnucobol`
- macOS: `brew install gnucobol`
- Windows: use WSL (easiest) or a GnuCOBOL Windows build

```bash
./scripts/run-samples.sh
```

Compare the output with `cobol-samples/EXPECTED.md`.

## Repo layout
See `.kiro/steering/structure.md`.

## Built with Kiro
Specs, hooks and steering docs live in `/.kiro`. The write-up of how Kiro was used is in `docs/kiro-log.md`.

## License
MIT. See `LICENSE`.

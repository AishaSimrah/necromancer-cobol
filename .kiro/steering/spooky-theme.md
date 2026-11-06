# Spooky theme ("The Crypt")

The theme must help the function, not just decorate. The Figma design is the source of truth; if this file and Figma disagree, Figma wins and this file gets updated.

## Metaphor and copy
- Code is a body. Upload = "Summon". Translate = "Resurrect" / "Raise from the dead". Run tests = "Prove". Pass = "It lives". Fail = "Cursed".
- Screen names and tone are fixed: **The Crypt**, **The Ritual**, **The Verdict**. Short, dry, slightly ominous lines (e.g. "Almost faithful. Not yet safe.").
- Mismatches are "ghosts" or "where the soul diverged". Traps found in COBOL are "curses" shown as chips.

## Visual language (taken from the Figma screens)
- Background: near-black, about `#080808` to `#101010`, with a faint green/blue tint (`#101810`, `#081010`) in panels. Flat dark surfaces with thin 1px borders; no heavy shadows.
- Primary accent: toxic green, about `#38F888`. Used for pass states, the selected card outline, the main CTA button, the match score and the progress "complete" ticks. Darker greens (`#28B860`, `#289050`) for secondary green UI.
- Failure accent: soft red. Text and icons about `#FF777A`. "Curse" chip fill about `#251819`, chip border about `#612324`. Panel background behind chips about `#111516`. Used only for mismatches, "curse" chips, the failed "Prove" step and the highlighted diverging code line. (Measured from the Figma export; adjust if the design changes.)
- Text: bone/off-white for primary; dim grey for labels and metadata.
- Typography (from Figma):
  - **Cinzel Regular**: logo text and gothic-style headings (the big screen titles) only.
  - **JetBrains Mono Regular and Bold**: code, numbers, labels, buttons, tables and all supporting text.
  - Load both from Google Fonts (or self-host), with `monospace` and `serif` fallbacks. Do not introduce other fonts.
- Shapes: sample programs are tombstone-shaped cards (arched top). Panels have small corner radius and subtle borders.

## Layout per screen
1. **The Crypt:** title, three tombstone cards (INTEREST, PAYROLL, TAX) each with a "trap" label, a drop zone ("Summon your own COBOL"), a right-hand detail panel (source preview and the "Fidelity pact" checklist), and a bottom action bar with the Summon button.
2. **The Ritual:** a 3-step rail (Analyze, Resurrect, Prove), a strip with Inputs / Outputs / Curses found, then two code panels side by side (COBOL left, TypeScript right) with the risky lines highlighted, and a bottom bar with "Raise from the dead".
3. **The Verdict:** a large match score (e.g. 99.7%) with a headline, sample/pass/fail counts, an "Evidence" panel (property groups with pass counts), a "Where the soul diverged" table (input, COBOL output, TypeScript output, delta), and bottom buttons (export report, return to the ritual).

## Hard rules
- The match score appears ONLY after the property tests have actually run. Never show a success state without real results.
- Score wording: 100% = "It lives" (green). Below 100% = "Almost faithful. Not yet safe." or similar, with the failing cases listed.
- Every mismatch row shows the exact input, the COBOL output and the TypeScript output.
- Decorations never cover code or numbers. Keep text contrast accessible.

## Motion (build in CSS/SVG, not Figma prototype)
Every effect signals a state change or adds subtle atmosphere.
- Ambient (always on, very subtle): 3-4 faint ghosts drifting (about 10-15% opacity), two slow fog layers, tiny rising embers. Pure CSS keyframes, 8-20s loops.
- Hover: tombstone card lifts slightly and glows green; buttons get a soft flicker glow.
- Summon: a short smoke/jinn plume rises from the button (SVG or canvas, under 1.2s).
- Resurrect: TypeScript lines appear one by one as if materializing from smoke (staggered fade-in).
- While tests run: a small orbiting spirit on the progress rail.
- Verdict: match score counts up from 0 to the final value with a heartbeat pulse; failing cases rise as "ghosts" into their rows, staggered by index.
- Timing: key moments 0.6-1.2s, ease-in-out. Prefer transform and opacity only.
- **Accessibility:** respect `prefers-reduced-motion`. When set, disable ambient ghosts, fog, embers and the smoke effect, and show results instantly.
- Budget: if an effect is hard to build, simplify it. The three must-haves are the Summon smoke, the score count-up and the rising mismatch ghosts.

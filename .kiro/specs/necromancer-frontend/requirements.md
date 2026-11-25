# Requirements Document

## Introduction

The Necromancer front end is a static single page served from `public/` by the existing Node server. It is plain TypeScript bundled with esbuild into `public/app.js`, with no framework and no runtime dependency. The page has three states: The Crypt (choose a sample and a translation), The Ritual (live progress while the proof runs) and The Verdict (the result of the proof).

The page consumes the existing API: `GET /api/health`, `GET /api/samples`, `GET /api/samples/:id` and `POST /api/prove`. The server sends `Content-Security-Policy: default-src 'self'` on every response, so the page uses no inline script, no inline style attribute and no inline `<style>` element, and loads fonts, CSS and script only from its own origin.

Facts about the API that these requirements rely on:

- `matchScore` in the report is a ratio from 0 to 1 (matched / conclusive).
- The report has `complete` (true only when the run was neither aborted nor stopped by the time budget), `casesRun`, `conclusiveCount`, `matchedCount`, `mismatchCount`, `groups[]` (`group`, `conclusive`, `matched`, `inconclusive`), `mismatches[]` (`input[]`, `oracleOutput`, `candidateOutput`, `group`), `mismatchListTruncated`, `shrunkExamples[]`, `inconclusiveCount`, `seed` and `elapsedMs`.
- Progress lines carry `completed`, `target`, `group`, `matched`, `mismatches` and `inconclusive`, and never a score.
- An error line has exactly `type`, `code` and `message`. Codes seen by the page: `busy` (HTTP 429, JSON body), `oracle_unavailable` (HTTP 503 NDJSON body, or inside a 200 stream), `shutting_down` (HTTP 503 JSON body), `inconclusive`, `engine_config`, `timeout`, `internal_error` and the 400-class validation codes.
- Each translation has `variant` (`correct`, `subtle`, `naive`), `source`, `provenance.label`, `provenance.generatedWith`, `provenance.date` and `markers[]` (`curseId`, `line`). Each sample has `curses[]` (`id`, `label`, `lines[]`), `fidelityPact[]`, `trapLabel` and `cobolSource`.

## Glossary

- **Frontend**: The static single page (`public/index.html`, `public/app.css`, `public/app.js`, `public/fonts/`) that this spec defines.
- **Server**: The existing Node HTTP server that serves the Frontend and the API.
- **Crypt**: The first Frontend state, where the user picks a sample and a translation.
- **Ritual**: The second Frontend state, shown while a proof is running.
- **Verdict**: The third Frontend state, shown after the proof has ended.
- **Sample**: One of the three server-provided COBOL programs: `interest`, `payroll`, `tax`.
- **Variant**: One of the three pre-generated translations of a Sample: `correct`, `subtle`, `naive`.
- **Proof**: One `POST /api/prove` request and its NDJSON response stream.
- **Progress_Line**: A stream line with `type` equal to `progress`.
- **Report_Line**: A stream line with `type` equal to `report`.
- **Error_Line**: A stream line or JSON body with `type` equal to `error`.
- **Complete_Report**: A Report_Line whose `complete` field is `true`.
- **Incomplete_Report**: A Report_Line whose `complete` field is `false`.
- **Match_Score**: The `matchScore` field of a Report_Line, shown as a percentage.
- **Mismatch**: One entry of the `mismatches` array of a Report_Line.
- **Wake_Delay**: The interval of 3000 ms after a Proof request is sent in which no response header or first stream line has arrived.
- **Decoration**: A purely visual element (skeleton, ghost, smoke, fog) that carries no information.
- **Skeleton**: The original SVG Decoration of a skeleton hanging from a rope.
- **Ritual_Ghost**: An original SVG ghost Decoration shown during the Ritual.
- **Verdict_Ghost**: A small red original SVG ghost Decoration shown in the Verdict, one per Mismatch.
- **Reduced_Motion**: The state in which the media query `prefers-reduced-motion: reduce` matches.
- **Static_Root**: The `public/` directory served by the Server.

## Requirements

### Requirement 1: Static delivery under the Server's CSP

**User Story:** As a judge, I want the page to load and work from the existing server with no extra services, so that the demo runs from the single deployed container.

#### Acceptance Criteria

1. THE Frontend SHALL consist of `public/index.html`, `public/app.css`, `public/app.js` and font files under `public/fonts/`.
2. THE Frontend SHALL be built from TypeScript sources by esbuild into `public/app.js` with an npm script, using strict TypeScript, no `any` and no runtime dependency.
3. THE Frontend SHALL reference its script, stylesheet and fonts only through same-origin relative URLs.
4. THE Frontend SHALL contain no inline `<script>` element, no inline `<style>` element, no `style` attribute in markup, no inline event-handler attribute, and no `style` attribute written at runtime.
5. THE Frontend SHALL apply every visual state change through CSS class names defined in `public/app.css`.
6. THE Frontend SHALL include every SVG Decoration as inline markup in the DOM or as a same-origin `.svg` file, and SHALL NOT use `data:` URLs.
7. THE Frontend SHALL load JetBrains Mono (Regular and Bold) and Cinzel (Regular) as `.woff2` files from `public/fonts/` through `@font-face` rules, with `monospace` and `serif` fallbacks, SHALL obtain those font files from the `@fontsource/cinzel` and `@fontsource/jetbrains-mono` dev dependencies by copying them into `public/fonts/` with an npm script, SHALL NOT list those packages as runtime dependencies, and SHALL NOT request any font from a third-party origin.
8. THE Frontend SHALL call only `GET /api/health`, `GET /api/samples`, `GET /api/samples/:id` and `POST /api/prove`, and SHALL NOT call any third-party or paid API.
9. WHEN the deployed image is built, THE build SHALL produce `public/app.js` and copy `public/` with its fonts into the image, so that `GET /app.js` answers 200.
10. IF `GET /api/samples` fails or returns a non-200 status, THEN THE Frontend SHALL show the server message when an Error_Line is returned, otherwise a fixed message that the catalog could not be loaded, and SHALL offer a retry button.

### Requirement 2: The Crypt, sample selection and source display

**User Story:** As a developer evaluating the tool, I want to pick a sample and see its COBOL and TypeScript side by side, so that I can see what will be proven.

#### Acceptance Criteria

1. WHEN the page loads, THE Frontend SHALL request `GET /api/samples` and show the Crypt with one selectable card per returned Sample, showing `name` and `trapLabel`.
2. WHEN the Crypt is first shown, THE Frontend SHALL select the first Sample in the returned list and request `GET /api/samples/:id` for it.
3. WHEN the user selects a Sample card, THE Frontend SHALL request `GET /api/samples/:id` for that Sample and replace both source panels with the returned content.
4. WHEN a Sample detail is loaded, THE Frontend SHALL show `cobolSource` in a left panel and the selected Variant's `source` in a right panel, both in JetBrains Mono, with line numbers.
5. WHEN a Sample detail is loaded, THE Frontend SHALL show the `curses` of the Sample as labelled chips and SHALL show the `fidelityPact` entries as a list.
6. WHEN a Sample detail is loaded, THE Frontend SHALL highlight each COBOL line listed in a curse's `lines` and each TypeScript line listed in the selected Variant's `markers`.
7. THE Frontend SHALL offer exactly the three Variants `correct`, `subtle` and `naive` as a selector, with `correct` selected by default.
8. WHEN the user selects a Variant, THE Frontend SHALL show that Variant's `source` and `markers` without a new network request.
9. THE Frontend SHALL show the selected Variant's `provenance.label`, `provenance.generatedWith` and `provenance.date` next to the TypeScript panel.
10. THE Frontend SHALL NOT offer a file upload, a text area for COBOL input, or a drop zone.
11. THE Frontend SHALL NOT show the Variant's expected outcome (pass or fail) before a Proof ends.
12. IF `GET /api/samples/:id` fails, THEN THE Frontend SHALL show a message in place of the source panels and SHALL disable the Summon button.
13. WHEN the Frontend receives source text, THE Frontend SHALL insert it as text content and SHALL NOT interpret it as HTML.

### Requirement 3: Starting a Proof

**User Story:** As a user, I want a single button that starts the proof, so that I can see whether the translation is faithful.

#### Acceptance Criteria

1. THE Crypt SHALL show a button labelled "Summon" that starts a Proof for the selected Sample and Variant.
2. WHEN the user activates the Summon button, THE Frontend SHALL send `POST /api/prove` with `Content-Type: application/json` and a body containing exactly `sampleId` and `variant`.
3. WHEN the Summon button is activated, THE Frontend SHALL move to the Ritual and SHALL disable the Summon button and the Sample and Variant selectors until the Proof ends.
4. WHILE a Proof is in progress, THE Frontend SHALL ignore further activation of the Summon button.
5. WHILE the Sample detail has not loaded, THE Frontend SHALL keep the Summon button disabled.
6. WHEN the Summon button is activated and Reduced_Motion is not set, THE Frontend SHALL play a smoke plume above the button for at most 1200 ms.
7. THE Summon button, the Sample cards and the Variant selector SHALL be operable by keyboard and SHALL show a visible focus indicator.

### Requirement 4: The Ritual, stream reading and progress

**User Story:** As a user, I want live progress while the proof runs, so that I know the server is working.

#### Acceptance Criteria

1. WHEN the Proof response has status 200, THE Frontend SHALL read the body as a stream and split it on newline characters into JSON lines, handling lines split across chunks.
2. WHEN a Progress_Line arrives, THE Frontend SHALL show `completed` of `target` as text, a progress bar, and the running `matched`, `mismatches` and `inconclusive` counts from that line.
3. THE Frontend SHALL NOT compute, show or store a Match_Score while the Ritual is shown.
4. THE Frontend SHALL NOT show any percentage derived from `matched`, `mismatches` or `inconclusive` while the Ritual is shown.
5. WHILE the Ritual is shown, THE Frontend SHALL show a smoke animation built from SVG and CSS.
6. WHILE the Ritual is shown, THE Frontend SHALL show the `group` of the latest Progress_Line.
7. IF a stream line is not valid JSON or has an unknown `type`, THEN THE Frontend SHALL treat the Proof as failed, abort the request and show the Error state of Requirement 7 with a fixed message that the server sent an unreadable response.
8. IF the stream ends without a Report_Line or an Error_Line, THEN THE Frontend SHALL show the Interrupted state of Requirement 6 and no Match_Score.
9. WHEN the user leaves the page while a Proof is running, THE Frontend SHALL abort the request.
10. THE Frontend SHALL show a cancel button during the Ritual, and WHEN the user activates it, THE Frontend SHALL abort the request and show the Interrupted state of Requirement 6.
11. WHILE the Ritual is shown, THE Frontend SHALL announce progress changes to assistive technology through a polite live region updated at most once per second.

### Requirement 5: Waking the crypt

**User Story:** As a user on a free-tier host, I want to know the server is waking up, so that I do not think the page is frozen.

#### Acceptance Criteria

1. IF no response header and no stream line has arrived within the Wake_Delay after the Proof request was sent, THEN THE Frontend SHALL show the text "Waking the crypt…" and the Skeleton.
2. WHEN the response headers or the first stream line arrive, THE Frontend SHALL remove the "Waking the crypt…" text and the Skeleton.
3. THE Frontend SHALL NOT show "Waking the crypt…" when a response arrives within the Wake_Delay.
4. THE Skeleton SHALL be an original SVG drawing of a skeleton hanging from a rope, and SHALL swing as a pendulum through a CSS animation that changes only `transform`.
5. WHEN the Frontend starts loading, THE Frontend SHALL send `GET /api/health` once so that a sleeping server starts waking before the user presses Summon.
6. WHERE the initial `GET /api/samples` request takes longer than the Wake_Delay, THE Frontend SHALL show "Waking the crypt…" and the Skeleton in the Crypt until the request ends.
7. WHEN `GET /api/health` returns `oracle` equal to `unavailable`, THE Frontend SHALL show a notice in the Crypt that the oracle is unavailable, and SHALL keep the Summon button enabled so that the server's answer to the Proof decides the outcome.

### Requirement 6: The Verdict, report display

**User Story:** As a judge, I want a verdict that comes only from a real finished proof, so that I can trust the score.

#### Acceptance Criteria

1. WHEN a Complete_Report arrives, THE Frontend SHALL show the Verdict with the Match_Score, `conclusiveCount`, `matchedCount`, `mismatchCount`, `casesRun`, `seed` and `elapsedMs`.
2. THE Frontend SHALL show the Match_Score only in the Verdict and only for a Complete_Report.
3. WHEN the Verdict shows the Match_Score, THE Frontend SHALL count the displayed value up from 0 to the final value in 600 to 1200 ms, WHILE Reduced_Motion is not set.
4. WHILE Reduced_Motion is set, THE Frontend SHALL show the final Match_Score immediately with no count-up.
5. THE Frontend SHALL format the Match_Score as `matchScore` times 100 with one decimal place, rounded toward zero, so that a score below 1 never displays as 100.0%.
6. WHEN the Match_Score equals exactly 1, THE Frontend SHALL show the headline "It lives" in the match color and the line "No mismatches in N conclusive cases." with N taken from `conclusiveCount`, and SHALL NOT use wording that claims a mathematical proof.
7. WHEN the Match_Score is below 0.9, THE Frontend SHALL show the headline "Not faithful" in the mismatch color, and WHEN the Match_Score is at least 0.9 and below 1, THE Frontend SHALL show the headline "Almost faithful. Not yet safe." in the mismatch color.
8. THE Frontend SHALL show one row per `groups` entry with `group`, `matched` and `conclusive` as numbers taken unchanged from the report.
9. WHEN `inconclusiveCount` is greater than 0, THE Frontend SHALL show `inconclusiveCount` and each `inconclusiveByStatus` entry, and SHALL state that these cases are not part of the score.
10. WHEN the Verdict is shown, THE Frontend SHALL show the selected Sample name and Variant.
11. THE Verdict SHALL offer a button that returns to the Crypt with the previous Sample and Variant selected.
12. WHEN an Incomplete_Report arrives, THE Frontend SHALL show "Interrupted, not a verdict", SHALL state whether `aborted` or `budgetReached` caused it, and SHALL NOT show the Match_Score, a success headline, or a percentage.
13. WHEN an Incomplete_Report arrives, THE Frontend SHALL show `casesRun` and the Mismatch list if present, labelled as partial.
14. THE Frontend SHALL take every number it displays from a server line, and SHALL derive no number other than the percentage in criterion 5 and a count of displayed rows.

### Requirement 7: Mismatches and error display

**User Story:** As a developer, I want each mismatch shown with its exact input and both outputs, and clear errors when the proof cannot run, so that I know where the translation diverged.

#### Acceptance Criteria

1. WHEN a Report_Line has one or more Mismatch entries, THE Frontend SHALL show a table with one row per Mismatch containing `input` (all entries, in order), `oracleOutput`, `candidateOutput` and `group`.
2. THE Frontend SHALL show `oracleOutput` and `candidateOutput` in JetBrains Mono with whitespace preserved, so that leading spaces and trailing spaces are visible.
3. WHEN the Mismatch table is shown, THE Frontend SHALL give each row the mismatch color and SHALL make the first 20 rows rise into place with a staggered CSS animation that changes only `transform` and `opacity`, and SHALL show every row after the 20th with no delay.
4. WHERE the `shrunkExamples` array is not empty, THE Frontend SHALL show each shrunk example with `group`, `input`, `oracleOutput` and `candidateOutput`, labelled as the smallest failing case.
5. WHEN `mismatchListTruncated` is true, THE Frontend SHALL state that the list is truncated and show `mismatchCount` from the report next to the number of displayed rows.
6. WHEN `mismatchCount` is 0 in a Complete_Report, THE Frontend SHALL show no Mismatch table and no Verdict_Ghost.
7. WHEN an Error_Line arrives in the stream or as a JSON body, THE Frontend SHALL show the Error state with the `message` text from the line and the `code` as a label, and SHALL NOT show a Match_Score or a success headline.
8. WHEN the response status is 429 and `code` is `busy`, THE Frontend SHALL retry the Proof automatically every 5 seconds, at most 6 times, and SHALL show the text "The crypt is busy, another soul is being judged…" with the attempt number and a cancel button.
9. WHEN `code` is `oracle_unavailable`, THE Frontend SHALL show the server `message` and SHALL state that no proof was run.
10. WHEN the response status is 503 and `code` is `shutting_down`, THE Frontend SHALL show the server `message` and a button that returns to the Crypt.
11. WHEN `code` is `inconclusive`, `timeout`, `engine_config` or `internal_error`, THE Frontend SHALL show the server `message` and the `code` label.
12. IF the response is not 200 and its body is not a valid Error_Line, THEN THE Frontend SHALL show a fixed message containing the HTTP status number, and no Match_Score.
13. IF the network request fails before any response arrives, THEN THE Frontend SHALL show a fixed message that the server could not be reached, and no Match_Score.
14. WHEN an Error_Line arrives after Progress_Lines, THE Frontend SHALL discard the progress values.
15. THE Frontend SHALL insert server-provided strings as text content and SHALL NOT interpret them as HTML.
16. WHEN the user activates the cancel button during the busy retries of criterion 8, THE Frontend SHALL stop retrying, SHALL NOT send any further Proof request, and SHALL show the Interrupted state of Requirement 6.
17. WHEN the last of the 6 retries of criterion 8 also returns status 429 with `code` `busy`, THE Frontend SHALL show the busy error with the server `message` and a button that returns to the Crypt.

### Requirement 8: Ritual ghosts

**User Story:** As a user, I want the ritual to feel alive as the proof advances, so that waiting is part of the experience.

#### Acceptance Criteria

1. WHILE the Ritual is shown and Reduced_Motion is not set, THE Frontend SHALL show Ritual_Ghosts drifting upward and sideways behind the content.
2. WHEN progress increases, THE Frontend SHALL increase the number of visible Ritual_Ghosts and decrease the duration of their drift animation, in discrete steps selected by CSS class names.
3. THE Frontend SHALL show between 2 and 12 Ritual_Ghosts, with the count computed from the ratio of `completed` to `target` and from no other value.
4. WHEN the Ritual ends, THE Frontend SHALL fade the Ritual_Ghosts out and remove them from the DOM.
5. THE Ritual_Ghost SHALL be an original SVG drawing, in at least two distinct shapes, and SHALL NOT imitate an existing character.

### Requirement 9: Verdict ghosts

**User Story:** As a user, I want each failed case to haunt the verdict, so that mismatches are felt without hiding the data.

#### Acceptance Criteria

1. WHEN a Report_Line with `mismatchCount` greater than 0 is shown, THE Frontend SHALL show one small red Verdict_Ghost per displayed Mismatch, rising once, up to a maximum of 20 on screen.
2. WHEN a Report_Line has more than 20 Mismatch entries, THE Frontend SHALL show 20 Verdict_Ghosts.
3. WHEN the Match_Score equals exactly 1, THE Frontend SHALL show no Verdict_Ghost.
4. THE Frontend SHALL NOT show a Verdict_Ghost for an Error_Line.
5. THE Verdict_Ghost SHALL be an original SVG drawing in the mismatch color.

### Requirement 10: Decoration safety and accessibility

**User Story:** As a user with motion sensitivity or a screen reader, I want decorations that never interfere with content, so that the page stays usable.

#### Acceptance Criteria

1. THE Frontend SHALL mark every Decoration with `aria-hidden="true"`, and SHALL NOT make a Decoration focusable.
2. THE Frontend SHALL place every Decoration behind text content in stacking order and SHALL set `pointer-events` to `none` on every Decoration.
3. THE Frontend SHALL position Decorations so that no Decoration overlaps the Match_Score, the Mismatch table or a source panel with an opacity above 0.15 over text.
4. THE Frontend SHALL animate Decorations only through the CSS properties `transform` and `opacity`.
5. WHILE Reduced_Motion is set, THE Frontend SHALL remove the Skeleton swing, the Ritual_Ghost drift, the smoke plume, the progress count-up and the row rise animation, and SHALL fade each Decoration in over at most 300 ms or show it static.
6. THE Frontend SHALL use text and background colors with a contrast ratio of at least 4.5:1 for body text and code.
7. THE Frontend SHALL convey match and mismatch through text labels in addition to color.
8. THE Frontend SHALL announce a change of state (Crypt, Ritual, Verdict, Error) to assistive technology through a live region and SHALL move keyboard focus to the new state heading.
9. THE Frontend SHALL draw all SVG Decorations as original artwork, as inline SVG in the DOM or as same-origin .svg files, with no data: URLs and no third-party artwork.

### Requirement 11: Visual design and responsive layout

**User Story:** As a judge on any device, I want the page to look like the Crypt theme and remain readable on a phone, so that the demo works anywhere.

#### Acceptance Criteria

1. THE Frontend SHALL use a near-black background between `#080808` and `#101010`, the match color `#38F888`, and the mismatch color `#FF777A`.
2. THE Frontend SHALL use Cinzel Regular for the logo and screen titles only, and JetBrains Mono for code, numbers, labels, buttons and tables.
3. THE Frontend SHALL name the three states "The Crypt", "The Ritual" and "The Verdict" in their headings.
4. THE Frontend SHALL show the labels "Pre-generated with Kiro" next to the Variant selector, taken from `provenance.label` when the Server returns that text.
5. WHILE the viewport width is at least 900 px, THE Frontend SHALL show the COBOL and TypeScript panels side by side.
6. WHILE the viewport width is below 900 px, THE Frontend SHALL stack the COBOL and TypeScript panels vertically.
7. WHILE the viewport width is 360 px, THE Frontend SHALL show all content with no horizontal scrolling of the page, and SHALL scroll code panels and the Mismatch table horizontally inside their own containers.
8. THE Frontend SHALL show interactive controls with a touch target of at least 44 by 44 CSS pixels.
9. THE Frontend SHALL show only the copy defined by this spec or returned by the Server, and SHALL NOT show invented statistics, testimonials or claims.

### Requirement 12: Verification of the Frontend

**User Story:** As the maintainer, I want the logic of the page tested without a browser and against the real server, so that the hard rules are enforced by tests.

#### Acceptance Criteria

1. THE Frontend SHALL keep pure logic (NDJSON line splitter, line classifier, score formatter, ghost count functions, view-state reducer) in modules separate from DOM code, so that Vitest can test each module without a browser.
2. FOR ALL byte sequences made of valid NDJSON lines split at arbitrary chunk boundaries, joining the splitter output SHALL equal the sequence of lines in the original text (round-trip property).
3. FOR ALL `matchScore` values in the range 0 to 1, the score formatter SHALL return a string that parses to a number less than or equal to `matchScore` times 100 and within 0.1 of it, and SHALL return "100.0" only when `matchScore` equals 1.
4. FOR ALL sequences of valid stream lines, THE view-state reducer SHALL expose a Match_Score only when the sequence contains a Complete_Report, and SHALL expose none while the state is Ritual.
5. FOR ALL values of `mismatchCount` and the length of `mismatches`, the Verdict_Ghost count function SHALL return `min(20, number of displayed Mismatch entries)`, and SHALL return 0 when `matchScore` equals 1.
6. FOR ALL values of `completed` and `target` with `0 <= completed <= target` and `target > 0`, the Ritual_Ghost count function SHALL return an integer from 2 to 12 that does not decrease as `completed` increases.
7. THE test suite SHALL include a test that fails if `public/index.html`, `public/app.css` or the esbuild output contains an inline `style` attribute, an inline `<script>` body, a `<style>` element, or a URL to a third-party origin.
8. THE test suite SHALL include a test that fails if a Decoration element lacks `aria-hidden="true"`.
9. THE test suite SHALL include a test that fails if `public/app.css` animates a property other than `transform` or `opacity` inside a Decoration keyframe rule.
10. THE test suite SHALL include a smoke test that starts the Server with a fake oracle, loads `GET /`, `GET /app.js`, `GET /app.css` and a font file, and checks status 200 and the content types from the Server's static table.
11. WHEN the sample equivalence suite runs, THE Frontend build SHALL NOT change its result.

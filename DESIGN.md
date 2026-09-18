# Local workbench design

The workbench takes workflow cues from Evalite and visual cues from the inspected TypeSafe console/playground. Inter is self-hosted in regular, medium and semibold weights under the SIL Open Font License. White working surfaces and a near-white sidebar use charcoal text and thin neutral dividers. Black identifies primary actions; blue identifies links and keyboard focus. Green is reserved for correct outcomes, muted red for errors, and amber for partial success. Monospace is reserved for JSON and traces.

The desktop sidebar is 256px, with light-gray selected rows and a persistent black Create jeval action. The header is 56px; content uses compact labels and controls, with flat editing/results panels rather than rounded cards. Forms retain bounded widths, generated fields and native controls. Focus uses a visible blue outline. Secondary text and placeholders use sufficiently dark neutral colors. On mobile, sidebar navigation scrolls horizontally and forms stack without page overflow.

Desktop places the editable judgment and cases beside saved results and run history. On narrow screens these stack in editing order. Controls use explicit labels, visible keyboard focus, disabled/loading states, and a status region for save and request errors. Tables can scroll horizontally; raw payloads wrap and have a bounded scroll area.

Evaluations support Noul, Choice and Score questions together. Empty states explain what to do without inventing results. Example expectations follow an authored definition. Best-run labels apply only to complete runs on the same case set.

Remaining product choices: hosted sharing and production server packaging. Visual review covered desktop/mobile empty states and Choice definition, cases, and results; real-provider result acceptance requires an API key.

## Multi-evaluation navigation

The home at `/` is an evaluation index with a creation form, name search, status filter, and a compact results table. A muted persistent sidebar lists saved evaluations; it becomes horizontally scrollable navigation on small screens. The Question types filter distinguishes individual primitives and mixed Jevals.

An evaluation's `/evaluations/:id/:page` routes separate Results, Cases, Definition, and Runs. Results is the default. Runs open immutable snapshots through `?run=:id`. Definition and case editing reuse the existing controls and generated forms. Save state is updated directly without replacing focused controls. Navigation commits preserve any edits made during pending requests. Drafts survive navigation in memory, with unload warnings; durable updates use revision checks.

The sidebar footer holds a persistent Create jeval button that opens the shared creation dialog on every page without navigating away. WebMCP registration status is retained internally for diagnostics and is not displayed. API-key status explicitly reports presence, not authentication. The page does not present a blended accuracy across different evaluations.

## Typed question collections

Creation is an accessible native modal that asks for the evaluation name and optional description. Definition owns a questions list and Add question action, with Noul, Choice and Score available. Stable question IDs connect definitions, case expectations, and response answers. Cases select which question to label; an unset expectation is explicit and blocks running. Results select a historical question independently of current definition changes. Correctness and best-run rankings are per question; resource totals cover the batched request. Existing definitions migrate to one question while historical snapshots stay intact.

## Run outcomes

Results, run history and the evaluation index distinguish partial success with an amber warning triangle and full failure with a red X. Visible text labels accompany the decorative icons. Partial results retain valid question metrics and explain why the run cannot qualify as best. The existing failed-status filter includes both partial and full failures.

## Choice editing and results

Choice extends the existing developer workbench controls. Definition presents each option as a labeled text input and description textarea, separated by a quiet border, with Add option and individually labeled Remove option actions. The editor explains that labels must be distinct and at least two options are required before running. Cases use the selected question's option labels in the Expected answer select; correctness matches the selected option against this authored expectation.

Choice results retain the per-question selector and show Choice, Confidence, Expected, and Result columns. An inline Probabilities disclosure lists each option's probability with aligned numeric values. Correct/Incorrect/Error text remains visible with the existing verdict colors. The summary names Multiclass Brier, provides optional Confusion counts, and explicitly states that confidence describes the distribution rather than establishing correctness.

Case-name links open the owning request trace, displaying the shared request/response and request error alongside the selected question ID and answer. This keeps a question's answer distinct from the batched request; tokens, latency, and cost describe the whole request once. Choice tables and disclosures inherit horizontal scrolling on narrow screens, wrapped bounded raw traces, and the existing visible keyboard focus treatment for inputs, selects, buttons, and disclosure summaries.

Run history begins with 20 compact entries and offers Load older runs in the existing history column. Loading disables that control while retaining its position; focus returns to it or the history heading after the final page. A best comparable run outside the loaded page stays visible as a pinned entry. Results fetch raw traces only when a case is opened, keeping historical navigation responsive.

Score inherits the existing question editor and result table. Its rubric shows zero-based ordered levels with labeled descriptions and explicit move/remove controls; level changes clear expected numeric labels for review. Cases offer expected levels and an optional numeric tolerance. Results show fractional score, confidence, expandable level probabilities, absolute error and within/outside-tolerance text. Summary uses pass rate and mean absolute error in place of categorical accuracy/Brier. Home’s Question types filter derives mixed status from distinct primitive types and includes Score only.

## Console style verification

The September 18 styling pass preserves authoring, results, history, disclosure lifecycles and WebMCP. Reference observations are in `docs/console-style-reference.md`. The mechanical detector flags Inter as common; the approved TypeSafe reference explicitly uses Inter, so this is an intentional choice. Self-hosted font assets avoid runtime font-service requests. Isolated simulated-provider browser acceptance covers desktop/mobile layout, native tools, controls, modal focus and navigation.

## Action buttons

Black filled buttons identify saving, running, creation, and additions within an editing section. Remove question, case, state field, option, and rubric level use white buttons with red text and borders. Navigation, cancellation, reordering, exports, and reversible archive actions stay neutral. Hover styles apply only to enabled buttons; keyboard focus stays blue, and disabled controls retain their position.

## Focused creation forms

Add question and Add case open native modal forms with isolated drafts, explicit Add and Cancel buttons, Escape dismissal, and focus restoration. Question creation selects Noul, Choice, or Score and shows its relevant criteria. Case creation uses the shared state schema and offers expectations for every question, with labels optionally completed later. The form checks for changes to the evaluation before committing. WebMCP can open/cancel these forms; existing saved-record tools remain available.

SDK request mappings appear in small muted monospace text at the right of field headings: model, state paths, instructions, primitive type, and criteria paths. Friendly accessible names stay unchanged. Names, descriptions, expected answers, tolerance, and the Noul threshold belong to Jevals and do not receive SDK request labels.

In Add case, fields with nonblank schema defaults appear in a Prefilled state section after the expected answers. Fields without defaults appear first. The values remain editable and are saved into the case; they do not become live shared context.

All native dialogs dismiss when a primary pointer gesture begins and ends on the backdrop. Clicking dialog padding or dragging from inside the form does not dismiss it. Escape and explicit Cancel/Close remain available; native modal focus stays trapped and dismissal restores the opener.

# jevals

A local TypeScript evaluation workbench for Jev. Not affiliated with TypeSafe.

## Start

Requires Node.js 22.13 or newer (SQLite support).

```sh
npm install
cp .env.example .env
# Set TYPESAFE_API_KEY in .env
npm run dev
```

Open http://localhost:4317. You can create, edit, and save evaluations without a key. Credentials stay on the server; restart after changing `.env`. “API key configured” means a key is present, not that authentication has been verified.

## Seed examples

```sh
npm run seed
# Or choose a separate database:
npm run seed -- --db ./sandbox/jevals.sqlite
```

Adds seven curated Jevals drawn from the development workspace: sandwich classification, mixed Noul/Choice sandwich classification, room minifridges, personal-information detection, distributed-systems experience, bug severity, and support-ticket quality. Definitions, descriptions, state schemas, cases and reviewed expected answers are included. Refund requests and the manually added beef-patty case are excluded. No credentials, saved runs or traces are included, and seeding makes no API requests.

Repeated seeding skips previously seeded examples, even after you rename or edit them. Existing Jevals with the same name are adopted without overwriting them. The default database is `.data/jevals.sqlite`; `JEVALS_DB` or `--db` selects another path. Restart the server if needed to refresh its evaluation list. These are illustrative answer keys to review, not an accuracy benchmark. The packaged `jevals seed` CLI remains part of release packaging work.

## Workflow

The home page lists saved evaluations with search, latest-run status filtering, case counts, and latest results. Create a named evaluation collection and use the persistent sidebar to switch evaluations. Add typed questions in Definition.

Each evaluation has a stable ID, its own schema/cases, and its own history:

- **Results:** latest or selected historical run, probabilities, correctness, false positives/negatives, Brier error, tokens, latency, cost estimate, raw traces, and JSON export.
- **Cases:** case list, generated state form or JSON editor, expected yes/no (Noul) or option-label (Choice) answers and rationales per question.
- **Definition:** a collection of typed questions with per-question criteria/thresholds, shared model, and state schema.
- **Runs:** saved snapshots and best comparable run, ranked by accuracy then lower Brier error.

Definitions and cases share **Save changes**. Drafts survive switching evaluations/tabs in memory; save to preserve them across reloads. Saved updates require the expected revision, rejecting stale writes instead of overwriting newer definitions. A run uses an immutable snapshot; failed or incomplete runs never qualify as best. No aggregate accuracy is calculated across unrelated evaluations.

Define state fields once (key, label, text/long-text type, required flag, default). New cases inherit defaults. Form/JSON views retain extra keys, and renaming/removing fields preserves old JSON values. Defaults never rewrite existing cases. Incomplete case drafts can be saved; missing required/non-text schema values block runs. Without a schema, use plain text or JSON.

The starter sandwich evaluation uses five authored examples and an explicit definition. These are illustrative fixtures, not an official TypeSafe benchmark or universal answer to whether hot dogs are sandwiches. Independently review expected answers before treating accuracy as evidence. Best on development cases does not establish held-out reliability.

## Storage and requests

SQLite lives at `.data/jevals.sqlite`. The legacy single evaluation and all run snapshots migrate atomically into the multi-evaluation model. Migration backups are at `.data/backups/pre-evaluation-home.sqlite` and `.data/backups/pre-question-collections.sqlite`. No API key is stored in SQLite.

Each distinct case has its own state and request. SDK retries are disabled so each trace corresponds to one attempt, with a 30-second timeout. Different Jevals can run concurrently; one run can execute per Jeval. Interrupted runs become failed on restart. The UI polls during runs.

Cost estimates use documented September 17, 2026 pricing for returned model `jev-1.13.0`: $0.042 per million input tokens, free output tokens. Unknown-model pricing and failed-request costs are unavailable. Brier error on partial runs covers successful requests only; accuracy requires all cases to succeed. Latency is summed request wall time. JSON reports contain case data and raw traces; review before sharing. No hosted sharing is implemented.

## WebMCP

The page registers 18 imperative tools using `document.modelContext.registerTool`, with feature detection for the deprecated `navigator.modelContext` surface. Browser support is experimental; registration status is retained in the document’s `data-webmcp-status` attribute for diagnostics. No fake polyfill or remote MCP server is installed.

- `get_eval_framework`, `list_evaluations`, `get_evaluation`, `list_evaluation_runs`
- `create_evaluation`, `update_evaluation_definition`
- `archive_evaluation`, `restore_evaluation`
- `upsert_evaluation_question`, `remove_evaluation_question`
- `upsert_evaluation_case`, `remove_evaluation_case`
- `run_evaluation`, `get_run`, `export_run`, `open_evaluation`
- `open_evaluation_creation`, `close_evaluation_creation` (accessible creation modal)

Agents can read schemas and definitions, propose/create evaluation collections with Noul, Choice, and Score questions, supply complete cases with independently reviewed booleans or option labels keyed by question ID, update definitions/cases with the current revision, run saved evaluations, and inspect immutable results. Updates and runs are blocked when the same evaluation has unsaved UI edits. Run tools carry a consequential-action hint: they send states to TypeSafe and incur cost. They return a run ID immediately; accepted server runs continue if the browser tool is cancelled. Credentials are never exposed by tools. Registration uses an abort controller for HMR teardown. Tool errors return structured `{isError, error}` JSON.

Use a browser/agent that supports WebMCP. Registration and actual native discovery/execution were verified in Chrome 153 with `--enable-blink-features=WebMCP`. Agents invoke browser-discovered tools; an ordinary HTTP client is not a WebMCP client.

Reference: [Chrome imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api).

## Checks

```sh
npm run typecheck
npm test
npm run test:browser
```

Browser checks require installed Google Chrome with WebMCP support. They build the client and launch an isolated static server/database and simulated Jev provider, exercising native WebMCP plus UI flows without sending real Jev requests or changing your workbench.

```sh
npm run build
npm run preview
```

`dev` uses Vite middleware. `preview` serves the built browser bundle with the same local API. Both bind to localhost; this is a local workbench, not a deployment package. Hosted sharing and authentication remain future work. Existing `accuracy(results)` remains exported from `index.js` for package compatibility; no npm release was published.

## Typed question collections

New jeval on home and Create jeval in the persistent sidebar open the same accessible name-only creation modal. In Definition, use Add question to add Noul, Choice, or Score questions. Every question has a stable ID, name, instructions, criteria, and its own threshold. The evaluation shares one model and state schema. Cases hold a shared state plus an `expectations` map keyed by question ID, containing `{ value, rationale }`. Adding a question does not invent expected labels; every case must have an answer for every question before running.

All questions are sent in one request per case. Results and best-run rankings are scoped to a selected question. Tokens, latency and cost are recorded once per request. JSON reports include `questionMetrics` for each ID. Comparison requires the same question IDs/types, states and expected values; prompt versions can be compared without combining distinct judgments into one accuracy.

Saved definitions migrate to one question with ID `judgment`; labels and rationales move into the expectations map. Historical run JSON is not rewritten. Top-level `instructions`, `yes`, `no`, `threshold` and case `expected`/`rationale` remain first-question compatibility projections for earlier consumers; new integrations should edit questions and expectations. Legacy creation requests still work. Noul, Choice, and Score authoring and execution are supported.

## Archive and restore

Definition has an Archive evaluation action. Archived evaluations are hidden from the active home list and sidebar; use Show → Archived or All evaluations on the home page to inspect and restore them. Restore is also available in an archived evaluation's Definition. Cases, question definitions and historical runs are preserved. Save unsaved changes before archiving/restoring; updates require the current revision. Restore before starting a new run. Already accepted runs can finish. WebMCP exposes archive/restore with the same revision and draft protections. No permanent deletion is implemented.

Sidebar jeval rows reveal a separate play button on hover or keyboard focus; touch devices show it without hover. Clicking the name only navigates. Play runs the saved collection and opens its exact result snapshot; save target drafts first. Missing keys, target drafts or a run of that same jeval disable it. Different jevals can run concurrently. Resource/request checks use a simulated provider, not live Jev calls.

Jevals have an optional description editable in Definition and through WebMCP create/update. About this jeval beside the title reveals the full description in a desktop popover or mobile modal, with line breaks preserved. Descriptions are documentation, not model instructions; they are included in saved definitions and new run snapshots. Save/error notices are separate. Blank descriptions add no placeholder.

Run loading state and duplicate-run protection are scoped by evaluation ID. Different jevals execute concurrently; overlapping starts of the same jeval return a conflict. Request usage and histories remain isolated. Native browser tests hold two simulated responses open and verify both evaluations reach the provider before either finishes.

## Typed questions

Noul, Choice, and Score can be mixed within one Jeval. Add questions in Definition and label each question in Cases; all questions share one provider request per case. Choice uses 2–255 distinct option labels and text descriptions before running. Its expected answer must match an option exactly. Renaming or removing an option in the UI clears affected expectations for review. Score uses ordered rubric levels.

Choice results show the selected option, separate confidence, and the full probability distribution. Accuracy compares selected options with reviewed labels. Multiclass Brier sums squared probability errors across options (range 0–2); confusion counts show expected versus selected options. Noul retains binary Brier and threshold-based error counts. Missing or malformed answers fail independently and preserve usable siblings and raw traces. A trace shows both the request error and selected answer error. Resources cover the whole request once. Best is per question and requires a fully successful run on the identical case/answer-key/question/option-label dataset.

Canonical TypeScript definitions in `src/types.ts` require keyed questions, expectations and answers without first-Noul projections. `src/snapshots.ts` decodes historical input and encodes compatibility records at persistence/HTTP seams. Existing run JSON is preserved, including exports. `src/questions.ts` owns typed judgment semantics; `src/question-presentation.ts` owns typed field and display rules. Validation, persistence, SDK integration and native WebMCP acceptance use isolated simulated-provider fixtures; they do not prove model accuracy.

## Bounded run history

Home and evaluation reads use rebuildable, versioned SQLite summaries rather than full run snapshots. History starts with 20 runs; Load older runs fetches the next page. Cursor order follows original insertion, so progress updates do not move runs between pages. Best-run ranking considers all comparable completed runs, including older pages; an older best remains available as a pinned history entry.

Results load one selected run without request/response payloads. Opening a case fetches its raw trace on demand. Navigation and selection changes discard stale history, selection, and trace responses. Original snapshots and JSON exports remain intact. Startup backfills derived summaries without rewriting historical JSON.

WebMCP `list_evaluation_runs` returns summaries with `nextCursor`, accepting `before` and a page size of 1–50. `get_evaluation` returns the first page; `get_run` and `export_run` intentionally return full records. The legacy `/api/workbench` compatibility endpoint still returns full history.

## Score questions

Score uses 2–10 ordered nonempty text descriptions. Level positions start at zero; responses include a fractional score, per-level probabilities and separate confidence. Definition supports adding, editing, moving and removing levels. Adding/removing/moving levels clears that question’s current expectations for review; historical snapshots remain unchanged.

Cases select an expected level and may set a tolerance in level units (default 0.5; zero requires an exact score). WebMCP can also provide fractional numeric expectations. Values must lie within the rubric, and tolerance must be finite, nonnegative and no larger than its span. Results show score, confidence, distribution, absolute error, and within/outside-tolerance verdicts. Mean absolute error averages valid answers; pass rate is unavailable until every case succeeds. Score does not use categorical Brier error. Best comparable fully successful runs rank by lowest mean absolute error, then highest pass rate, then newest. Score rubric descriptions/order and explicit tolerance join the comparison key.

The browser acceptance fixture exercises Noul + Choice + Score in one request per case using a simulated provider. Score has not yet been verified against the live provider in this workbench. Reference: [Score documentation](https://docs.typesafe.ai/primitives/score).

## Question authoring

Browser structural edits and WebMCP question replacements share `src/question-authoring.ts`. Changing a primitive clears its expected answers; removing or renaming Choice labels clears only answers using removed labels. Adding/removing/reordering Score levels clears that question’s scores and tolerances. Removing a question clears its answer keys. Historical runs remain unchanged. Invalid question edits commit nothing.

Wording edits preserve reviewed answers for prompt comparisons. Whole-question Score replacements detect reordering when the existing descriptions are permuted; replacing descriptions at the same positions is treated as wording. If reordering and rewriting simultaneously through WebMCP, reorder first, then rewrite, so the old scores are cleared. Missing answers must be reviewed before running.

## Shared ranking and disclosures

`src/run-ranking.ts` defines eligibility, metric precedence and deterministic ties for both in-memory selection and SQLite summary queries. Score ranks lower MAE then higher pass rate; Noul/Choice rank higher accuracy then lower Brier error. Only fully successful comparable runs qualify. Equal metrics favor the newest creation timestamp, then greatest stable run ID, regardless of input or insertion order. SQLite still ranks over all cached summaries without loading traces.

`src/disclosures.ts` owns creation, glossary and About lifetimes. Native dismissal events release deferred renders and restore trigger focus; clicking into an editing field preserves that field’s focus. Refreshes keep open disclosure controls mounted. Queued close events cannot dismiss a reopened disclosure.

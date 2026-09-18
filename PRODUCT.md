# jevals

## Platform
web

## Purpose
A local TypeScript workbench for experimenting with and evaluating TypeSafe Jev typed judgments.

## Users and Jobs
Developers editing questions and criteria, trying reviewed examples, inspecting requests, and comparing saved results. The first user is Nick working locally.

## Capabilities and Constraints
The current slice supports Noul, Choice and Score, including mixed-question Jevals. Store editable cases and immutable runs in SQLite. Capture probabilities, expected boolean answers, accuracy/error metrics, request payloads, tokens, latency, and estimated cost. Surface the best comparable complete run and export JSON. API credentials belong on the server. Example labels use an explicit authored definition, not a universal sandwich taxonomy. One synthetic mixed-primitives live-provider smoke has passed; this is not broad accuracy validation.

## Stack
TypeScript requested by the user. Express, Vite, Node SQLite, and the official TypeSafe SDK selected for the smallest local implementation. Git tracks the project and a private GitHub repo holds the review candidate. No npm publication has been performed.

## Brand Commitments
User supplied Evalite as a workflow and setup reference. Familiar light developer UI is an implementation assumption; optional preference question remains unanswered.

## Product Principles
Keep experiments reviewable. Preserve run inputs and definitions. Keep correctness separate from model probability. Compare only equivalent case sets. Build one usable feedback loop before extending to other primitives.

## Authorized navigation and agent integration
The user requested an evaluation home and sidebar together, with WebMCP so browser agents can reason about creating evaluations. Stable evaluation IDs, per-evaluation histories, routed Results/Cases/Definition/Runs pages, revision-protected definitions, and in-memory drafts now support multiple Noul evaluations. WebMCP exposes the current workflow through native feature-detected tools; Choice is enabled alongside Noul; Score execution remains future work.

## Typed collections (authorized)

Evaluations are collections of typed questions sharing case state and schema, rather than one primitive category. The name-only creation dialog leads to Definition, where Noul, Choice and Score questions can be added. Expected answers and rationale are keyed by stable question ID. Noul and Choice questions execute together once per case and have separate metrics. WebMCP exposes question creation/update/removal and keyed case expectations. Migration preserves existing labels and run JSON. No live-provider acceptance is implied by simulated batching checks.

## Noul foundation

Question validation, provider question encoding, independent answer decoding, metrics and best-run eligibility share one question module; persistence and HTTP adapters decode historical snapshots separately. Valid sibling answers survive missing or invalid answers. Only fully successful runs qualify as best; incorrect judgments count as successful execution, not correct results. Derived outcomes distinguish partial success from full failure without rewriting historical snapshots. Resources are counted once per request. Noul, Choice and Score are enabled.

## Workspace and run foundation

The evaluation workspace owns drafts, revision baselines, navigation reconciliation and per-Jeval write ownership for the browser and WebMCP adapters. Human edits made during pending writes remain unsaved against the newly accepted revision. Agent edits recheck draft safety after their read. Focus and rendering remain in the browser adapter.

Run execution owns saved snapshot acceptance, per-Jeval admission, provider calls, progress and finalization. Initial persistence must succeed before acceptance; admission is released even when initial or final persistence fails. Different Jevals can run concurrently; duplicate runs on the same Jeval remain blocked.

## Canonical typed contract and Choice

In-memory Jeval definitions require questions and keyed expectations; request results require keyed discriminated answers. Historical first-Noul projections are handled by the snapshot adapter and retained in stored/exported compatibility records. Historical run JSON is read without rewriting it. Request errors remain distinct from selected-question answer errors in traces.

Choice definitions use distinct option labels with text descriptions; runnable definitions require 2–255 options. Expected answers are exact option labels. Results preserve selection, probability distribution, and separate confidence, with accuracy, multiclass Brier (sum of squared errors across options, 0–2), and confusion counts. Probability sums allow 0.02 rounding tolerance; malformed distributions or nonmaximal selections fail that answer independently. Resources are counted once per shared request. Best-run dataset comparability includes Choice option labels; partial or failed runs remain excluded. UI option-label rename/removal clears affected expectations for review. Score remains deferred. Acceptance uses an isolated database and simulated provider through the real SDK and native WebMCP; no new live-provider acceptance is claimed.

History must remain usable as saved runs grow: load summaries in bounded pages, keep best comparable results discoverable across the entire history, and load raw traces only on inspection. Preserve exact historical exports.

Score evaluations use ordered rubrics, reviewed numeric expectations, optional tolerance, mean absolute error and within-tolerance pass rate. Confidence remains separate from correctness.

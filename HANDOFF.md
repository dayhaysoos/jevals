## Release preparation (September 18, 2026)

Git baseline and prepare-release branch now exist. The private GitHub repo is dayhaysoos/jevals. Version 0.1.0 is a review candidate, not an npm publication. CLI/built assets/seed/agent skill are packaged; detailed evidence and limitations are in docs/release-evidence.md. One synthetic live mixed request passed for all three primitives. These current facts supersede older uninitialized-Git, disabled-Score and simulation-only notes below. Runtime user data and keys remain ignored and excluded from package contents.

## Ranking and disclosure deepening (September 18, 2026)

`src/run-ranking.ts` shares metric precedence/eligibility between in-memory ranking and parameterized SQLite plans. Ties use creation timestamp then stable run ID descending (an intentional replacement for input/insertion ordering). Queries remain scoped to evaluation and comparable dataset and read summaries, not raw traces. No cache migration is required. `src/disclosures.ts` replaces three independent disclosure flags and repeated close/render/focus lifecycles; creation, glossary and responsive About use native close/toggle events. It owns deferred renders, safe focus restoration and queued close/reopen protection.

## Shared question authoring (September 18, 2026)

`src/question-authoring.ts` owns transactional structural edits and expected-answer invalidation for browser controls and native WebMCP upserts/full collection replacements. Choice clears removed labels selectively; Score clears scores/tolerances on level count changes or permutations; type changes/removal clear the target keys. Wording edits preserve labels. Whole replacements with simultaneous Score reorder and rewrite are ambiguous without stable level IDs: tools should reorder first, then rewrite. Case objects remain mounted, and historical run snapshots are never changed. Validation concerns only questions/expectations so unrelated incomplete draft fields do not block authoring.

## Score support (September 17, 2026)

Score is enabled alongside Noul/Choice. Canonical question/answer/expectation types cover ordered rubrics, fractional responses, and numeric expected values with optional tolerance (default 0.5). Existing questions module owns authoring validation, SDK request encoding, independent decoding, outcome and metrics; presentation owns typed fields/displays, with client keeping DOM interaction. No generic plugin registry or additional pass-through modules were introduced. Best ranking uses lowest MAE then pass rate; Store projection version 2 rebuilds summaries without rewriting raw history. Dataset comparability includes Score scale and tolerance. WebMCP reuses the existing 18 tools. Tests use isolated simulated providers, not paid/live calls.

## Bounded history foundation (September 17, 2026)

Store owns transactional, rebuildable run summaries and trace-free selected views. Routine home/history/results reads avoid full snapshots. History uses stable insertion cursors, starts with 20 summaries, and supports older pages. Best ranking searches all comparable successful runs, with pinned access when best lies outside the loaded page. Raw snapshots and exports remain preserved; traces load per case on demand. Workspace rejects stale pages/selections and client rejects stale traces after navigation. Native WebMCP adds list_evaluation_runs (18 tools total). Legacy full-record inspection/export and /api/workbench remain intentional compatibility paths.

## Current typed contract and Choice support (September 17, 2026)

Canonical TypeScript definitions now require keyed questions, expectations, and discriminated Noul/Choice answers; first-question legacy projections belong to `src/snapshots.ts`, used by persistence and HTTP adapters. Historical run JSON and export snapshots remain unchanged. Selected-question results retain the owning request trace/error separately from the answer error.

Choice and mixed Noul/Choice Jevals are enabled in the UI and native WebMCP. Option labels/descriptions generate matching expected-answer selects. Results show selection, probabilities, confidence, accuracy, multiclass Brier and confusion counts. Resources are counted once per case request; best-run comparison includes option labels and accepts only fully successful runs. Score remains disabled. Browser/SDK acceptance uses an isolated database and simulated provider, without paid requests.

# jevals: project handoff

Updated September 17, 2026.

## Implemented local baseline — September 17, 2026

The user subsequently authorized building the TypeScript Noul workbench. This section supersedes the initial documentation-only and unimplemented-state notes below. Git remains uninitialized; no package publication was performed.

See README.md for startup and limitations. The baseline uses Express, Vite, the official TypeSafe SDK, and Node SQLite. It includes an editable Noul suite, five authored sandwich cases with a supplied definition, durable suite storage, immutable run snapshots, per-case request traces, correctness/Brier/error metrics, tokens/latency/estimated costs, comparable best-run surfacing, and JSON export. The user configured an API key; presence is not authentication verification. This implementation pass uses simulation rather than live Jev requests. SDK-path integration uses simulated provider responses in isolated temporary databases.

Each evaluation now supports an evaluation-level state schema with generated case forms, raw JSON editing/preview, new-case defaults, required-field validation before requests, and preservation of old/extra keys during schema changes.

Multiple evaluations now have stable IDs, a searchable/filterable home, persistent responsive sidebar, Results/Cases/Definition/Runs routes, revision-protected saves, and independent histories. Native WebMCP exposes 18 current-workflow tools; discovery and execution were tested in enabled Chrome 153 against an isolated DB and simulated provider. The legacy local suite and run snapshots were migrated without changing cases or run definitions, with a backup under .data/backups/. See README.md for details and scripts.

Evaluations are now typed-question collections: name-only creation modal, Definition question list/Add question, Cases expectations keyed by stable question ID, and selected-question Results. Multiple Noul questions batch into one request per case. Definition migration preserves original case content and historical run JSON. Question update/removal has revision protection and unsaved-draft guards through WebMCP. 28 unit/integration tests and native browser checks pass, including batching, metric isolation, usage counted once, missing-label validation, snapshot preservation, and rationale unset/reselection persistence.

The architecture foundation now uses src/questions.ts for Noul semantics, src/workspace.ts for shared browser/WebMCP draft and revision policy, and src/run-executor.ts for durable admission and execution. Workspace interleaving tests and SQLite persistence-failure probes supplement the existing SDK and browser checks. Accepted HTTP runs execute independently of tool cancellation; final persistence errors are logged without retaining admission locks. The workspace retains editable definitions across navigation and only the current Jeval's run history in memory.

Choice, Score execution, hosted sharing, authentication, and production packaging remain future work.

## Purpose

Build a small JavaScript evaluation toolkit for TypeSafe's Jev model: run reviewed
examples through the SDK, compare results with expected answers, and show whether
changes to questions or rubrics improve behavior.

Resume-to-job-description matching is the first use case. Keep the underlying
evaluation machinery reusable rather than hard-coding recruiting rules into it.
That general-purpose direction is a proposal; the first implementation scope still
needs to be agreed with Nick.

## Current state

- Directory: `/Users/nickdejesus/Code/jevals`.
- npm package `jevals@0.0.1` was published and verified under maintainer
  `dayhaysoos` during this conversation. Package page:
  <https://www.npmjs.com/package/jevals>.
- Local `package.json` declares ESM, `main: index.js`, and `UNLICENSED`.
- `index.js` only exports `accuracy(results)`. It compares `expected` and `actual`
  using strict equality, returns a fraction, and returns `null` for an empty array.
- There is no SDK integration, case loader, evaluation runner, or report yet.
- The current `npm test` script is the npm-init placeholder and fails intentionally.
- No API key or private resume data has been copied into this project.
- Nick explicitly requested documentation only for this handoff. Do not initialize
  Git. No implementation, additional publication, or repository creation was
  authorized by that request.

## Related experiment and boundaries

The existing TanStack resume experiment is a separate project at
`/Users/nickdejesus/Code/jev-resume-lab`. Its standalone test script is
`experiments/evidence.mjs`. The original Sift workspace is
`/Users/nickdejesus/Code/sift-skills`; jevals work should not alter that application.

The resume experiment uses the official `@typesafe-ai/sdk`. Credentials belong on
the server or in a local ignored environment file, never in published examples.
Do not copy the lab's `.env` or Nick's resume into jevals fixtures.

The parent conversation was changing the experiment from a yes/no judgment to
three similarity labels. That change was applied to the lab script and a run was
started, but its result was not observed in this side conversation. Do not describe
that last run as successful or failed without checking its actual results.

## Product decisions behind the first eval

Nick wants to know what a job requires and whether a candidate has done similar
work, with evidence drawn from the whole career. This should eventually handle
different occupations and document formats, not just engineering examples.

Evaluate complete jobs or projects with their accomplishments and supporting
details together. Do not treat every wrapped line as an independent accomplishment.
Several relevant experiences may support one requirement. A requirement should
not count multiple times merely because it has several supporting passages.

Current proposed question:

> How closely does the candidate's work in this job or project match the work
> described in this requirement?

Proposed labels:

- **Directly similar:** substantially the same kind of work, even with different
  terminology, tools, or industries.
- **Related:** useful overlap, but an important part differs or is not shown.
- **Not demonstrated:** the supplied experience does not establish comparable work.
  This does not mean the candidate lacks the ability.

These are evidence labels, not a hiring recommendation. Similar work does not
automatically satisfy explicit conditions such as a license or a minimum duration.
Those need separate checks. Model probability/confidence is not a candidate match
percentage. No overall percentage formula has been settled for this experiment.

## What the experiments taught us

Historical observations from one resume and one requirement, not an accuracy
benchmark. The requirement concerned building reusable frontend components and
libraries. The model used in these comparisons was `jev-1.13.0`.

- The original application split text into short passages and selected one source
  per requirement. That lost context and hid other relevant experience.
- A manual grouping experiment reduced 19 blocks/questions to 11. The grouped
  request took 475 ms and 2,702 input tokens, versus 563 ms and 3,938 tokens for
  the earlier individual-block run. These are individual observations, not a
  reliable latency benchmark.
- Grouping found useful evidence from an older job and multiple projects.
- An isolated registry-listing sentence still received a high yes probability for
  a question asking whether the candidate did the work. Explicitly asking whether
  the candidate personally built or maintained it lowered the isolated result
  from 78% to 72%, but did not resolve that interpretation.
- Nick correctly pointed out that a registry listing is useful supporting context
  when kept with a statement that the candidate built the project. It should not
  become a separate accomplishment or be assumed to prove a rigorous review process.
- We should not optimize the entire rubric around forcing that isolated sentence
  to score low. Agree on the intended recruiting interpretation first, then test it.

## Principles for good evals

1. **Define the judgment before measuring it.** Write concrete label definitions
   and examples. Evaluate what the supplied evidence supports, not employment
   outcomes that we have not measured.
2. **Label cases before reading model answers.** Nick or a relevant reviewer should
   approve expected labels and short reasons. Record disagreements instead of
   pretending subjective cases have unquestionable answers. Do not use Jev's own
   confidence as the answer key.
3. **Use realistic variety.** Include several occupations, resume formats, and job
   descriptions, plus relevant older roles, different terminology, skills-only
   claims, incomplete evidence, and multiple bullets from the same project.
4. **Separate error types.** Measure over-crediting, missed strong evidence, and
   confusion between direct and related work. Overall accuracy alone is inadequate.
   Show counts and denominators, especially for a small dataset.
5. **Keep uncertainty visible.** Examine probabilities alongside actual correctness.
   If review thresholds are introduced, measure both errors and the fraction sent
   to review. Cookbook thresholds are examples, not defaults proven for recruiting.
6. **Make comparisons reproducible.** Record case-set version, exact question and
   criteria, requested and returned model versions, raw answers, token usage,
   latency, and failures. Change one factor at a time where practical.
7. **Reserve unseen cases.** Keep related resumes, job descriptions, and formatting
   variants in the same partition. Tune on one set and assess on another; repeatedly
   tuning to the held-out set defeats its purpose.
8. **Check stability without confusing it with correctness.** Repeat difficult
   cases and try changes that should preserve meaning, such as line wrapping or
   role ordering. A stable mistake is still a mistake.
9. **Test stages and the complete workflow.** Evaluate grouping, requirement
   extraction, and matching separately, then together. A parsing failure should
   not be misdiagnosed as a matching failure.
10. **Track operational behavior.** Include request count, tokens, latency, and
    service failures. Keep recorded-output replay separate from fresh model evals.

## Proposed smallest useful implementation

Start with manually reviewed experience blocks so parsing errors do not obscure
the matching judgment. A starting dataset of roughly 30–50 varied cases would be
useful for development, but would not establish general reliability.

Each case needs an ID, requirement, complete experience block and context, expected
label, reviewer rationale, and a grouping key for keeping related cases together.
Use synthetic or explicitly approved, appropriately redacted data for shareable
fixtures. Agree on ambiguous labels before running comparisons.

The initial toolkit could consist of:

1. A case file.
2. A JavaScript runner using the official TypeSafe SDK.
3. A report showing expected versus actual labels, error counts, and before/after
   changes, plus latency and token usage.

Start with Choice judgments for the three labels. Other primitives can follow
when there is a concrete need. Batch independent questions sharing input within
the request budget; do not assume batching eliminates per-question token costs.

An example case shape, not a committed API contract:

```json
{
  "id": "reusable-library-01",
  "group": "synthetic-resume-a",
  "requirement": "Build reusable frontend libraries",
  "experience": {
    "context": "Frontend engineer, Example Company",
    "text": "Built and maintained a reusable React component library used by three teams."
  },
  "expected": "directly_similar",
  "rationale": "Describes building and maintaining a reusable frontend library."
}
```

A dashboard, database, automatic prompt optimization, or a complete recruiting
pipeline is not needed to prove this first feedback loop. Nick prefers small,
reviewable steps and has objected to extra setup UI and unrequested restrictions.

## Documentation to consult

Live TypeSafe docs are authoritative for API details. Relevant starting points:

- [JavaScript SDK](https://docs.typesafe.ai/sdk/javascript)
- [Primitives and independent questions](https://docs.typesafe.ai/primitives)
- [Structure recovery](https://docs.typesafe.ai/cookbooks/autoformat): repair broken
  lines and classify blocks without rewriting their words; not a complete resume parser.
- [Re-ranking](https://docs.typesafe.ai/cookbooks/rerank_typesafe): compare evidence
  against a query; shortlisting can omit relevant evidence before Jev sees it.
- [Classifying RAG passages](https://docs.typesafe.ai/cookbooks/classifying_rag_passages):
  relevance and useful support are different judgments.
- [Parallel questions](https://docs.typesafe.ai/cookbooks/parallel_questions): avoid
  repeatedly transmitting the same state for independent questions.
- [Self-consistency: choices](https://docs.typesafe.ai/cookbooks/consistency_choice_cookbook):
  measure label stability and abstention, not accuracy against an answer key.
- [Classification using confidence](https://docs.typesafe.ai/cookbooks/classification_using_confidence):
  compare model confidence with observed correctness on labeled examples.

No dedicated hosted eval feature was established in this conversation. The public
console redirected to login; this is not evidence that such a feature does not exist.

The TypeSafe skill read in the related project is available at
`/Users/nickdejesus/Code/sift-skills/.agents/skills/typesafe-ai/SKILL.md`.

## Starting the next conversation

Read this file and the current package files. Confirm the first small implementation
scope with Nick rather than treating every proposal above as an approved feature.
Keep work in this directory, and leave Git uninitialized unless Nick asks otherwise.

Archive/restore uses evaluation metadata with revision protection, active/archived/all home filtering, Definition actions, and native WebMCP tools. Historical data is preserved; archived evaluations must be restored before new runs. Native browser checks exercise both UI and tools.

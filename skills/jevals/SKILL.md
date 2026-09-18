---
name: jevals
description: Jevals evaluation workflow. Use when creating or editing Jevals, comparing Jev prompt experiments, or investigating evaluation failures through the local workbench and WebMCP.
---

# Jevals

Use reviewed examples to test typed judgments. WebMCP supplies the live data contract; this skill supplies the evaluation process. It operates the workbench, rather than implementing its code.

## 1. Discover the workspace

Determine whether the user wants a new evaluation, a prompt comparison, or failure diagnosis. Use the user's selected workbench tab; otherwise locate the running Jevals page. Discover its native WebMCP tools, then read `get_eval_framework` and `list_evaluations`. Before changing an existing Jeval, read `get_evaluation` for its definition, cases and current revision.

If WebMCP is unavailable, report that limitation and use accessible browser controls when available; do not invent tool calls or a remote MCP endpoint. If the server is unavailable, consult the project's README for startup. Do not retrieve or expose API keys; missing credentials require the user to configure them on the server.

**Done when:** the target Jeval or proposed new experiment is identified, live capabilities are known, and the requested operation is clear.

## 2. Define the judgment

For a visible form demonstration, `open_authoring_dialog` opens Add question or Add case for the current Jeval; `close_authoring_dialog` cancels its isolated draft. Use the question/case upsert tools to create saved records directly; they do not fill or submit a visible modal draft. Cancel an open form before navigating to another task.

For authoring, read [primitive examples](references/primitives.md). Choose Noul, Choice, Score, or multiple questions sharing the same case state. Give each question a stable ID, explicit instructions and criteria. Put test-purpose documentation in the optional Jeval description; it is not model instructions. Define a state schema when repeated structured fields should generate forms.

For prompt comparisons, preserve question/case IDs, states and reviewed answer keys. Change instructions rather than redefining the target judgment. If the actual task changes, create a separate experiment and explain why its results are not directly comparable.

For diagnosis, retain the failed run's immutable definition as the source of what was executed; current drafts may differ.

**Done when:** the judgment and state needed to answer it are explicit for every question, or the diagnostic target run is identified.

## 3. Author independent answer keys

For read-only analysis, assess the existing answer-key review and split status without creating or changing labels. Apply the authoring rules below only when authoring was requested.

Derive each expected answer from the supplied criteria and case evidence before running. Record a rationale. Never copy predictions into expected answers to raise accuracy. Model-generated keys are proposals, not independent human review; identify who reviewed them and what remains unreviewed in the report.

Include positive, negative, boundary and misleading cases relevant to the task. If the evidence or criteria cannot determine an answer, surface the ambiguity for review. Keep that expectation unset in a draft or omit the case from the runnable collection; the workbench requires an expectation for every question. Do not encode unsupported `unknown` labels.

When tuning prompts, reserve independently reviewed held-out cases before examining predictions. Jevals has no dedicated split control: use a separate held-out Jeval with equivalent questions and do not tune against its results. If the user only requested a quick demo, report that development examples do not establish held-out reliability.

**Done when:** every runnable case has a valid value and rationale for every question, ambiguous cases are accounted for, and the review/split status is explicit.

## 4. Save and verify

Use the discovered schemas for create/update/upsert calls. Re-read the current revision after each write; never reuse a stale revision for the next mutation. Unsaved browser drafts block agent writes and runs: preserve them and resolve the conflict with the user instead of forcing a save, discarding edits, or bypassing the guard.

Structural changes can clear reviewed keys: primitive changes and question removal clear that question's expectations; Choice label removal/rename clears affected labels; Score insertion/removal/reordering clears its scores and tolerances. For a WebMCP Score reorder plus wording rewrite, reorder first, then rewrite, so invalidation is detected. Wording edits preserve keys but still require semantic review; Score rubric wording can also change dataset comparability.

Read the saved Jeval back. Verify every requested definition/case change and every invalidated expectation; restore missing keys only through independent review. A successful call is not sufficient evidence of the saved content.

**Done when:** requested edits are confirmed in saved state and all missing/changed expectations are reviewed or explicitly left as a non-runnable draft. For read-only diagnosis, skip writes.

## 5. Run within the requested scope

If the user requested analysis of an existing run, proceed to inspection without starting another run. If only authoring was requested, finish with saved-state verification.

Creating/editing and seeding do not send Jev requests. Running sends all case states to TypeSafe and incurs API cost. Execute only within the user's existing authorization for the target data, destination and number of runs; do not ask again when already authorized. If the user authorized only authoring or analysis, obtain run authorization before making paid requests. Do not upload exports elsewhere without authorization.

Run the saved definition with `run_evaluation`, capture its returned ID and inspect that exact run with `get_run`. Poll at reasonable intervals until it finishes; avoid tight loops. An accepted run continues even if the browser call is cancelled. Never start a duplicate just because completion is slow. Different Jevals may run concurrently; overlapping runs of the same Jeval are rejected.

**Done when:** the accepted run is terminal, or a concrete interruption/blocker is reported with its run ID and known status. Starting a run is not completion.

## 6. Inspect and report evidence

Read [failure and comparison guidance](references/results.md) for diagnosis or comparison. Inspect each requested question's metrics and erroneous/incorrect cases, including the owning trace when necessary. Separate unusable answers from valid wrong judgments and confidence from correctness.

Compare only compatible datasets and fully successful runs. Follow the workbench's question-scoped ranking; do not blend unrelated questions into aggregate accuracy. For older runs, paginate `list_evaluation_runs` rather than treating the first page as all history.

Report the saved Jeval and exact run IDs, terminal outcome, relevant metrics, representative failures, answer-key review and held-out status, and any unknown cost/usage. Distinguish simulated requests from live-provider evidence. Stop after the requested experiment; do not launch additional tuning rounds automatically.

**Done when:** the requested questions and failures are accounted for, comparison limits are stated, and claims are supported by inspected saved results. If only authoring was requested, report verified saved content and that no run was made.

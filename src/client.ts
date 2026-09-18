import { Disclosures } from "./disclosures.js";
import {
  editQuestion,
  removeQuestion,
  upsertQuestion,
} from "./question-authoring.js";
import "./style.css";
import { type EvaluationSummary } from "./types.js";
import { metrics, questionResults, runOutcome } from "./questions.js";
import {
  esc,
  questionEditor,
  expectationLabel,
  expectationOptions,
  expectedValue,
  resultHeaders,
  resultRow,
  metricDetails,
} from "./question-presentation.js";
import { EvaluationWorkspace } from "./workspace.js";
import { decodeSuite } from "./snapshots.js";
import { api } from "./api.js";
import { registerWebMCP } from "./webmcp.js";
import {
  initialState,
  stateObject,
  stateErrors,
  validateSchema,
} from "./state-schema.js";
const root = document.querySelector<HTMLDivElement>("#app")!;
let evaluations: EvaluationSummary[] = [];
let tab = "results";
let search = "";
let statusFilter = "all";
let archiveFilter = "active";
let questionTypeFilter = "all";
let creationTrigger = "new-evaluation";
const workspace = new EvaluationWorkspace({
  read: async (id, signal, view) => {
    const query = new URLSearchParams();
    if (view?.includeRun) query.set("includeRun", "1");
    if (view?.runId) query.set("run", view.runId);
    const document = await api(
      `/api/evaluations/${encodeURIComponent(id)}${query.size ? `?${query}` : ""}`,
      "GET",
      undefined,
      signal,
    );
    return {
      ...document,
      suite: decodeSuite(document.suite),
      runs: document.runs,
    };
  },
  history: (id, before) =>
    api(`/api/evaluations/${encodeURIComponent(id)}/runs?before=${before}`),
  write: (id, snapshot, expectedRevision, signal) =>
    api(
      `/api/evaluations/${encodeURIComponent(id)}`,
      "PUT",
      { suite: snapshot, revision: expectedRevision },
      signal,
    ),
  archive: (id, archived, expectedRevision, signal) =>
    api(
      `/api/evaluations/${encodeURIComponent(id)}/${archived ? "archive" : "restore"}`,
      "POST",
      { revision: expectedRevision },
      signal,
    ),
});
let configured = false;
let selectedQuestion = "judgment";
let active: string | null = null;
const pendingRuns = new Set<string>();
function isRunning(id: string) {
  return (
    pendingRuns.has(id) ||
    evaluations.some((e) => e.id === id && e.latestRun?.status === "running") ||
    (workspace.id === id && workspace.runs.some((r) => r.status === "running"))
  );
}
const disclosures = new Disclosures(() => render());
let stateView: "form" | "json" = "form";
let schemaOpen = false;
let traceRequest = 0;
const money = (n: number | null) =>
  n === null ? "Unavailable" : `$${n.toFixed(8)}`;
function runOutcomeMarkup(outcome: ReturnType<typeof runOutcome>) {
  const label = {
    running: "Running",
    complete: "Complete",
    partial: "Partial success",
    failed: "Failed",
  }[outcome];
  const icon =
    outcome === "partial"
      ? '<path d="M12 3 2 21h20L12 3Z"/><path d="M12 9v5m0 3h.01"/>'
      : outcome === "failed"
        ? '<path d="m6 6 12 12M18 6 6 18"/>'
        : "";
  return `<span class="run-outcome ${outcome}" data-run-outcome="${outcome}">${icon ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg>` : ""}${label}</span>`;
}
function updateSaveState() {
  const archiveButton = document.querySelector<HTMLButtonElement>(
    "#archive-evaluation",
  );
  if (archiveButton)
    archiveButton.disabled =
      workspace.dirty || (!!workspace.id && workspace.isSaving(workspace.id));
  const saveButton = document.querySelector<HTMLButtonElement>("#save");
  if (saveButton && workspace.id)
    saveButton.disabled = workspace.isSaving(workspace.id);
  updateRunControls();
  const el = document.querySelector("#save-state");
  if (el) el.textContent = workspace.dirty ? " · Unsaved changes" : "";
}
const unsubscribeWorkspace = workspace.subscribe(updateSaveState);
import.meta.hot?.dispose(unsubscribeWorkspace);
function updateRunControls() {
  root
    .querySelectorAll<HTMLButtonElement>("[data-sidebar-run]")
    .forEach((button) => {
      const id = button.dataset.sidebarRun!;
      const busy = isRunning(id);
      const hasDraft = workspace.hasUnsavedChanges(id);
      const name = evaluations.find((e) => e.id === id)?.name ?? "jeval";
      button.disabled =
        !configured || !!hasDraft || busy || workspace.isSaving(id);
      button.classList.toggle("is-running", busy);
      button.setAttribute("aria-busy", String(busy));
      button.setAttribute(
        "aria-label",
        `${busy ? "Running" : "Run saved"} ${name}`,
      );
      button.title = busy
        ? "Running…"
        : hasDraft
          ? "Save changes before running"
          : !configured
            ? "Configure an API key to run"
            : `Run saved ${name}`;
      button.innerHTML = busy
        ? '<span class="run-spinner" aria-hidden="true"></span>'
        : '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>';
    });
  const button = document.querySelector<HTMLButtonElement>("#run");
  if (button && workspace.id) {
    const busy = isRunning(workspace.id);
    button.disabled =
      !!workspace.archivedAt || busy || workspace.isSaving(workspace.id);
    button.setAttribute("aria-busy", String(busy));
    button.innerHTML = busy
      ? '<span class="run-spinner" aria-hidden="true"></span><span class="sr-only">Running evaluation</span>'
      : "Run evaluation";
  }
}
function markDirty() {
  workspace.markDirty();
  updateSaveState();
}
function notify(message: string, error = false) {
  const el = document.querySelector<HTMLElement>("#notice")!;
  el.textContent = message;
  el.className = error ? "notice error" : "notice";
}
function creationDialogMarkup() {
  return `<dialog id="create-dialog" aria-labelledby="create-title"><form id="create-evaluation" class="create-evaluation"><h2 id="create-title">New evaluation</h2><p id="create-error" role="alert"></p><p>Questions can share the same state. Add Noul and Choice questions in Definition; Score is coming soon.</p><label>Evaluation name<input id="new-name" required maxlength="200" placeholder="For example, refund requests"></label><label>Description <span class="hint">Optional</span><textarea id="new-description" rows="4" maxlength="20000" placeholder="Describe what this jeval tests."></textarea></label><div class="actions"><button type="submit" class="primary">Create evaluation</button><button type="button" id="cancel-create">Cancel</button></div></form></dialog>`;
}
function glossaryMarkup() {
  const terms = [
    [
      "Jeval",
      "A saved evaluation: questions, example cases, reference answers, and run history.",
    ],
    [
      "Case and state",
      "A case is one example to test. Its state is the content all questions in that example evaluate.",
    ],
    [
      "Noul",
      "A yes/no judgment, returned as a probability of yes. The question’s threshold determines the predicted answer.",
    ],
    [
      "Choice",
      "A selection from named options with no required order, returned with probabilities and confidence.",
    ],
    [
      "Score",
      "A rating on ordered descriptive levels, numbered from zero. Scores can fall between levels.",
    ],
    [
      "Expected answer",
      "Your reference answer, set before running: yes/no for Noul, an option label for Choice, or a numeric score for Score. It is compared with Jev’s actual answer.",
    ],
    [
      "Tolerance",
      "The allowed distance from an expected score. Expected 2 with tolerance 0.5 passes from 1.5 through 2.5, inclusive. Default: 0.5 levels.",
    ],
    [
      "Confidence",
      "How concentrated the model’s probability distribution is. High confidence does not prove correctness.",
    ],
    [
      "Accuracy and pass rate",
      "Accuracy is the fraction of answers matching the reference labels. For Score, pass rate is the fraction within tolerance. These are unavailable until all cases for the question succeed.",
    ],
    [
      "Mean absolute error",
      "Average distance between actual and expected scores, measured in level units. Lower is better. On incomplete runs, it covers valid answers only.",
    ],
    [
      "Brier error",
      "Measures how far probabilities are from the reference labels. Lower is better. Noul uses binary Brier; Choice sums errors across options. Score uses mean absolute error instead.",
    ],
    [
      "Best run",
      "The best fully successful run on a comparable dataset, for the selected question. Noul/Choice rank by accuracy then Brier; Score ranks by lowest absolute error then pass rate.",
    ],
    [
      "Trace and usage",
      "A trace records a case’s provider request, response, and errors. Tokens, latency, and estimated cost cover the whole request, shared by its questions.",
    ],
  ];
  return `<dialog id="glossary-dialog" aria-labelledby="glossary-title"><div class="section-title"><h2 id="glossary-title">Evaluation glossary</h2><button id="close-glossary" type="button" autofocus>Close</button></div><dl class="glossary-terms">${terms.map(([term, meaning]) => `<dt>${esc(term)}</dt><dd>${esc(meaning)}</dd>`).join("")}</dl></dialog>`;
}
function shellStart() {
  return `<header><a class="brand" href="/" data-home>jevals<span>Evaluation workbench</span></a><span class="connection">${configured ? "API key configured" : "API key needed"}</span></header><div class="app-layout"><aside class="sidebar"><nav aria-label="Main navigation"><a href="/" data-home class="nav-home ${!workspace.id ? "selected" : ""}">Evaluations</a><h2>Saved evaluations</h2>${evaluations
    .filter((e) => !e.archivedAt)
    .map((e) => {
      const hasDraft = workspace.hasUnsavedChanges(e.id);
      const running = isRunning(e.id);
      const disabled =
        !configured || hasDraft || running || workspace.isSaving(e.id);
      const title = hasDraft
        ? "Save changes before running"
        : !configured
          ? "Configure an API key to run"
          : running
            ? "Running…"
            : `Run saved ${e.name}`;
      return `<div class="sidebar-evaluation ${workspace.id === e.id ? "selected" : ""}"><a href="/evaluations/${e.id}/results" data-evaluation="${e.id}" class="nav-evaluation"><span>${esc(e.name)}</span><small>${e.questionCount} question${e.questionCount === 1 ? "" : "s"} · ${e.caseCount} cases</small></a><button type="button" class="sidebar-run ${running ? "is-running" : ""}" data-sidebar-run="${e.id}" aria-label="${running ? "Running" : "Run saved"} ${esc(e.name)}" aria-busy="${running}" title="${esc(title)}" ${disabled ? "disabled" : ""}>${running ? '<span class="run-spinner" aria-hidden="true"></span>' : '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>'}</button></div>`;
    })
    .join(
      "",
    )}</nav><div class="sidebar-actions"><button id="sidebar-glossary" type="button" aria-haspopup="dialog" aria-controls="glossary-dialog">Glossary</button><button id="sidebar-create" class="primary" type="button">Create jeval</button></div></aside>${creationDialogMarkup()}${glossaryMarkup()}`;
}
function bindNavigation() {
  const glossary = root.querySelector<HTMLDialogElement>("#glossary-dialog")!;
  root.querySelector<HTMLButtonElement>("#sidebar-glossary")!.onclick = () => {
    disclosures.open(
      glossary,
      root.querySelector<HTMLButtonElement>("#sidebar-glossary")!,
    );
  };
  root.querySelector<HTMLButtonElement>("#close-glossary")!.onclick = () =>
    glossary.close();

  root.querySelectorAll<HTMLAnchorElement>("[data-home]").forEach(
    (el) =>
      (el.onclick = (e) => {
        e.preventDefault();
        void navigate(null);
      }),
  );
  root.querySelectorAll<HTMLAnchorElement>("[data-evaluation]").forEach(
    (el) =>
      (el.onclick = (e) => {
        e.preventDefault();
        void navigate(el.dataset.evaluation!);
      }),
  );
  root.querySelectorAll<HTMLButtonElement>("[data-sidebar-run]").forEach(
    (button) =>
      (button.onclick = async (event) => {
        event.stopPropagation();
        const id = button.dataset.sidebarRun!;
        if (isRunning(id)) return;
        if (!workspace.canMutate(id)) {
          notify("Finish saving changes before running this jeval.", true);
          return;
        }
        pendingRuns.add(id);
        let runError: string | null = null;
        updateRunControls();
        try {
          const result = await api("/api/runs", "POST", { evaluationId: id });
          await navigate(id, "results", true, result.id);
        } catch (e) {
          runError = (e as Error).message;
        } finally {
          pendingRuns.delete(id);
          render();
          notify(
            runError ?? "Run started. Results are saved locally.",
            !!runError,
          );
        }
      }),
  );
  bindCreationDialog();
}
async function navigate(
  id: string | null,
  nextTab = "results",
  push = true,
  runId: string | null = null,
) {
  try {
    if (!["results", "cases", "definition", "runs"].includes(nextTab))
      throw Error("Unknown evaluation page.");
    let list: { evaluations: EvaluationSummary[]; configured: boolean };
    const opened = await workspace.navigate(
      id,
      async () => {
        list = await api("/api/evaluations");
      },
      {
        includeRun: ["results", "runs"].includes(nextTab),
        ...(runId ? { runId } : {}),
      },
    );
    if (!opened) return;
    tab = nextTab;
    evaluations = list!.evaluations;
    configured = list!.configured;
    active = runId;
    schemaOpen = false;
    disclosures.clear();
    if (push)
      history.pushState(
        {},
        "",
        id
          ? `/evaluations/${id}/${nextTab}${runId && nextTab === "results" ? `?run=${encodeURIComponent(runId)}` : ""}`
          : "/",
      );
    render();
  } catch (e) {
    if (document.querySelector("#notice")) notify((e as Error).message, true);
    else
      root.innerHTML = `${shellStart()}<main><h1>Could not open this evaluation</h1><p>${esc((e as Error).message)}</p><a href="/">Back to evaluations</a></main></div>`;
  }
}
function renderHome() {
  root.innerHTML = `${shellStart()}<main class="home"><div class="intro"><div><h1>Evaluations</h1><p>Create a judgment, review its cases, and follow its results.</p></div><button id="new-evaluation" class="primary">New jeval</button></div><p id="notice" class="notice" role="status">${evaluations.length} saved evaluation${evaluations.length === 1 ? "" : "s"}</p><div class="home-toolbar"><label>Search evaluations<input id="search" type="search" value="${esc(search)}" placeholder="Search by name"></label><label>Show<select id="archive-filter"><option value="active">Active</option><option value="archived">Archived</option><option value="all">All evaluations</option></select></label><label>Question types<select id="question-type-filter"><option value="all">All types</option><option value="noul">Noul only</option><option value="choice">Choice only</option><option value="score">Score only</option><option value="mixed">Mixed primitives</option></select></label><label>Run status<select id="status-filter"><option value="all">All statuses</option><option value="never">Not run yet</option><option value="complete">Complete</option><option value="failed">Failed</option><option value="running">Running</option></select></label></div><div id="evaluation-list"></div><p class="hint">Each evaluation owns its definition, state schema, cases, and run history. Results from different evaluations are kept separate.</p></main></div>`;
  bindNavigation();
  renderEvaluationList();
  const scope = document.querySelector<HTMLSelectElement>("#archive-filter")!;
  scope.value = archiveFilter;
  scope.onchange = () => {
    archiveFilter = scope.value;
    renderEvaluationList();
  };
  const filter = document.querySelector<HTMLSelectElement>("#status-filter")!;
  filter.value = statusFilter;
  filter.onchange = () => {
    statusFilter = filter.value;
    renderEvaluationList();
  };
  const types = document.querySelector<HTMLSelectElement>(
    "#question-type-filter",
  )!;
  types.value = questionTypeFilter;
  types.onchange = () => {
    questionTypeFilter = types.value;
    renderEvaluationList();
  };
  document.querySelector<HTMLInputElement>("#search")!.oninput = (e) => {
    search = (e.target as HTMLInputElement).value;
    renderEvaluationList();
  };
}
function bindCreationDialog() {
  const dialog = document.querySelector<HTMLDialogElement>("#create-dialog")!;
  dialog.onkeydown = (event) => {
    if (event.key !== "Tab") return;
    const controls = [
      ...dialog.querySelectorAll<HTMLElement>(
        "input:not(:disabled), textarea:not(:disabled), button:not(:disabled)",
      ),
    ];
    const first = controls[0],
      last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };
  for (const id of ["new-evaluation", "sidebar-create"]) {
    const trigger = document.getElementById(id);
    if (trigger)
      trigger.onclick = () => {
        creationTrigger = id;
        disclosures.open(dialog, trigger);
      };
  }
  document.querySelector<HTMLButtonElement>("#cancel-create")!.onclick = () =>
    dialog.close();
  document.querySelector<HTMLFormElement>("#create-evaluation")!.onsubmit =
    async (e) => {
      e.preventDefault();
      const form = e.currentTarget as HTMLFormElement;
      const button = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
      button.disabled = true;
      try {
        const name = document
          .querySelector<HTMLInputElement>("#new-name")!
          .value.trim();
        const created = await api("/api/evaluations", "POST", {
          name,
          description:
            document.querySelector<HTMLTextAreaElement>("#new-description")!
              .value,
          questions: [],
          model: "jev-1.13.0",
          stateSchema: [],
          cases: [],
        });
        disclosures.clear();
        dialog.close();
        await navigate(created.id, "definition");
      } catch (e) {
        document.querySelector("#create-error")!.textContent = (
          e as Error
        ).message;
        button.disabled = false;
      }
    };
}
function renderEvaluationList() {
  const visible = evaluations.filter(
    (e) =>
      (archiveFilter === "all" ||
        (archiveFilter === "archived" ? !!e.archivedAt : !e.archivedAt)) &&
      e.name.toLowerCase().includes(search.toLowerCase()) &&
      (questionTypeFilter === "all" ||
        (questionTypeFilter === "mixed"
          ? new Set(e.questionTypes).size >= 2
          : new Set(e.questionTypes).size === 1 &&
            e.questionTypes.includes(questionTypeFilter))) &&
      (statusFilter === "all" ||
        (e.latestRun?.status ?? "never") === statusFilter),
  );
  document.querySelector("#evaluation-list")!.innerHTML = visible.length
    ? `<div class="table-wrap"><table class="evaluation-table"><thead><tr><th>Evaluation</th><th>Questions</th><th>Cases</th><th>Latest result</th><th>Last run</th></tr></thead><tbody>${visible.map((e) => `<tr><td><a href="/evaluations/${e.id}/results" data-evaluation="${e.id}">${esc(e.name)}</a>${e.archivedAt ? ' <span class="type-badge">Archived</span>' : ""}</td><td>${e.questionCount} · ${e.questionTypes.length ? esc(e.questionTypes.join(", ")) : "None yet"}</td><td>${e.caseCount}</td><td>${e.latestRun ? `${e.latestRun.status === "complete" && e.latestRun.metrics.accuracy !== null && e.questionCount === 1 ? `${(e.latestRun.metrics.accuracy * 100).toFixed(0)}% ${e.latestRun.metrics.type === "score" ? "pass rate" : "accuracy"}` : `${runOutcomeMarkup(e.latestRun.outcome ?? e.latestRun.status)}${e.questionCount > 1 ? " · View questions" : ""}`}` : "Not run yet"}</td><td>${e.latestRun ? new Date(e.latestRun.createdAt).toLocaleString() : "—"}${e.archivedAt ? `<button data-restore="${e.id}" data-revision="${e.revision}" type="button" aria-label="Restore ${esc(e.name)}">Restore</button>` : ""}</td></tr>`).join("")}</tbody></table></div>`
    : `<div class="empty"><h2>No evaluations match.</h2><p>Try a different search or create a new evaluation.</p></div>`;
  bindNavigation();
  root.querySelectorAll<HTMLButtonElement>("[data-restore]").forEach(
    (button) =>
      (button.onclick = async () => {
        button.disabled = true;
        try {
          await changeArchive(
            button.dataset.restore!,
            false,
            Number(button.dataset.revision),
          );
          await refresh();
          notify("Evaluation restored.");
        } catch (e) {
          notify((e as Error).message, true);
          button.disabled = false;
        }
      }),
  );
}
async function changeArchive(
  id: string,
  archived: boolean,
  expectedRevision: number,
) {
  return workspace.changeArchive(id, archived, expectedRevision);
}
function schemaEditor() {
  const fields = workspace.suite.stateSchema ?? [];
  return `<details id="schema-editor" ${schemaOpen ? "open" : ""}><summary>State schema · ${fields.length} fields</summary><p class="hint">Define fields once for every case. Defaults initialize new cases. Renaming or removing fields keeps existing JSON values.</p>${fields.map((f, i) => `<div class="schema-field" data-schema-key="${esc(f.key)}"><div class="pair"><label>Field key<input data-field="key" data-field-index="${i}" value="${esc(f.key)}"></label><label>Label<input data-field="label" data-field-index="${i}" value="${esc(f.label)}"></label></div><div class="pair"><label>Type<select data-field="type" data-field-index="${i}"><option value="text" ${f.type === "text" ? "selected" : ""}>Text</option><option value="long-text" ${f.type === "long-text" ? "selected" : ""}>Long text</option></select></label><label class="checkbox-label"><input type="checkbox" data-field="required" data-field-index="${i}" ${f.required ? "checked" : ""}> Required</label></div><label>Default for new cases<textarea data-field="defaultValue" data-field-index="${i}" rows="2">${esc(f.defaultValue)}</textarea></label><button data-remove-field="${i}">Remove field</button></div>`).join("")}<button id="add-field">Add state field</button><p class="hint">With no schema, cases can use plain text or raw JSON.</p></details>`;
}
function caseStateEditor(state: string) {
  const fields = workspace.suite.stateSchema ?? [];
  if (!fields.length)
    return `<label>State <small>Plain text or JSON</small><textarea class="code" data-case="state" rows="7">${esc(state)}</textarea></label>`;
  const object = stateObject(state);
  const valid =
    object &&
    fields.every(
      (f) => object[f.key] === undefined || typeof object[f.key] === "string",
    );
  const form = stateView === "form" && valid;
  return `<div class="section-title"><h2>State</h2><div class="view-switch" aria-label="State editor view"><button data-state-view="form" aria-pressed="${stateView === "form"}">Form</button><button data-state-view="json" aria-pressed="${stateView === "json"}">JSON</button></div></div>${form ? fields.map((f, i) => `<label>${esc(f.label)} ${f.required ? "<small>Required</small>" : "<small>Optional</small>"}${f.type === "long-text" ? `<textarea data-state-field="${i}" data-state-key="${esc(f.key)}" rows="4">${esc(object![f.key] ?? "")}</textarea>` : `<input data-state-field="${i}" data-state-key="${esc(f.key)}" value="${esc(object![f.key] ?? "")}">`}</label>`).join("") : `${stateView === "form" ? '<p class="hint">This state cannot be displayed as a text-field form. Its original content is preserved below. Edit it into a JSON object with text values to use the form.</p>' : ""}<label>State JSON<textarea class="code" data-case="state" rows="8">${esc(state)}</textarea></label>`}<p id="state-errors" class="schema-errors" role="status">${esc(stateErrors({ ...workspace.suite, cases: [workspace.suite.cases[workspace.selected]] }).join(" "))}</p>${form ? `<details><summary>JSON preview · exact state sent to Jev</summary><pre id="state-preview">${esc(state)}</pre></details>` : ""}`;
}
function bindCaseState() {
  const caseId = workspace.suite.cases[workspace.selected]?.id;
  root.querySelectorAll<HTMLElement>("[data-state-view]").forEach(
    (el) =>
      (el.onclick = () => {
        stateView = el.dataset.stateView as "form" | "json";
        render();
      }),
  );
  root
    .querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      "[data-state-field]",
    )
    .forEach((el) =>
      el.addEventListener("input", () => {
        try {
          validateSchema(workspace.suite.stateSchema);
        } catch (e) {
          notify((e as Error).message, true);
          return;
        }
        const c = workspace.suite.cases.find((c) => c.id === caseId);
        if (!c) return;
        const state = stateObject(c.state);
        const field = workspace.suite.stateSchema?.find(
          (f) => f.key === el.dataset.stateKey,
        );
        if (!state || !field) {
          notify(
            "The state schema changed. Refresh the form before editing this field.",
            true,
          );
          return;
        }
        state[field.key] = el.value;
        c.state = JSON.stringify(state, null, 2);
        markDirty();
        document.querySelector("#state-preview")!.textContent = c.state;
        document.querySelector("#state-errors")!.textContent = stateErrors({
          ...workspace.suite,
          cases: [c],
        }).join(" ");
      }),
    );
  document
    .querySelector<HTMLTextAreaElement>('#state-panel [data-case="state"]')
    ?.addEventListener("input", (e) => {
      const c = workspace.suite.cases.find((c) => c.id === caseId);
      if (!c) return;
      c.state = (e.target as HTMLTextAreaElement).value;
      markDirty();
      const errors = document.querySelector("#state-errors");
      if (errors)
        errors.textContent = stateErrors({
          ...workspace.suite,
          cases: [c],
        }).join(" ");
    });
}
function refreshCaseState() {
  if (!workspace.suite.cases[workspace.selected]) return;
  document.querySelector("#state-panel")!.innerHTML = caseStateEditor(
    workspace.suite.cases[workspace.selected].state,
  );
  bindCaseState();
}
function render() {
  if (disclosures.blocked()) return;
  if (!workspace.id) {
    renderHome();
    return;
  }
  const q =
    workspace.suite.questions!.find((q) => q.id === selectedQuestion) ??
    workspace.suite.questions![0];
  if (q && (tab === "definition" || tab === "cases")) selectedQuestion = q.id;
  const c = workspace.suite.cases[workspace.selected];
  const expectation = q && c?.expectations?.[q.id];
  traceRequest++;
  const originalRun = workspace.run;
  if (originalRun && (tab === "results" || tab === "runs")) {
    const questions = originalRun.suite.questions;
    if (!questions.some((q) => q.id === selectedQuestion))
      selectedQuestion = questions[0]?.id ?? "";
  }
  const run = originalRun ?? null;
  const resultQuestion = run?.suite.questions.find(
    (q) => q.id === selectedQuestion,
  );
  const resultRows = run ? questionResults(run, selectedQuestion) : [];
  const m = run ? metrics(run, selectedQuestion) : null;
  const best = workspace.bestRuns[selectedQuestion];
  root.innerHTML = `${shellStart()}
 <main><div class="intro"><div><div class="jeval-title"><h1>${esc(workspace.suite.name)}</h1><button id="about-jeval" type="button" aria-haspopup="dialog" ${workspace.suite.description?.trim() ? "" : "hidden"}>About this jeval</button></div><p>${workspace.suite.questions!.length} question${workspace.suite.questions!.length === 1 ? "" : "s"} · ${workspace.suite.cases.length} cases<span id="save-state">${workspace.dirty ? " · Unsaved changes" : ""}</span></p></div><div class="actions"><button id="save">Save changes</button><button id="run" class="primary" aria-busy="${isRunning(workspace.id!)}" ${workspace.archivedAt || isRunning(workspace.id!) ? "disabled" : ""}>${isRunning(workspace.id!) ? '<span class="run-spinner" aria-hidden="true"></span><span class="sr-only">Running evaluation</span>' : "Run evaluation"}</button></div></div>
 <div id="about-popover" popover="auto" role="dialog" aria-labelledby="about-title"><div class="section-title"><h2 id="about-title">About this jeval</h2><button id="close-about" type="button" aria-label="Close description" autofocus>Close</button></div><p id="jeval-description" class="jeval-description">${esc(workspace.suite.description)}</p></div><dialog id="about-dialog" aria-labelledby="about-mobile-title"><div class="section-title"><h2 id="about-mobile-title">About this jeval</h2><button id="close-about-mobile" type="button" aria-label="Close description" autofocus>Close</button></div><p id="mobile-description" class="jeval-description">${esc(workspace.suite.description)}</p></dialog><p id="notice" class="notice" role="status">${workspace.archivedAt ? "Archived · Restore to run again." : ""}</p>
 <nav class="evaluation-tabs" aria-label="Evaluation pages">${["results", "cases", "definition", "runs"].map((t) => `<a href="/evaluations/${workspace.id}/${t}" data-tab="${t}" ${tab === t ? 'aria-current="page"' : ""}>${t[0].toUpperCase() + t.slice(1)}</a>`).join("")}</nav><div class="workspace" data-page="${tab}"><section class="editor"><div class="definition-panel"><h2>Definition</h2><label>Evaluation name<input data-suite="name" value="${esc(workspace.suite.name)}"></label><label>Description <span class="hint">Optional</span><textarea data-suite="description" rows="5" maxlength="20000" placeholder="Describe what this jeval tests, its scope, and what a good result means.">${esc(workspace.suite.description)}</textarea></label><label>Model<input data-suite="model" value="${esc(workspace.suite.model)}"></label><div class="section-title"><h2>Questions</h2><button id="add-question" type="button" aria-expanded="false" aria-controls="question-type-picker">Add question</button></div><div id="question-type-picker" hidden><p>Choose a question type. Every question uses the same case state.</p><button id="add-noul" type="button">Noul · Yes/no</button><button id="add-choice" type="button">Choice · Select an option</button><button id="add-score" type="button">Score · Ordered rubric</button></div><nav class="case-list" aria-label="Evaluation questions">${workspace.suite.questions!.map((item) => `<button data-question-id="${esc(item.id)}" class="case ${item.id === q?.id ? "selected" : ""}" ${item.id === q?.id ? 'aria-current="true"' : ""}><span>${esc(item.name)}</span><small>${esc(item.type)}</small></button>`).join("")}</nav>${questionEditor(q)}

 ${schemaEditor()}<div class="archive-action"><h2>${workspace.archivedAt ? "Archived evaluation" : "Archive evaluation"}</h2><p class="hint">${workspace.archivedAt ? "Restore to show this evaluation in the active list and run its questions again." : "Hide this evaluation from the active list. Its cases and run history are preserved. Save changes before archiving."}</p><button id="archive-evaluation" type="button" ${workspace.dirty ? "disabled" : ""}>${workspace.archivedAt ? "Restore evaluation" : "Archive evaluation"}</button></div></div><div class="cases-panel">
 ${q ? `<label>Question to label<select id="case-question">${workspace.suite.questions!.map((item) => `<option value="${esc(item.id)}" ${item.id === q.id ? "selected" : ""}>${esc(item.name)} · ${esc(item.type)}</option>`).join("")}</select></label>` : '<p class="hint">Add questions in Definition to label your cases.</p>'}<div class="section-title"><h2>Cases <span>${workspace.suite.cases.length}</span></h2><button id="add">Add case</button></div><nav class="case-list" aria-label="Evaluation cases">${workspace.suite.cases.map((item, i) => `<button class="case ${i === workspace.selected ? "selected" : ""}" data-index="${i}"><span>${esc(item.name)}</span><small>${q && item.expectations?.[q.id] ? esc(expectationLabel(q, item.expectations[q.id])) : "Needs expected answer"}</small></button>`).join("")}</nav>
 ${c ? `<div class="case-editor"><label>Case name<input data-case="name" value="${esc(c.name)}"></label><div id="state-panel">${caseStateEditor(c.state)}</div>${q ? `<label>Expected answer${q.type === "score" ? `<input data-case="expected" type="number" min="0" max="${q.criteria.length - 1}" step="any" value="${esc(expectation?.value)}"><span class="hint">${q.criteria.map((level, i) => `${i}: ${esc(level)}`).join(" · ")}</span>` : `<select data-case="expected">${expectationOptions(q, expectation)}</select>`}</label>${q.type === "score" ? `<label>Tolerance <span class="hint">Optional · default 0.5 levels</span><input data-case="tolerance" type="number" min="0" max="${q.criteria.length - 1}" step="0.1" value="${esc(expectation?.tolerance)}" ${!expectation ? "disabled" : ""}></label>` : ""}<label>Why this answer?<textarea data-case="rationale" rows="2" ${!expectation ? "disabled" : ""}>${esc(expectation?.rationale)}</textarea></label>` : ""}<button id="remove">Remove case</button></div>` : `<p class="hint">No cases yet. Add a case to enter state and an expected answer.</p>`}</div></section>
 <section class="results"><div class="results-panel"><div class="section-title"><h2>Run results</h2>${run ? `<a class="button" href="/api/runs/${run.id}/export" download>Export JSON</a>` : ""}</div>
 ${run ? `<label>Result question<select id="result-question">${run.suite.questions.map((item) => `<option value="${esc(item.id)}" ${item.id === (run.suite.questions.find((x) => x.id === selectedQuestion)?.id ?? run.suite.questions[0]?.id) ? "selected" : ""}>${esc(item.name)} · ${esc(item.type)}</option>`).join("")}</select></label><p class="hint">Correctness metrics apply to the selected question. Tokens, latency and cost cover the whole request.</p>` : ""}${!run ? `<div class="empty"><h3>Your first run starts here.</h3><p>${workspace.suite.cases.length ? "Review your cases and expected answers, then run the evaluation." : "Start with a question in Definition, then add examples in Cases."}</p><p>Noul judges yes/no; Choice selects an option; Score rates against ordered levels. Correctness comes from your answer key.</p></div>` : `<div class="run-caption"><strong>${esc(run.suite.name)}</strong><span>${new Date(run.createdAt).toLocaleString()} · ${runOutcomeMarkup(runOutcome(originalRun!))}</span></div>${runOutcome(originalRun!) === "partial" ? '<p class="run-outcome-note">Some answers failed. Valid answers are available below; this run cannot qualify as best.</p>' : runOutcome(originalRun!) === "failed" ? '<p class="run-outcome-note">No valid answers are available. Open a case trace to inspect the error.</p>' : ""}<dl class="summary"><div><dt>${resultQuestion?.type === "score" ? "Within tolerance" : "Correct"}</dt><dd>${m!.correct} / ${m!.total}</dd></div><div><dt>${resultQuestion?.type === "score" ? "Pass rate" : "Accuracy"}</dt><dd>${m!.accuracy === null ? "Incomplete" : `${(m!.accuracy * 100).toFixed(0)}%`}</dd></div><div><dt>${resultQuestion?.type === "score" ? "Mean absolute error ↓" : resultQuestion?.type === "choice" ? "Multiclass Brier ↓" : "Brier error ↓"}</dt><dd>${(resultQuestion?.type === "score" ? m!.meanAbsoluteError : m!.brier)?.toFixed(3) ?? "—"}</dd></div></dl><p class="run-meta">${m!.inputTokens} input / ${m!.outputTokens} output tokens · ${(m!.latencyMs / 1000).toFixed(2)}s summed request time · ${money(m!.cost)} estimated</p>${metricDetails(resultQuestion, m!)}<div class="table-wrap"><table><thead><tr>${resultHeaders(resultQuestion)}</tr></thead><tbody>${resultRows.map((row, i) => resultRow(row, i, resultQuestion)).join("")}</tbody></table></div><div id="trace"></div><details><summary>Saved question and cases</summary><pre>${esc(JSON.stringify(run.suite, null, 2))}</pre></details>`}
 </div><div class="history"><h2 id="history-title" tabindex="-1">Run history</h2><p class="hint">${resultQuestion?.type === "score" ? "Best is ranked by lower mean absolute error, then pass rate," : "Best is ranked by accuracy, then lower Brier error,"} on the selected run’s exact case set. Incomplete runs are excluded.</p>${workspace.runs.length ? workspace.runs.map((r) => `<button class="history-row ${r.id === run?.id ? "selected" : ""}" data-run="${r.id}"><span><strong>${esc(r.name)}</strong><small>${new Date(r.createdAt).toLocaleString()} · ${esc(r.model)} · ${runOutcomeMarkup(r.outcome)}</small></span><span>${r.id === best?.id ? '<b class="best">Best on these cases</b>' : ""} ${r.questionMetrics[selectedQuestion]?.accuracy == null ? "—" : `${(r.questionMetrics[selectedQuestion]?.accuracy! * 100).toFixed(0)}%`}</span></button>`).join("") : '<p class="hint">Saved runs will appear here.</p>'}${best && !workspace.runs.some((r) => r.id === best.id) ? `<button class="history-row" data-run="${best.id}"><span><strong>${esc(best.name)}</strong><small>${new Date(best.createdAt).toLocaleString()} · ${esc(best.model)}</small></span><span><b class="best">Best on these cases</b> ${(best.questionMetrics[selectedQuestion].accuracy! * 100).toFixed(0)}%</span></button>` : ""}${workspace.runCursor !== null ? `<button id="load-older-runs" type="button" aria-busy="${workspace.isLoadingHistory}" ${workspace.isLoadingHistory ? "disabled" : ""}>Load older runs</button>` : ""}</div></section></div><footer>Local by default · Model probabilities are not proof of correctness · Example answer keys use an authored definition</footer></main></div>`;
  bindNavigation();
  const aboutButton =
    document.querySelector<HTMLButtonElement>("#about-jeval")!;
  const aboutPopover = document.querySelector<HTMLElement>("#about-popover")!;
  const aboutDialog =
    document.querySelector<HTMLDialogElement>("#about-dialog")!;
  aboutButton.onclick = () => {
    if (matchMedia("(max-width: 700px)").matches)
      disclosures.open(aboutDialog, aboutButton);
    else {
      const rect = aboutButton.getBoundingClientRect();
      aboutPopover.style.left = `${Math.max(16, Math.min(rect.left, innerWidth - 496))}px`;
      aboutPopover.style.top = `${Math.max(16, Math.min(rect.bottom + 8, innerHeight - 200))}px`;
      aboutPopover.style.maxHeight = `${Math.max(160, innerHeight - parseFloat(aboutPopover.style.top) - 16)}px`;
      disclosures.open(aboutPopover, aboutButton);
    }
  };
  document.querySelector<HTMLButtonElement>("#close-about")!.onclick = () =>
    aboutPopover.hidePopover();
  document.querySelector<HTMLButtonElement>("#close-about-mobile")!.onclick =
    () => aboutDialog.close();
  document.querySelector<HTMLButtonElement>("#archive-evaluation")!.onclick =
    async () => {
      const id = workspace.id!;
      const archiving = !workspace.archivedAt;
      const button = document.querySelector<HTMLButtonElement>(
        "#archive-evaluation",
      )!;
      button.disabled = true;
      try {
        await changeArchive(id, archiving, workspace.revision);
        if (workspace.id !== id) {
          await refresh();
          return;
        }
        if (archiving) {
          archiveFilter = "active";
          await navigate(null);
          notify("Evaluation archived. Find it under Show → Archived.");
        } else {
          await refresh();
          notify("Evaluation restored.");
        }
      } catch (e) {
        notify((e as Error).message, true);
        button.disabled = false;
      }
    };
  document.querySelector<HTMLButtonElement>("#add-question")!.onclick = () => {
    const picker = document.querySelector<HTMLElement>(
      "#question-type-picker",
    )!;
    picker.hidden = !picker.hidden;
    document
      .querySelector<HTMLButtonElement>("#add-question")!
      .setAttribute("aria-expanded", String(!picker.hidden));
    if (!picker.hidden)
      document.querySelector<HTMLButtonElement>("#add-noul")!.focus();
  };
  document.querySelector<HTMLButtonElement>("#add-noul")!.onclick = () => {
    const id = `question_${crypto.randomUUID().replaceAll("-", "")}`;
    upsertQuestion(workspace.suite, {
      id,
      name: `Question ${workspace.suite.questions!.length + 1}`,
      type: "noul",
      instructions: "",
      yes: "",
      no: "",
      threshold: 0.5,
    });
    selectedQuestion = id;
    markDirty();
    render();
    document.querySelector<HTMLInputElement>('[data-question="name"]')?.focus();
  };
  document.querySelector<HTMLButtonElement>("#add-choice")!.onclick = () => {
    const id = `question_${crypto.randomUUID().replaceAll("-", "")}`;
    upsertQuestion(workspace.suite, {
      id,
      name: `Question ${workspace.suite.questions.length + 1}`,
      type: "choice",
      instructions: "",
      criteria: { option_1: "", option_2: "" },
    });
    selectedQuestion = id;
    markDirty();
    render();
    document.querySelector<HTMLInputElement>('[data-question="name"]')?.focus();
  };
  document.querySelector<HTMLButtonElement>("#add-score")!.onclick = () => {
    const id = `question_${crypto.randomUUID().replaceAll("-", "")}`;
    upsertQuestion(workspace.suite, {
      id,
      name: `Question ${workspace.suite.questions.length + 1}`,
      type: "score",
      instructions: "",
      criteria: ["", ""],
    });
    selectedQuestion = id;
    markDirty();
    render();
    document.querySelector<HTMLInputElement>('[data-question="name"]')?.focus();
  };
  const scoreQuestion = () => {
    const current = workspace.suite.questions.find((item) => item.id === q?.id);
    return current?.type === "score" ? current : undefined;
  };
  const changeLevels = (change: (levels: string[]) => void) => {
    const current = scoreQuestion();
    if (!current) return;
    editQuestion(
      workspace.suite,
      current.id,
      (q) => {
        if (q.type === "score") change(q.criteria);
      },
      true,
    );
    markDirty();
    render();
    document.querySelector<HTMLButtonElement>("#add-score-level")?.focus();
  };
  root
    .querySelector<HTMLButtonElement>("#add-score-level")
    ?.addEventListener("click", () =>
      changeLevels((levels) => {
        if (levels.length < 10) levels.push("");
      }),
    );
  root.querySelectorAll<HTMLTextAreaElement>("[data-score-level]").forEach(
    (el) =>
      (el.oninput = () => {
        const current = scoreQuestion();
        if (current) {
          current.criteria[Number(el.dataset.scoreLevel)] = el.value;
          markDirty();
        }
      }),
  );
  for (const direction of ["up", "down", "remove"] as const)
    root
      .querySelectorAll<HTMLButtonElement>(`[data-score-${direction}]`)
      .forEach(
        (el) =>
          (el.onclick = () =>
            changeLevels((levels) => {
              const i = Number(el.getAttribute(`data-score-${direction}`));
              if (direction === "remove") levels.splice(i, 1);
              else {
                const j = i + (direction === "up" ? -1 : 1);
                [levels[i], levels[j]] = [levels[j], levels[i]];
              }
            })),
      );
  const choiceQuestion = () => {
    const current = workspace.suite.questions.find((item) => item.id === q?.id);
    return current?.type === "choice" ? current : undefined;
  };
  document
    .querySelector<HTMLButtonElement>("#add-choice-option")
    ?.addEventListener("click", () => {
      const current = choiceQuestion();
      if (!current) return;
      let n = 1;
      while (Object.hasOwn(current.criteria, `option_${n}`)) n++;
      editQuestion(workspace.suite, current.id, (q) => {
        if (q.type === "choice") q.criteria[`option_${n}`] = "";
      });
      markDirty();
      render();
      root
        .querySelector<HTMLInputElement>(`[data-choice-label="option_${n}"]`)
        ?.focus();
    });
  root.querySelectorAll<HTMLInputElement>("[data-choice-label]").forEach(
    (el) =>
      (el.onchange = () => {
        const current = choiceQuestion();
        if (!current) return;
        const old = el.dataset.choiceLabel!,
          label = el.value.trim();
        if (
          !label ||
          (label !== old && Object.hasOwn(current.criteria, label)) ||
          ["__proto__", "constructor", "prototype"].includes(label)
        ) {
          el.value = old;
          notify("Use a nonempty, distinct option label.", true);
          return;
        }
        editQuestion(workspace.suite, current.id, (q) => {
          if (q.type === "choice")
            q.criteria = Object.fromEntries(
              Object.entries(q.criteria).map(([key, value]) => [
                key === old ? label : key,
                value,
              ]),
            );
        });
        // Keep the controls mounted so blur/Tab/click reaches the intended next field.
        el.value = label;
        el.dataset.choiceLabel = label;
        const option = el.closest<HTMLElement>(".choice-option");
        const description = option?.querySelector<HTMLTextAreaElement>(
          "[data-choice-description]",
        );
        const remove = option?.querySelector<HTMLButtonElement>(
          "[data-remove-choice]",
        );
        if (description) description.dataset.choiceDescription = label;
        if (remove) {
          remove.dataset.removeChoice = label;
          remove.setAttribute("aria-label", `Remove option ${label}`);
        }
        markDirty();
      }),
  );
  root
    .querySelectorAll<HTMLTextAreaElement>("[data-choice-description]")
    .forEach(
      (el) =>
        (el.oninput = () => {
          const current = choiceQuestion();
          if (!current) return;
          current.criteria[el.dataset.choiceDescription!] = el.value;
          markDirty();
        }),
    );
  root.querySelectorAll<HTMLButtonElement>("[data-remove-choice]").forEach(
    (el) =>
      (el.onclick = () => {
        const current = choiceQuestion();
        if (!current) return;
        const label = el.dataset.removeChoice!;
        editQuestion(workspace.suite, current.id, (q) => {
          if (q.type === "choice") delete q.criteria[label];
        });
        markDirty();
        render();
        document
          .querySelector<HTMLButtonElement>("#add-choice-option")
          ?.focus();
      }),
  );
  document
    .querySelector<HTMLButtonElement>("#remove-question")
    ?.addEventListener("click", () => {
      removeQuestion(workspace.suite, q!.id);
      selectedQuestion = workspace.suite.questions[0]?.id ?? "";
      markDirty();
      render();
      document.querySelector<HTMLButtonElement>("#add-question")?.focus();
    });
  root.querySelectorAll<HTMLElement>("[data-question-id]").forEach(
    (el) =>
      (el.onclick = () => {
        selectedQuestion = el.dataset.questionId!;
        render();
      }),
  );
  for (const selector of ["#case-question", "#result-question"]) {
    const select = document.querySelector<HTMLSelectElement>(selector);
    if (select)
      select.onchange = () => {
        selectedQuestion = select.value;
        render();
        document.querySelector<HTMLSelectElement>(selector)?.focus();
      };
  }
  root
    .querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-question]")
    .forEach(
      (el) =>
        (el.oninput = () => {
          const question = workspace.suite.questions!.find(
            (item) => item.id === q?.id,
          );
          if (!question) {
            notify(
              "This question was removed. Open Definition to edit another question.",
              true,
            );
            return;
          }
          Object.assign(question, {
            [el.dataset.question!]:
              el.dataset.question === "threshold" ? Number(el.value) : el.value,
          });
          markDirty();
        }),
    );
  root.querySelectorAll<HTMLAnchorElement>("[data-tab]").forEach(
    (el) =>
      (el.onclick = (e) => {
        e.preventDefault();
        void navigate(workspace.id, el.dataset.tab!, true, active);
      }),
  );
  const schemaDetails =
    document.querySelector<HTMLDetailsElement>("#schema-editor")!;
  schemaDetails.addEventListener("toggle", () => {
    if (schemaDetails.isConnected) schemaOpen = schemaDetails.open;
  });
  root
    .querySelectorAll<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >("[data-field]")
    .forEach((el) => {
      el.addEventListener("input", () => {
        const container = el.closest<HTMLElement>("[data-schema-key]");
        const field = workspace.suite.stateSchema?.find(
          (f) => f.key === container?.dataset.schemaKey,
        );
        if (!field) {
          notify("This schema field changed. Refresh before editing it.", true);
          return;
        }
        Object.assign(field, {
          [el.dataset.field!]:
            el.dataset.field === "required"
              ? (el as HTMLInputElement).checked
              : el.value,
        });
        if (container) container.dataset.schemaKey = field.key;
        markDirty();
        refreshCaseState();
      });
    });
  document.querySelector<HTMLButtonElement>("#add-field")!.onclick = () => {
    const fields = (workspace.suite.stateSchema ??= []);
    let key = "field";
    let n = 1;
    while (fields.some((f) => f.key === key)) key = `field_${n++}`;
    fields.push({
      key,
      label: "New field",
      type: "text",
      required: false,
      defaultValue: "",
    });
    schemaOpen = true;
    markDirty();
    render();
  };
  root.querySelectorAll<HTMLElement>("[data-remove-field]").forEach(
    (el) =>
      (el.onclick = () => {
        const key =
          el.closest<HTMLElement>("[data-schema-key]")?.dataset.schemaKey;
        const index =
          workspace.suite.stateSchema?.findIndex((f) => f.key === key) ?? -1;
        if (index < 0) return;
        workspace.suite.stateSchema!.splice(index, 1);
        schemaOpen = true;
        markDirty();
        render();
      }),
  );
  if (c) bindCaseState();
  root
    .querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-suite]")
    .forEach((el) =>
      el.addEventListener("input", () => {
        const key = el.dataset.suite!;
        Object.assign(workspace.suite, {
          [key]: key === "threshold" ? Number(el.value) : el.value,
        });
        if (key === "description") {
          const description =
            document.querySelector<HTMLElement>("#jeval-description")!;
          description.textContent = el.value;
          document.querySelector("#mobile-description")!.textContent = el.value;
          document.querySelector<HTMLButtonElement>("#about-jeval")!.hidden =
            !el.value.trim();
        }
        markDirty();
      }),
    );
  root
    .querySelectorAll<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >('[data-case]:not([data-case="state"])')
    .forEach((el) =>
      el.addEventListener("input", () => {
        const editedCase = workspace.suite.cases.find(
          (item) => item.id === c?.id,
        );
        if (!editedCase) return;
        const key = el.dataset.case!;
        const currentCase = editedCase;
        if (key === "expected" && q) {
          if (el.value === "") delete currentCase.expectations![q.id];
          else
            currentCase.expectations![q.id] = {
              value: expectedValue(q, el.value),
              rationale: currentCase.expectations![q.id]?.rationale ?? "",
              ...(currentCase.expectations[q.id]?.tolerance !== undefined
                ? { tolerance: currentCase.expectations[q.id].tolerance }
                : {}),
            };
          const tolerance = root.querySelector<HTMLInputElement>(
            '[data-case="tolerance"]',
          );
          if (tolerance) {
            tolerance.disabled = el.value === "";
            tolerance.value = String(
              currentCase.expectations[q.id]?.tolerance ?? "",
            );
          }
          const rationale = document.querySelector<HTMLTextAreaElement>(
            '[data-case="rationale"]',
          );
          if (rationale) {
            rationale.disabled = el.value === "";
            rationale.value = currentCase.expectations![q.id]?.rationale ?? "";
          }
        } else if (
          key === "tolerance" &&
          q?.type === "score" &&
          currentCase.expectations[q.id]
        ) {
          if (el.value === "") delete currentCase.expectations[q.id].tolerance;
          else currentCase.expectations[q.id].tolerance = Number(el.value);
        } else if (key === "rationale" && q && currentCase.expectations![q.id])
          currentCase.expectations![q.id].rationale = el.value;
        else Object.assign(currentCase, { [key]: el.value });
        const badge = root.querySelector<HTMLElement>(
          `[data-index="${workspace.selected}"] small`,
        );
        if (badge && q)
          badge.textContent = expectationLabel(
            q,
            currentCase.expectations[q.id],
          );
        markDirty();
      }),
    );
  root.querySelectorAll<HTMLElement>("[data-index]").forEach(
    (el) =>
      (el.onclick = () => {
        workspace.selected = Number(el.dataset.index);
        render();
      }),
  );
  document
    .querySelector<HTMLButtonElement>("#load-older-runs")
    ?.addEventListener("click", async (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      const id = workspace.id;
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      try {
        if (await workspace.loadMoreRuns()) {
          render();
          (
            document.querySelector<HTMLElement>("#load-older-runs") ??
            document.querySelector<HTMLElement>("#history-title")
          )?.focus();
        }
      } catch (error) {
        if (workspace.id === id) notify((error as Error).message, true);
      } finally {
        if (button.isConnected) {
          button.disabled = false;
          button.setAttribute("aria-busy", "false");
        }
      }
    });
  root.querySelectorAll<HTMLElement>("[data-run]").forEach(
    (el) =>
      (el.onclick = async () => {
        el.setAttribute("aria-busy", "true");
        const id = workspace.id;
        try {
          if (!(await workspace.selectRun(el.dataset.run!))) return;
          active = el.dataset.run!;
          tab = "results";
          history.pushState(
            {},
            "",
            `/evaluations/${workspace.id}/results?run=${active}`,
          );
          render();
        } catch (error) {
          if (workspace.id === id) notify((error as Error).message, true);
        } finally {
          if (el.isConnected) el.setAttribute("aria-busy", "false");
        }
      }),
  );
  root.querySelectorAll<HTMLElement>("[data-trace]").forEach(
    (el) =>
      (el.onclick = async () => {
        const row = resultRows[Number(el.dataset.trace)];
        const runId = run!.id,
          questionId = selectedQuestion,
          id = workspace.id;
        const version = ++traceRequest;
        document.querySelector("#trace")!.innerHTML =
          '<p role="status">Loading request trace…</p>';
        try {
          const r = await api(
            `/api/runs/${encodeURIComponent(runId)}/traces/${encodeURIComponent(row.case.id)}`,
          );
          if (
            version !== traceRequest ||
            workspace.id !== id ||
            workspace.run?.id !== runId ||
            selectedQuestion !== questionId
          )
            return;
          document.querySelector("#trace")!.innerHTML =
            `<details open><summary>${esc(row.case.name)} · request trace</summary><p>${r.latencyMs.toFixed(0)}ms · ${money(r.cost)} estimated · ${esc(r.error ?? row.expected?.rationale)}</p><pre>${esc(JSON.stringify({ request: r.request, response: r.response, error: r.error, questionId, answer: row.answer }, null, 2))}</pre></details>`;
        } catch (error) {
          if (version === traceRequest && workspace.id === id)
            document.querySelector("#trace")!.textContent = (
              error as Error
            ).message;
        }
      }),
  );
  document.querySelector<HTMLButtonElement>("#add")!.onclick = () => {
    try {
      validateSchema(workspace.suite.stateSchema ?? []);
    } catch (e) {
      notify((e as Error).message, true);
      return;
    }
    workspace.suite.cases.push({
      id: crypto.randomUUID(),
      name: "New case",
      state: initialState(workspace.suite.stateSchema ?? []),
      expectations: {},
    });
    workspace.selected = workspace.suite.cases.length - 1;
    markDirty();
    render();
  };
  document
    .querySelector<HTMLButtonElement>("#remove")
    ?.addEventListener("click", () => {
      workspace.suite.cases.splice(workspace.selected, 1);
      workspace.selected = Math.max(0, workspace.selected - 1);
      markDirty();
      render();
    });
  document.querySelector<HTMLButtonElement>("#save")!.onclick = async () => {
    try {
      const id = workspace.id!;
      const saving = workspace.save(id);
      updateSaveState();
      await saving;
      updateSaveState();
      const list = await api("/api/evaluations");
      evaluations = list.evaluations;
      if (workspace.id === id)
        notify(
          workspace.dirty
            ? "Snapshot saved. New edits remain unsaved."
            : "Changes saved.",
        );
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      updateSaveState();
    }
  };
  document.querySelector<HTMLButtonElement>("#run")!.onclick = async () => {
    const id = workspace.id!;
    if (isRunning(id)) return;
    pendingRuns.add(id);
    render();
    try {
      const saving = workspace.save(id);
      updateSaveState();
      await saving;
      updateSaveState();
      const result = await api("/api/runs", "POST", { evaluationId: id });
      if (workspace.id === id) {
        active = result.id;
        tab = "results";
        history.pushState(
          {},
          "",
          `/evaluations/${id}/results?run=${result.id}`,
        );
      }
      if (workspace.id === id) await navigate(id, "results", true, result.id);
      else await refresh();
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      pendingRuns.delete(id);
      updateSaveState();
    }
  };
  if (q) {
    // A clean focused control can outlive an externally replaced question.
    // Check before target handlers run; advance after local edits commit.
    let mountedQuestion = JSON.stringify(q);
    const currentQuestion = () =>
      workspace.suite.questions.find((item) => item.id === q.id);
    root
      .querySelectorAll<HTMLElement>(
        "[data-question],[data-score-level],[data-score-up],[data-score-down],[data-score-remove],[data-choice-label],[data-choice-description],[data-remove-choice],#add-score-level,#add-choice-option,#remove-question,[data-case=expected],[data-case=tolerance],[data-case=rationale]",
      )
      .forEach((el) => {
        for (const event of ["input", "change", "click"]) {
          el.addEventListener(
            event,
            (e) => {
              if (JSON.stringify(currentQuestion()) !== mountedQuestion) {
                e.preventDefault();
                e.stopImmediatePropagation();
                notify(
                  "This question changed. Refresh its controls before editing.",
                  true,
                );
                disclosures.defer();
                return;
              }
            },
            { capture: true },
          );
          el.addEventListener(event, () => {
            mountedQuestion = JSON.stringify(currentQuestion());
          });
        }
      });
  }
}
async function refresh() {
  let list: { evaluations: EvaluationSummary[]; configured: boolean };
  const accepted = await workspace.refresh(async () => {
    list = await api("/api/evaluations");
  });
  if (!accepted) return false;
  evaluations = list!.evaluations;
  configured = list!.configured;
  updateRunControls();
  if (document.activeElement?.matches("input,textarea,select"))
    disclosures.defer();
  else render();
  return true;
}
function route() {
  const match = location.pathname.match(
    /^\/evaluations\/([^/]+)(?:\/(results|cases|definition|runs))?$/,
  );
  return {
    id: match ? decodeURIComponent(match[1]) : null,
    tab: match?.[2] ?? "results",
    runId: new URLSearchParams(location.search).get("run"),
  };
}
const initial = route();
await navigate(initial.id, initial.tab, false, initial.runId);
window.addEventListener("popstate", () => {
  const current = route();
  void navigate(current.id, current.tab, false, current.runId);
});
setInterval(async () => {
  if (
    !evaluations.some((e) => e.latestRun?.status === "running") &&
    workspace.run?.status !== "running" &&
    !workspace.runs.some((run) => run.status === "running") &&
    !disclosures.pending
  )
    return;
  try {
    await refresh();
  } catch {
    notify("Could not refresh results. Check the local server.", true);
  }
}, 1500);
await registerWebMCP({
  workspace,
  changed: async () => {
    await refresh();
  },
  open: async (id, nextTab) => {
    await navigate(id, nextTab);
  },
  creationDialog: async (action) => {
    if (action === "open") {
      creationTrigger = workspace.id ? "sidebar-create" : "new-evaluation";
      const dialog =
        document.querySelector<HTMLDialogElement>("#create-dialog")!;
      if (!dialog.open) {
        disclosures.open(dialog, document.getElementById(creationTrigger)!);
      }
    } else document.querySelector<HTMLDialogElement>("#create-dialog")?.close();
  },
  status: (message) => {
    document.documentElement.dataset.webmcpStatus = message;
  },
});
window.addEventListener("beforeunload", (e) => {
  if (workspace.hasUnsavedChanges()) {
    e.preventDefault();
  }
});

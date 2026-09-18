import type { Question, ExpectedAnswer } from "./types.js";
import type { metrics, questionResults } from "./questions.js";
export const esc = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

/** Typed fields and display rules; DOM focus and navigation stay in the browser adapter. */
export function questionEditor(q: Question | undefined): string {
  if (!q)
    return '<p class="hint">No questions yet. Add a question to define what this evaluation checks.</p>';
  const fields =
    q.type === "noul"
      ? `<div class="pair"><label>Yes means<textarea data-question="yes" rows="3">${esc(q.yes)}</textarea></label><label>No means<textarea data-question="no" rows="3">${esc(q.no)}</textarea></label></div><label>Yes threshold<input data-question="threshold" type="number" min="0" max="1" step="0.05" value="${q.threshold}"></label>`
      : q.type === "score"
        ? `<div class="section-title"><h3>Ordered levels</h3><button id="add-score-level" type="button" ${q.criteria.length >= 10 ? "disabled" : ""}>Add level</button></div><p class="hint">Use 2–10 descriptions, ordered from lowest to highest. Changing level order clears expected scores for review.</p>${q.criteria.map((level, i) => `<div class="choice-option"><label>Level ${i}<textarea data-score-level="${i}" rows="2">${esc(level)}</textarea></label><button data-score-up="${i}" type="button" ${i === 0 ? "disabled" : ""} aria-label="Move level ${i} up">Move up</button><button data-score-down="${i}" type="button" ${i === q.criteria.length - 1 ? "disabled" : ""} aria-label="Move level ${i} down">Move down</button><button data-score-remove="${i}" type="button" aria-label="Remove level ${i}">Remove level</button></div>`).join("")}`
        : `<div class="section-title"><h3>Options</h3><button id="add-choice-option" type="button">Add option</button></div><p class="hint">Use distinct labels and descriptions. Add at least two options before running.</p>${Object.entries(
            q.criteria,
          )
            .map(
              ([label, description], i) =>
                `<div class="choice-option"><label>Option ${i + 1} label<input data-choice-label="${esc(label)}" value="${esc(label)}" maxlength="200"></label><label>Option ${i + 1} description<textarea data-choice-description="${esc(label)}" rows="2">${esc(description)}</textarea></label><button data-remove-choice="${esc(label)}" type="button" aria-label="Remove option ${esc(label)}">Remove option</button></div>`,
            )
            .join("")}`;
  return `<div class="question-editor"><p class="hint">${q.type === "noul" ? "Noul" : q.type === "score" ? "Score" : "Choice"} · Question ID: ${esc(q.id)}</p><label>Question name<input data-question="name" value="${esc(q.name)}"></label><label>Question<textarea data-question="instructions" rows="3">${esc(q.instructions)}</textarea></label>${fields}<button id="remove-question" type="button">Remove question</button></div>`;
}
export function expectationLabel(
  q: Question,
  expected: ExpectedAnswer | undefined,
): string {
  if (!expected) return "Needs expected answer";
  return `Expected ${q.type === "noul" ? (expected.value === true ? "yes" : "no") : expected.value}`;
}
export function expectationOptions(
  q: Question,
  expected: ExpectedAnswer | undefined,
): string {
  const values =
    q.type === "noul"
      ? ([
          ["true", "Yes", true],
          ["false", "No", false],
        ] as const)
      : q.type === "score"
        ? q.criteria.map(
            (label, i) => [String(i), `${i}: ${label}`, i] as const,
          )
        : Object.keys(q.criteria).map(
            (label) => [label, label, label] as const,
          );
  return `<option value="" ${!expected ? "selected" : ""}>Select expected answer</option>${values.map(([value, label, match]) => `<option value="${esc(value)}" ${expected?.value === match ? "selected" : ""}>${esc(label)}</option>`).join("")}`;
}
export function expectedValue(
  q: Question,
  value: string,
): boolean | string | number {
  return q.type === "noul"
    ? value === "true"
    : q.type === "score"
      ? Number(value)
      : value;
}
export function resultHeaders(q: Question | undefined): string {
  return `<th>Case</th>${q?.type === "score" ? "<th>Score</th><th>Confidence</th><th>Absolute error</th>" : q?.type === "choice" ? "<th>Choice</th><th>Confidence</th>" : "<th>P(yes)</th>"}<th>Expected</th><th>Result</th>`;
}
export function resultRow(
  row: ReturnType<typeof questionResults>[number],
  i: number,
  q: Question | undefined,
): string {
  const { answer: a, expected } = row;
  const result =
    !a || a.error || a.correct === null
      ? "Error"
      : a.correct
        ? "Correct"
        : "Incorrect";
  const output =
    q?.type === "score"
      ? `<td>${a?.type === "score" ? (a.score?.toFixed(3) ?? "—") : "—"}${
          a?.type === "score" && a.probabilities
            ? `<details class="choice-distribution"><summary>Level probabilities</summary><dl>${Object.entries(
                a.probabilities,
              )
                .map(
                  ([level, p]) =>
                    `<div><dt>${esc(level)}: ${esc(q.criteria[Number(level)])}</dt><dd>${p.toFixed(3)}</dd></div>`,
                )
                .join("")}</dl></details>`
            : ""
        }</td><td>${a?.type === "score" ? (a.confidence?.toFixed(3) ?? "—") : "—"}</td><td>${a?.type === "score" && a.score !== null && typeof expected?.value === "number" ? Math.abs(a.score - expected.value).toFixed(3) : "—"}</td>`
      : q?.type === "choice"
        ? `<td>${esc(a?.type === "choice" ? (a.choice ?? "—") : "—")}${
            a?.type === "choice" && a.probabilities
              ? `<details class="choice-distribution"><summary>Probabilities</summary><dl>${Object.entries(
                  a.probabilities,
                )
                  .map(
                    ([label, p]) =>
                      `<div><dt>${esc(label)}</dt><dd>${p.toFixed(3)}</dd></div>`,
                  )
                  .join("")}</dl></details>`
              : ""
          }</td><td>${a?.type === "choice" ? (a.confidence?.toFixed(3) ?? "—") : "—"}</td>`
        : `<td>${a?.type === "noul" ? (a.probability?.toFixed(3) ?? "—") : "—"}</td>`;
  return `<tr><td><button class="trace-link" data-trace="${i}">${esc(row.case.name)}</button></td>${output}<td>${typeof expected?.value === "boolean" ? (expected.value ? "Yes" : "No") : esc(expected?.value ?? "—")}${q?.type === "score" && expected ? ` ± ${esc(expected.tolerance ?? 0.5)}` : ""}</td><td><span class="verdict ${result === "Correct" ? "good" : "bad"}">${q?.type === "score" && result !== "Error" ? (result === "Correct" ? "Within tolerance" : "Outside tolerance") : result}</span></td></tr>`;
}
export function metricDetails(
  q: Question | undefined,
  m: ReturnType<typeof metrics>,
): string {
  if (q?.type === "noul")
    return `<p class="run-meta">False positives: ${m.falsePositive} · False negatives: ${m.falseNegative} · Yes threshold: ${q.threshold}</p>`;
  if (q?.type === "score")
    return `<p class="run-meta">Scale: 0–${q.criteria.length - 1}. Pass rate uses each case’s tolerance (default 0.5 levels). Lower mean absolute error is better. Confidence is separate from correctness.</p>`;
  if (q?.type !== "choice") return "";
  return `<p class="run-meta">Confidence describes the distribution; it does not establish correctness. Multiclass Brier sums squared errors across all options (0–2).</p>${m.confusion.length ? `<details><summary>Confusion counts</summary><div class="table-wrap"><table><thead><tr><th>Expected option</th><th>Selected option</th><th>Cases</th></tr></thead><tbody>${m.confusion.map((r) => `<tr><td>${esc(r.expected)}</td><td>${esc(r.predicted)}</td><td>${r.count}</td></tr>`).join("")}</tbody></table></div></details>` : ""}`;
}

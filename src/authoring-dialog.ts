import type { Suite, Question, Case } from "./types.js";
import { esc, sdkLabel } from "./question-presentation.js";
import { stateErrors } from "./state-schema.js";
import { validateSuite } from "./questions.js";
import { upsertQuestion } from "./question-authoring.js";

/** Owns isolated creation drafts. Cancelling never changes the evaluation. */
export function authoringDialog(
  suite: Suite,
  kind: "question" | "case",
  commit: (value: Question | Case) => void,
): HTMLDialogElement {
  const baseline = JSON.stringify(suite);
  const dialog = document.createElement("dialog");
  dialog.id = "authoring-dialog";
  dialog.className = "authoring-dialog";
  dialog.setAttribute("aria-labelledby", "authoring-title");
  dialog.setAttribute("aria-describedby", "authoring-help");
  const fields = suite.stateSchema ?? [];
  dialog.innerHTML = `<form><h2 id="authoring-title">Add ${kind}</h2><p class="hint" id="authoring-help">${kind === "question" ? "Combine primitives in one Jeval. Every question uses the same case state." : "Describe an example and the answers you expect."}</p><p class="schema-errors" role="alert" id="authoring-error" tabindex="-1"></p><label>${kind === "question" ? "Question" : "Case"} name<input name="name" required maxlength="200" autofocus></label>${kind === "question" ? `<label>${sdkLabel("Primitive", "type")}<select name="type"><option value="noul">Noul · Yes/no</option><option value="choice">Choice · Select an option</option><option value="score">Score · Ordered rubric</option></select></label><label>${sdkLabel("Question", "instructions")}<textarea name="instructions" rows="3" required></textarea></label><div id="primitive-fields"></div>` : `${fields.length ? fields.map((f, i) => `<label>${sdkLabel(`${esc(f.label)}${f.required ? "" : " · Optional"}`, `state[${JSON.stringify(f.key)}]`)}<textarea name="state_${i}" rows="${f.type === "long-text" ? 4 : 2}" ${f.required ? "required" : ""}>${esc(f.defaultValue)}</textarea></label>`).join("") : `<label>${sdkLabel("State · Plain text or JSON", "state")}<textarea name="state" rows="5" required></textarea></label>`}${suite.questions.map((q, i) => `<fieldset><legend>${esc(q.name)} · ${esc(q.type)}</legend><label>Expected answer${q.type === "score" ? `<input name="expected_${i}" type="number" min="0" max="${q.criteria.length - 1}" step="any"><span class="hint">${q.criteria.map((level, n) => `${n}: ${esc(level)}`).join(" · ")}</span></label><label>Tolerance · Optional<input name="tolerance_${i}" type="number" min="0" max="${q.criteria.length - 1}" step="any">` : `<select name="expected_${i}"><option value="">Label later</option>${(q.type === "noul" ? ["Yes", "No"] : Object.keys(q.criteria)).map((label, n) => `<option value="${n}">${esc(label)}</option>`).join("")}</select>`}</label><label>Why this answer? · Optional<textarea name="rationale_${i}" rows="2"></textarea></label></fieldset>`).join("")}`}<div class="actions"><button class="primary" type="submit">Add ${kind}</button><button type="button" id="cancel-authoring">Cancel</button></div></form>`;
  const form = dialog.querySelector("form")!;
  if (kind === "case") {
    const defaults = fields
      .map((field, index) => ({ field, index }))
      .filter(({ field }) => field.defaultValue.trim());
    if (defaults.length) {
      const section = document.createElement("fieldset");
      section.className = "prefilled-state";
      section.innerHTML =
        '<legend>Prefilled state</legend><p class="hint">These values come from this Jeval’s state-schema defaults. Keep them as they are, or change them for this case.</p>';
      for (const { index } of defaults) {
        const label = form
          .querySelector(`[name="state_${index}"]`)!
          .closest("label")!;
        section.append(label);
      }
      form.insertBefore(section, form.querySelector(".actions"));
    }
  }

  let activeType = "";
  const primitiveDrafts = new Map<string, Record<string, string>>();
  const primitive = () => {
    const container = dialog.querySelector<HTMLElement>("#primitive-fields")!;
    if (activeType)
      primitiveDrafts.set(
        activeType,
        Object.fromEntries(
          [
            ...container.querySelectorAll<
              HTMLInputElement | HTMLTextAreaElement
            >("[name]"),
          ].map((el) => [el.name, el.value]),
        ),
      );
    const type = (form.elements.namedItem("type") as HTMLSelectElement).value;
    dialog.querySelector("#primitive-fields")!.innerHTML =
      type === "noul"
        ? `<label>${sdkLabel("Yes means", "criteria.true")}<textarea name="yes" rows="2"></textarea></label><label>${sdkLabel("No means", "criteria.false")}<textarea name="no" rows="2"></textarea></label><label>Yes threshold<input name="threshold" type="number" min="0" max="1" step="any" value="0.5" required></label>`
        : `<label>${sdkLabel(type === "choice" ? "Options · One label | description per line" : "Ordered levels · One description per line, lowest to highest", "criteria")}<textarea name="criteria" rows="6" required placeholder="${type === "choice" ? "sandwich | Meets the sandwich definition\nother | Does not meet the definition" : "Poor\nAcceptable\nExcellent"}"></textarea></label>`;
    for (const el of container.querySelectorAll<
      HTMLInputElement | HTMLTextAreaElement
    >("[name]")) {
      const saved = primitiveDrafts.get(type)?.[el.name];
      if (saved !== undefined) el.value = saved;
    }
    activeType = type;
  };
  if (kind === "question") {
    primitive();
    form
      .querySelector<HTMLSelectElement>('[name="type"]')!
      .addEventListener("change", primitive);
  }
  dialog
    .querySelector("#cancel-authoring")!
    .addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      if (JSON.stringify(suite) !== baseline)
        throw Error(
          "The evaluation changed while this form was open. Cancel and reopen it to use the latest definition.",
        );
      const data = new FormData(form),
        get = (key: string) => String(data.get(key) ?? "");
      const id =
        kind === "question"
          ? `question_${crypto.randomUUID().replaceAll("-", "")}`
          : crypto.randomUUID();
      let value: Question | Case;
      if (kind === "question") {
        const base = {
          id,
          name: get("name").trim(),
          instructions: get("instructions").trim(),
        };
        const type = get("type");
        const lines = get("criteria")
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);
        if (type === "choice") {
          const entries = lines.map((line) => {
            const split = line.indexOf("|");
            return [
              split < 0 ? line : line.slice(0, split).trim(),
              split < 0 ? "" : line.slice(split + 1).trim(),
            ];
          });
          if (
            entries.length < 2 ||
            new Set(entries.map((e) => e[0])).size !== entries.length
          )
            throw Error("Add at least two distinct option labels.");
          value = {
            ...base,
            type: "choice",
            criteria: Object.fromEntries(entries),
          };
        } else if (type === "score") {
          if (lines.length < 2) throw Error("Add at least two ordered levels.");
          value = { ...base, type: "score", criteria: lines };
        } else
          value = {
            ...base,
            type: "noul",
            yes: get("yes"),
            no: get("no"),
            threshold: Number(get("threshold")),
          };
        // Reuse the question transaction without validating unrelated draft fields.
        upsertQuestion(structuredClone(suite), value);
      } else {
        value = {
          id,
          name: get("name").trim(),
          state: fields.length
            ? JSON.stringify(
                Object.fromEntries(
                  fields.map((f, i) => [f.key, get(`state_${i}`)]),
                ),
                null,
                2,
              )
            : get("state"),
          expectations: {},
        };
        const c = value as Case;
        suite.questions.forEach((q, i) => {
          const expected = get(`expected_${i}`);
          if (expected !== "")
            c.expectations[q.id] = {
              value:
                q.type === "noul"
                  ? expected === "0"
                  : q.type === "choice"
                    ? Object.keys(q.criteria)[Number(expected)]
                    : Number(expected),
              rationale: get(`rationale_${i}`),
              ...(q.type === "score" && get(`tolerance_${i}`) !== ""
                ? { tolerance: Number(get(`tolerance_${i}`)) }
                : {}),
            };
        });
        if (suite.cases.length >= 100)
          throw Error("A Jeval can have at most 100 cases.");
        // Validate this case's schema and keyed answers; other edits may be incomplete.
        validateSuite({
          name: "Case authoring",
          model: "Case authoring",
          questions: suite.questions.map((q) => ({ ...q, name: "Question" })),
          stateSchema: fields,
          cases: [c],
        });
        const errors = stateErrors({ ...suite, cases: [c] });
        if (errors.length) throw Error(errors.join(" "));
      }
      commit(value);
      dialog.close();
    } catch (error) {
      const message = dialog.querySelector<HTMLElement>("#authoring-error")!;
      message.textContent = (error as Error).message;
      message.focus();
    }
  });
  return dialog;
}

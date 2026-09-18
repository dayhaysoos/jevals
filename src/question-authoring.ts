import type { Suite, Question } from "./types.js";
import { validateSuite } from "./questions.js";

/** Shared authoring transaction: either question edits and answer invalidation commit together,
 * or an invalid draft leaves the caller's suite untouched. Saved Run snapshots are never edited. */
export function replaceQuestions(
  suite: Suite,
  questions: Question[],
  structuralIds: string[] = [],
): void {
  const next = structuredClone({ ...suite, questions });
  for (const before of suite.questions) {
    const after = next.questions.find((q) => q.id === before.id);
    const scoreStructureChanged =
      before.type === "score" &&
      after?.type === "score" &&
      (before.criteria.length !== after.criteria.length ||
        (JSON.stringify(before.criteria) !== JSON.stringify(after.criteria) &&
          JSON.stringify([...before.criteria].sort()) ===
            JSON.stringify([...after.criteria].sort())));
    const clear =
      !after ||
      before.type !== after.type ||
      structuralIds.includes(before.id) ||
      scoreStructureChanged;
    for (const c of next.cases) {
      const expected = c.expectations[before.id];
      if (
        clear ||
        (after?.type === "choice" &&
          expected &&
          !Object.hasOwn(after.criteria, String(expected.value)))
      )
        delete c.expectations[before.id];
    }
  }
  // Question authoring must not reject unrelated, temporarily incomplete form fields.
  const valid = validateSuite({
    name: "Question authoring",
    model: "Question authoring",
    questions: next.questions,
    cases: next.cases.map((c) => ({
      id: c.id,
      name: "Case",
      state: "",
      expectations: c.expectations,
    })),
  });
  suite.questions = valid.questions;
  // Keep case objects mounted in the browser; commit only reviewed answer changes.
  for (let i = 0; i < suite.cases.length; i++)
    suite.cases[i].expectations = valid.cases[i].expectations;
}
export function upsertQuestion(suite: Suite, question: Question): void {
  const index = suite.questions.findIndex((q) => q.id === question.id);
  const next = structuredClone(suite.questions);
  if (index < 0) next.push(question);
  else next[index] = question;
  replaceQuestions(suite, next);
}
export function removeQuestion(suite: Suite, id: string): void {
  if (!suite.questions.some((q) => q.id === id))
    throw Error("Question not found.");
  replaceQuestions(
    suite,
    suite.questions.filter((q) => q.id !== id),
  );
}
export function editQuestion(
  suite: Suite,
  id: string,
  edit: (q: Question) => void,
  structural = false,
): void {
  const next = structuredClone(suite.questions),
    q = next.find((q) => q.id === id);
  if (!q) throw Error("Question not found.");
  edit(q);
  replaceQuestions(suite, next, structural ? [id] : []);
}

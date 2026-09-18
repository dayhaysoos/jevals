import { test } from "node:test";
import assert from "node:assert/strict";
import type { Suite, ScoreQuestion } from "../src/types.js";
import {
  editQuestion,
  replaceQuestions,
  upsertQuestion,
  removeQuestion,
} from "../src/question-authoring.js";
const fixture = (): Suite => ({
  name: "Authoring",
  model: "jev-1.13.0",
  questions: [
    {
      id: "score",
      name: "Quality",
      type: "score",
      instructions: "Assess",
      criteria: ["Poor", "Fair", "Good"],
    },
    {
      id: "choice",
      name: "Kind",
      type: "choice",
      instructions: "Classify",
      criteria: { a: "A", b: "B" },
    },
  ],
  cases: [
    {
      id: "one",
      name: "One",
      state: "Example",
      expectations: {
        score: { value: 1, rationale: "Reviewed", tolerance: 0.4 },
        choice: { value: "a", rationale: "Reviewed" },
      },
    },
    {
      id: "two",
      name: "Two",
      state: "Another",
      expectations: {
        score: { value: 2, rationale: "Reviewed" },
        choice: { value: "b", rationale: "Reviewed" },
      },
    },
  ],
});
test("browser edits and whole-question replacements share Score invalidation", () => {
  const browser = fixture(),
    agent = fixture(),
    collection = fixture();
  editQuestion(
    browser,
    "score",
    (q) => {
      if (q.type === "score")
        [q.criteria[1], q.criteria[2]] = [q.criteria[2], q.criteria[1]];
    },
    true,
  );
  const reordered = {
    ...agent.questions[0],
    criteria: ["Poor", "Good", "Fair"],
  } as ScoreQuestion;
  upsertQuestion(agent, reordered);
  replaceQuestions(collection, [reordered, collection.questions[1]]);
  assert.deepEqual(browser, agent);
  assert.deepEqual(agent, collection);
  for (const c of agent.cases) {
    assert.equal(c.expectations.score, undefined);
    assert.ok(c.expectations.choice);
  }
  for (const criteria of [
    ["Poor", "Fair"],
    ["Poor", "Fair", "Good", "Excellent"],
  ]) {
    const s = fixture();
    upsertQuestion(s, { ...reordered, criteria });
    assert.equal(s.cases[0].expectations.score, undefined);
  }
});
test("Choice changes invalidate only removed labels; wording and additions preserve answers", () => {
  const s = fixture(),
    caseObject = s.cases[0];
  editQuestion(s, "choice", (q) => {
    if (q.type === "choice") q.criteria = { renamed: "A", b: "B", c: "C" };
  });
  assert.equal(s.cases[0], caseObject);
  assert.equal(s.cases[0].expectations.choice, undefined);
  assert.equal(s.cases[1].expectations.choice.value, "b");
  assert.ok(s.cases[0].expectations.score);
  const wording = fixture(),
    expected = structuredClone(wording.cases);
  editQuestion(wording, "score", (q) => {
    q.instructions = "New prompt";
    if (q.type === "score") q.criteria[1] = "Average";
  });
  editQuestion(wording, "choice", (q) => {
    if (q.type === "choice") q.criteria.c = "New option";
  });
  assert.deepEqual(wording.cases, expected);
});
test("primitive changes and question removal clear their answers, invalid edits are atomic", () => {
  const s = fixture();
  upsertQuestion(s, {
    id: "score",
    name: "Quality",
    type: "noul",
    instructions: "Assess",
    yes: "Yes",
    no: "No",
    threshold: 0.5,
  });
  assert.equal(s.cases[0].expectations.score, undefined);
  assert.ok(s.cases[0].expectations.choice);
  removeQuestion(s, "choice");
  assert.deepEqual(s.cases[0].expectations, {});
  const invalid = fixture(),
    before = structuredClone(invalid);
  assert.throws(() =>
    upsertQuestion(invalid, {
      ...invalid.questions[0],
      criteria: Array(11).fill("Level"),
    } as ScoreQuestion),
  );
  assert.deepEqual(invalid, before);
  assert.throws(() => removeQuestion(invalid, "missing"));
  assert.deepEqual(invalid, before);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { seed } from "../src/seed.js";
import type { Suite, Run, Result } from "../src/types.js";
import {
  decodeSuite,
  decodeRun,
  encodeSuite,
  type SnapshotResult,
  type SnapshotRun,
} from "../src/snapshots.js";
import {
  validateSuite,
  requestQuestions,
  decodeAnswers,
  failedAnswers,
  metrics,
  questionMetrics,
  questionResults,
  runOutcome,
  bestRun,
} from "../src/questions.js";

function fixture() {
  const suite = structuredClone(seed);
  suite.cases = suite.cases.slice(0, 1);
  const first = suite.questions![0];
  assert.equal(first.type, "noul");
  suite.questions!.push({ ...first, id: "second", name: "Second" });
  suite.cases[0].expectations = {
    [first.id]: { value: true, rationale: "Reviewed yes" },
    second: { value: false, rationale: "Reviewed no" },
  };
  return validateSuite(suite, true);
}
function result(suite: Suite, raw: unknown): Result {
  const answers = decodeAnswers(suite, suite.cases[0], raw);
  return {
    case: suite.cases[0],
    answers,
    latencyMs: 20,
    request: {},
    response: raw,
    error: Object.values(answers).some((a) => a.error)
      ? "Invalid answers"
      : null,
    inputTokens: 100,
    outputTokens: 5,
    cost: 0.01,
  };
}
function run(
  suite: Suite,
  results: Result[],
  status: Run["status"] = "complete",
): Run {
  return {
    id: "test",
    createdAt: "",
    suite,
    results,
    status,
    datasetKey: "same",
  };
}

test("Noul contract supports drafts but refuses unsupported types and incomplete runnable expectations", () => {
  const s = fixture();
  delete s.cases[0].expectations!.second;
  assert.doesNotThrow(() => validateSuite(s));
  assert.throws(
    () => validateSuite(s, true),
    /expected answer for every question/,
  );
  s.questions![1] = {
    id: "second",
    name: "Second",
    type: "choice",
    instructions: "Pick",
    criteria: { a: "A", b: "B" },
  };
  assert.doesNotThrow(() => validateSuite(s));
  assert.throws(
    () =>
      validateSuite({
        ...s,
        questions: [
          {
            id: "score",
            name: "Score",
            type: "unsupported",
            instructions: "Score",
            criteria: [],
          },
        ],
      }),
    /Use Noul, Choice, or Score/,
  );
  for (const invalid of [
    null,
    {},
    { cases: [null] },
    { cases: [], questions: [null] },
  ]) {
    assert.throws(() => validateSuite(invalid));
  }
});

test("batched Noul request retains each question's instructions and criteria", () => {
  const s = fixture();
  const q = requestQuestions(s);
  assert.deepEqual(Object.keys(q), ["judgment", "second"]);
  assert.equal(q.judgment.type, "noul");
  assert.equal(q.second.instructions, s.questions![1].instructions);
});

test("missing or malformed sibling answers preserve valid metrics and count request resources once", () => {
  const s = fixture();
  for (const bad of [
    undefined,
    null,
    { type: "choice", choice: "a" },
    { type: "noul", noul: "0.1" },
    { type: "noul", noul: 1.1 },
    { type: "noul", noul: NaN },
  ]) {
    const r = run(
      s,
      [result(s, { judgment: { type: "noul", noul: 0.9 }, second: bad })],
      "failed",
    );
    assert.equal(runOutcome(r), "partial");
    const m = questionMetrics(r);
    assert.equal(m.judgment.accuracy, 1);
    assert.equal(m.second.accuracy, null);
    assert.match(r.results[0].answers!.second.error!, /invalid probability/);
    assert.equal(metrics(r).inputTokens, 100);
    assert.equal(m.judgment.inputTokens, 100);
    assert.equal(m.second.cost, 0.01);
    assert.equal(bestRun([r], r, "judgment"), undefined);
  }
  const none = run(s, [result(s, null)], "failed");
  assert.equal(runOutcome(none), "failed");
  assert.equal(questionMetrics(none).judgment.accuracy, null);
  assert.equal(Object.keys(failedAnswers(s, "Request failed")).length, 2);
});

test("successful means valid answers, not correct judgments; best excludes running, partial and failed runs", () => {
  const s = fixture();
  const success = run(s, [
    result(s, {
      judgment: { type: "noul", noul: 0.1 },
      second: { type: "noul", noul: 0.9 },
    }),
  ]);
  assert.equal(runOutcome(success), "complete");
  assert.equal(questionMetrics(success).judgment.accuracy, 0);
  const partial = run(
    s,
    [result(s, { judgment: { type: "noul", noul: 0.9 } })],
    "failed",
  );
  const malformedComplete = { ...partial, status: "complete" as const };
  const otherDataset = { ...success, id: "other", datasetKey: "other" };
  assert.equal(
    bestRun(
      [
        partial,
        malformedComplete,
        { ...success, status: "running" },
        otherDataset,
        success,
      ],
      success,
      "judgment",
    ),
    success,
  );
  assert.equal(runOutcome(run(s, [], "failed")), "failed");
  assert.equal(runOutcome({ ...partial, status: "running" }), "running");
});

test("legacy and keyed historical runs have equivalent metrics without mutating snapshots; unknown IDs do not borrow first answers", () => {
  const suite = encodeSuite(seed);
  delete suite.questions;
  suite.cases = suite.cases.slice(0, 1);
  suite.cases[0].expected = true;
  delete suite.cases[0].expectations;
  const legacyResult: SnapshotResult = {
    case: suite.cases[0],
    probability: 0.9,
    correct: true,
    latencyMs: 20,
    request: {},
    response: {},
    error: null,
    inputTokens: 100,
    outputTokens: 5,
    cost: 0.01,
  };
  const legacySnapshot: SnapshotRun = {
    id: "old",
    createdAt: "",
    suite,
    results: [legacyResult],
    status: "complete",
    datasetKey: "same",
  };
  const legacy = decodeRun(legacySnapshot);
  const before = structuredClone(legacySnapshot);
  const canonical = decodeSuite(suite);
  const keyed = run(canonical, [
    result(canonical, { judgment: { type: "noul", noul: 0.9 } }),
  ]);
  assert.deepEqual(questionMetrics(legacy), questionMetrics(keyed));
  assert.equal(runOutcome(legacy), "complete");
  assert.equal(runOutcome(keyed), "complete");
  assert.equal(metrics(keyed, "absent").accuracy, null);
  assert.equal(questionResults(keyed, "absent")[0].answer, undefined);
  assert.deepEqual(legacySnapshot, before);
});

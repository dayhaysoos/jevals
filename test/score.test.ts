import { test } from "node:test";
import assert from "node:assert/strict";
import type { Suite, Run } from "../src/types.js";
import {
  validateSuite,
  decodeAnswers,
  metrics,
  runOutcome,
  bestRun,
  requestQuestions,
} from "../src/questions.js";
import { Store } from "../src/store.js";
import { RunExecutor } from "../src/run-executor.js";
const fixture = (): Suite => ({
  name: "Bug severity",
  model: "jev-1.13.0",
  questions: [
    {
      id: "severity",
      name: "Severity",
      type: "score",
      instructions: "How severe?",
      criteria: [
        "Cosmetic",
        "Degraded with workaround",
        "Blocking without workaround",
      ],
    },
    {
      id: "bug",
      name: "Bug?",
      type: "noul",
      instructions: "Is it a bug?",
      yes: "Bug",
      no: "No bug",
      threshold: 0.5,
    },
  ],
  cases: [
    {
      id: "export",
      name: "Export",
      state: "Export fails, CSV works",
      expectations: {
        severity: { value: 1, rationale: "Workaround" },
        bug: { value: true, rationale: "Broken export" },
      },
    },
  ],
});
const raw = (score = 1.3) => ({
  severity: {
    type: "score",
    score,
    confidence: 0.54,
    probabilities: { "0": 0, "1": 2 - score, "2": score - 1 },
  },
  bug: { type: "noul", noul: 0.9 },
});
function run(s = fixture(), score = 1.3): Run {
  return {
    id: "r",
    evaluationId: "e",
    createdAt: "",
    suite: s,
    datasetKey: "same",
    status: "complete",
    results: [
      {
        case: s.cases[0],
        answers: decodeAnswers(s, s.cases[0], raw(score)),
        request: {},
        response: raw(score),
        error: null,
        latencyMs: 1,
        inputTokens: 10,
        outputTokens: 2,
        cost: 0.01,
      },
    ],
  };
}
test("Score validates ordered rubric, numeric expectations and finite tolerance", () => {
  const s = fixture();
  assert.doesNotThrow(() => validateSuite(s, true));
  assert.equal(requestQuestions(s).severity.type, "score");
  for (const value of [-1, 3, NaN, "1"]) {
    const c = structuredClone(s);
    Object.assign(c.cases[0].expectations.severity, { value });
    assert.throws(() => validateSuite(c, true));
  }
  for (const tolerance of [-1, NaN, Infinity, 3]) {
    const c = structuredClone(s);
    c.cases[0].expectations.severity.tolerance = tolerance;
    assert.throws(() => validateSuite(c, true));
  }
  const draft = structuredClone(s);
  if (draft.questions[0].type === "score") draft.questions[0].criteria = [];
  delete draft.cases[0].expectations.severity;
  assert.doesNotThrow(() => validateSuite(draft));
  assert.throws(() => validateSuite(draft, true));
});
test("Score fractional error and tolerance are independent of confidence; malformed siblings stay partial", () => {
  const r = run();
  assert.equal(runOutcome(r), "complete");
  assert.ok(Math.abs(metrics(r, "severity").meanAbsoluteError! - 0.3) < 1e-9);
  assert.equal(metrics(r, "severity").brier, null);
  assert.equal(metrics(r, "severity").accuracy, 1);
  r.suite.cases[0].expectations.severity.tolerance = 0.1;
  r.results[0].answers = decodeAnswers(r.suite, r.suite.cases[0], raw());
  assert.equal(metrics(r, "severity").accuracy, 0);
  assert.equal(runOutcome(r), "complete");
  for (const malformed of [
    { ...raw().severity, score: 9 },
    { ...raw().severity, probabilities: { "0": 0, "1": 0.7 } },
    { ...raw().severity, score: 1.9 },
    { ...raw().severity, confidence: NaN },
    { ...raw().severity, probabilities: { "0": 0, "1": 0.2, "2": 0.2 } },
  ]) {
    r.results[0].answers = decodeAnswers(r.suite, r.suite.cases[0], {
      severity: malformed,
      bug: raw().bug,
    });
    assert.equal(runOutcome(r), "partial");
    assert.equal(metrics(r, "severity").meanAbsoluteError, null);
    assert.equal(metrics(r, "bug").accuracy, 1);
  }
});
test("Score best ranks lower error before tolerance pass rate in pure and SQLite reads", () => {
  const close = run();
  close.id = "close";
  close.suite.cases[0].expectations.severity.tolerance = 0;
  close.results[0].answers = decodeAnswers(
    close.suite,
    close.suite.cases[0],
    raw(),
  );
  const far = run(fixture(), 1.4);
  far.id = "far";
  assert.equal(bestRun([far, close], close, "severity")?.id, "close");
  const store = new Store(":memory:");
  store.saveRun(close);
  store.saveRun(far);
  assert.equal(store.selectedRun("far")?.bestRuns.severity?.id, "close");
  store.db.close();
});
test("Score execution preserves one request per case and rubric/tolerance comparability", async () => {
  const store = new Store(":memory:");
  const evaluation = store.create(fixture());
  let requests = 0;
  const executor = new RunExecutor({
    store,
    configured: true,
    redact: (s) => s,
    createProvider: () => ({
      systemOne: async (request) => {
        requests++;
        assert.equal(request.questions.severity.type, "score");
        return {
          model: "jev-1.13.0",
          answers: raw(),
          usage: { input_tokens: 10, output_tokens: 2 },
        };
      },
    }),
  });
  const first = executor.start({ evaluationId: evaluation.id });
  await first.finished;
  assert.equal(requests, 1);
  assert.equal(runOutcome(store.run(first.id)!), "complete");
  const changed = structuredClone(evaluation.suite);
  changed.cases[0].expectations.severity.tolerance = 0.1;
  store.update(evaluation.id, changed, evaluation.revision);
  const second = executor.start({ evaluationId: evaluation.id });
  await second.finished;
  assert.notEqual(
    store.run(first.id)!.datasetKey,
    store.run(second.id)!.datasetKey,
  );
  const latest = store.get(evaluation.id)!;
  const scale = structuredClone(latest.suite);
  if (scale.questions[0].type === "score")
    scale.questions[0].criteria.reverse();
  store.update(evaluation.id, scale, latest.revision);
  const third = executor.start({ evaluationId: evaluation.id });
  await third.finished;
  assert.notEqual(
    store.run(second.id)!.datasetKey,
    store.run(third.id)!.datasetKey,
  );
  store.db.close();
});

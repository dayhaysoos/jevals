import { test } from "node:test";
import assert from "node:assert/strict";
import type { Run, Suite } from "../src/types.js";
import {
  validateSuite,
  decodeAnswers,
  requestQuestions,
  metrics,
  questionResults,
  runOutcome,
  bestRun,
} from "../src/questions.js";
import {
  decodeRun,
  decodeSuite,
  encodeRun,
  encodeSuite,
} from "../src/snapshots.js";
import { seed } from "../src/seed.js";
import { Store } from "../src/store.js";
import { RunExecutor } from "../src/run-executor.js";

function suite(): Suite {
  return {
    name: "Support triage",
    model: "jev-1.13.0",
    questions: [
      {
        id: "refund",
        name: "Refund requested?",
        type: "noul",
        instructions: "Is a refund requested?",
        yes: "Money back",
        no: "No money back",
        threshold: 0.5,
      },
      {
        id: "department",
        name: "Department",
        type: "choice",
        instructions: "Which team should handle this?",
        criteria: {
          returns: "Exchanges or refunds",
          shipping: "Delivery status",
          billing: "Charges or invoices",
        },
      },
    ],
    cases: [
      {
        id: "wrong-size",
        name: "Wrong size",
        state: "Please refund these shoes; they are the wrong size.",
        expectations: {
          refund: { value: true, rationale: "Explicit refund" },
          department: { value: "returns", rationale: "Wrong size and refund" },
        },
      },
    ],
  };
}
const choice = {
  type: "choice",
  choice: "returns",
  confidence: 0.6,
  probabilities: { returns: 0.8, shipping: 0.1, billing: 0.1 },
};
function run(raw: unknown, s = suite()): Run {
  const answers = decodeAnswers(s, s.cases[0], raw);
  const error = Object.values(answers).some((a) => a.error)
    ? "One or more question answers are invalid."
    : null;
  return {
    id: "r",
    createdAt: "",
    suite: s,
    datasetKey: "same",
    status: error ? "failed" : "complete",
    results: [
      {
        case: s.cases[0],
        answers,
        error,
        latencyMs: 20,
        request: requestQuestions(s),
        response: raw,
        inputTokens: 100,
        outputTokens: 5,
        cost: 0.01,
      },
    ],
  };
}
test("canonical mixed definitions need no first-question compatibility fields", () => {
  const s = validateSuite(suite(), true);
  assert.equal("instructions" in s, false);
  assert.equal("expected" in s.cases[0], false);
  assert.equal(requestQuestions(s).department.type, "choice");
  const r = run({ refund: { type: "noul", noul: 0.9 }, department: choice });
  assert.equal("probability" in r.results[0], false);
  assert.equal(runOutcome(r), "complete");
  assert.equal(metrics(r, "department").accuracy, 1);
  assert.ok(Math.abs(metrics(r, "department").brier! - 0.06) < 1e-10);
  assert.deepEqual(metrics(r, "department").confusion, [
    { expected: "returns", predicted: "returns", count: 1 },
  ]);
  assert.equal(metrics(r, "department").falsePositive, null);
  assert.equal(metrics(r, "refund").inputTokens, 100);
});
test("malformed Choice answers preserve valid siblings, resources and request failure", () => {
  for (const bad of [
    undefined,
    null,
    [],
    { type: "noul", noul: 0.8 },
    { ...choice, choice: "other" },
    { ...choice, confidence: "0.6" },
    { ...choice, confidence: NaN },
    { ...choice, probabilities: { returns: 0.8, shipping: 0.2 } },
    {
      ...choice,
      probabilities: { returns: 0.8, shipping: 0.1, billing: 0.1, other: 0 },
    },
    { ...choice, probabilities: { returns: 0.2, shipping: 0.1, billing: 0.1 } },
    { ...choice, probabilities: { returns: 0.2, shipping: 0.7, billing: 0.1 } },
    {
      ...choice,
      probabilities: { returns: 0.8, shipping: -0.1, billing: 0.3 },
    },
    {
      ...choice,
      probabilities: { returns: 0.8, shipping: "0.1", billing: 0.1 },
    },
  ]) {
    const r = run({ refund: { type: "noul", noul: 0.9 }, department: bad });
    assert.equal(runOutcome(r), "partial");
    assert.equal(metrics(r, "refund").accuracy, 1);
    assert.equal(metrics(r, "department").accuracy, null);
    const row = questionResults(r, "refund")[0];
    assert.equal(row.answer?.error, null);
    assert.match(row.requestResult.error!, /invalid/);
    assert.equal(row.requestResult.inputTokens, 100);
    assert.equal(bestRun([r], r, "refund"), undefined);
  }
});
test("Choice can survive a malformed Noul sibling; valid wrong options are complete", () => {
  const partial = run({
    refund: { type: "noul", noul: 2 },
    department: choice,
  });
  assert.equal(runOutcome(partial), "partial");
  assert.equal(metrics(partial, "department").accuracy, 1);
  const wrong = run({
    refund: { type: "noul", noul: 0.9 },
    department: {
      ...choice,
      choice: "shipping",
      probabilities: { returns: 0.1, shipping: 0.8, billing: 0.1 },
    },
  });
  assert.equal(runOutcome(wrong), "complete");
  assert.equal(metrics(wrong, "department").accuracy, 0);
  assert.equal(bestRun([partial, wrong], wrong, "department"), wrong);
});
test("Choice expected labels must belong to options; incomplete drafts can be saved", () => {
  const s = suite();
  delete s.cases[0].expectations.department;
  assert.doesNotThrow(() => validateSuite(s));
  assert.throws(() => validateSuite(s, true), /expected answer/);
  s.cases[0].expectations.department = { value: true, rationale: "Wrong type" };
  assert.throws(() => validateSuite(s), /exact option label/);
  s.cases[0].expectations.department = {
    value: "unknown",
    rationale: "Unknown",
  };
  assert.throws(() => validateSuite(s), /exact option label/);
});
test("Choice distributions allow rounded sums and tied maxima", () => {
  const r = run({
    refund: { type: "noul", noul: 0.9 },
    department: {
      ...choice,
      probabilities: { returns: 0.33, shipping: 0.33, billing: 0.33 },
      confidence: 0,
    },
  });
  assert.equal(runOutcome(r), "complete");
});
test("historical JSON decodes without rewriting and mixed snapshots round-trip", () => {
  const historical = encodeRun(
    run({ refund: { type: "noul", noul: 0.9 }, department: choice }),
  );
  assert.deepEqual(
    decodeRun(historical),
    run({ refund: { type: "noul", noul: 0.9 }, department: choice }),
  );
  const legacySuite = encodeSuite(seed);
  delete legacySuite.questions;
  legacySuite.cases.forEach((c) => delete c.expectations);
  const old = {
    id: "legacy",
    createdAt: "",
    suite: legacySuite,
    results: [],
    status: "complete" as const,
    datasetKey: "old",
  };
  const before = JSON.stringify(old);
  const decoded = decodeRun(old);
  assert.equal(decoded.suite.questions[0].type, "noul");
  assert.equal(JSON.stringify(old), before);
});
test("executor batches Noul and Choice once per case; Choice option changes separate datasets", async () => {
  const store = new Store(":memory:");
  try {
    let saved = store.create(suite());
    let calls = 0;
    const executor = new RunExecutor({
      store,
      configured: true,
      redact: (s) => s,
      createProvider: () => ({
        async systemOne(request) {
          calls++;
          assert.equal(request.questions.refund.type, "noul");
          assert.equal(request.questions.department.type, "choice");
          return {
            model: "jev-1.13.0",
            answers: {
              refund: { type: "noul", noul: 0.9 },
              department: choice,
            },
            usage: { input_tokens: 100, output_tokens: 5 },
          };
        },
      }),
    });
    const first = await executor.start({ evaluationId: saved.id }).finished;
    assert.equal(calls, 1);
    assert.equal(runOutcome(first), "complete");
    assert.equal(
      store.run(first.id)!.results[0].answers.department.type,
      "choice",
    );
    assert.equal(store.snapshot(first.id)!.results[0].probability, 0.9);
    const changed = structuredClone(saved.suite);
    const q = changed.questions[1];
    assert.equal(q.type, "choice");
    if (q.type === "choice") q.criteria.other = "None of these";
    saved = store.update(saved.id, changed, saved.revision);
    const second = await executor.start({ evaluationId: saved.id }).finished;
    assert.notEqual(second.datasetKey, first.datasetKey);
    assert.equal(bestRun([first], second, "department"), undefined);
  } finally {
    store.db.close();
  }
});

test("malformed explicit collections cannot fall back to legacy fields", () => {
  const raw = { ...encodeSuite(seed), questions: null };
  assert.throws(() =>
    validateSuite(
      decodeSuite(raw as unknown as Parameters<typeof decodeSuite>[0]),
    ),
  );
  const caseShape = {
    ...encodeSuite(seed),
    cases: [{ ...encodeSuite(seed).cases[0], expectations: null }],
  };
  assert.throws(() =>
    validateSuite(
      decodeSuite(caseShape as unknown as Parameters<typeof decodeSuite>[0]),
    ),
  );
});

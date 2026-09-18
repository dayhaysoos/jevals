import { test } from "node:test";
import assert from "node:assert/strict";
import type { Run, Result } from "../src/types.js";
import { metrics } from "../src/questions.js";
const c = {
  id: "a",
  name: "A",
  state: "x",
  expectations: { judgment: { value: true, rationale: "known" } },
};
function run(results: Result[]): Run {
  return {
    id: "r",
    createdAt: "",
    datasetKey: "",
    status: "complete",
    suite: {
      name: "x",
      questions: [
        {
          id: "judgment",
          name: "Judgment",
          type: "noul",
          instructions: "x",
          yes: "",
          no: "",
          threshold: 0.5,
        },
      ],
      model: "x",
      cases: [c],
    },
    results,
  };
}
const result: Result = {
  case: c,
  answers: {
    judgment: { type: "noul", probability: 0.8, correct: true, error: null },
  },
  latencyMs: 10,
  request: {},
  response: {},
  error: null,
  inputTokens: 20,
  outputTokens: 3,
  cost: 0.00001,
};
test("Brier error measures probability correctness rather than confidence", () => {
  assert.ok(Math.abs(metrics(run([result])).brier! - 0.04) < 1e-10);
  assert.equal(metrics(run([result])).accuracy, 1);
  assert.equal(
    metrics(
      run([
        {
          ...result,
          answers: {
            judgment: {
              type: "noul",
              probability: 0.2,
              correct: false,
              error: null,
            },
          },
        },
      ]),
    ).falseNegative,
    1,
  );
});
test("failed requests never masquerade as perfect accuracy or free cost", () => {
  const m = metrics(
    run([
      {
        ...result,
        answers: {
          judgment: {
            type: "noul",
            probability: null,
            correct: null,
            error: "timeout",
          },
        },
        error: "timeout",
        cost: null,
      },
    ]),
  );
  assert.equal(m.accuracy, null);
  assert.equal(m.cost, null);
  assert.equal(m.brier, null);
});

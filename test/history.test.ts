import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import { seed } from "../src/seed.js";
import { encodeRun, encodeSuite } from "../src/snapshots.js";
import { decodeAnswers, metrics, bestRun } from "../src/questions.js";
import type { Run, Suite } from "../src/types.js";

function fixtureSuite(): Suite {
  const suite = structuredClone(seed);
  suite.cases = suite.cases.slice(0, 1);
  suite.questions.push({
    id: "department",
    name: "Department",
    type: "choice",
    instructions: "Route this",
    criteria: { returns: "Refunds", shipping: "Delivery" },
  });
  suite.cases[0].expectations.department = {
    value: "returns",
    rationale: "Reviewed",
  };
  return suite;
}
function run(
  id: string,
  evaluationId: string,
  suite: Suite,
  probability = 0.8,
): Run {
  const c = suite.cases[0];
  const raw = {
    judgment: { type: "noul", noul: probability },
    department: {
      type: "choice",
      choice: "returns",
      probabilities: { returns: 0.8, shipping: 0.2 },
      confidence: 0.4,
    },
  };
  return {
    id,
    evaluationId,
    suite: structuredClone(suite),
    createdAt: "2026-09-17",
    datasetKey: "same",
    status: "complete",
    results: [
      {
        case: c,
        answers: decodeAnswers(suite, c, raw),
        latencyMs: 5,
        inputTokens: 100,
        outputTokens: 5,
        cost: 0.01,
        error: null,
        request: { payload: "request-trace-marker".repeat(1000) },
        response: { ...raw, payload: "response-trace-marker".repeat(1000) },
      },
    ],
  };
}
test("home, bounded history and selected judgments do not read full run records", () => {
  const store = new Store(":memory:");
  try {
    const evaluation = store.create(fixtureSuite());
    for (let i = 0; i < 35; i++)
      store.saveRun(run(`run-${i}`, evaluation.id, evaluation.suite));
    const prepare = store.db.prepare.bind(store.db);
    let fullRecordQueries = 0;
    store.db.prepare = (sql) => {
      if (/\bFROM\s+runs\b/i.test(sql)) fullRecordQueries++;
      return prepare(sql);
    };
    const home = store.list().find((e) => e.id === evaluation.id)!;
    assert.equal(home.latestRun!.id, "run-34");
    const first = store.history(evaluation.id);
    assert.equal(first.runs.length, 20);
    assert.ok(first.nextCursor);
    const second = store.history(evaluation.id, first.nextCursor!);
    assert.equal(second.runs.length, 15);
    assert.equal(second.nextCursor, null);
    assert.equal(
      new Set([...first.runs, ...second.runs].map((r) => r.id)).size,
      35,
    );
    const selected = store.selectedRun("run-0", evaluation.id)!;
    assert.equal(selected.run.id, "run-0");
    assert.equal(fullRecordQueries, 0);
    assert.equal(JSON.stringify(first).includes("trace-marker"), false);
    assert.equal("suite" in first.runs[0], false);
    assert.equal("results" in first.runs[0], false);
    assert.equal("request" in selected.run.results[0], false);
    assert.equal("response" in selected.run.results[0], false);
    assert.equal(metrics(selected.run, "department").accuracy, 1);
    store.db.prepare = prepare;
    assert.ok(
      JSON.stringify(
        store.trace("run-0", evaluation.suite.cases[0].id),
      ).includes("request-trace-marker"),
    );
    assert.equal(store.trace("run-0", "other-case"), undefined);
  } finally {
    store.db.close();
  }
});
test("best ranking spans older pages and excludes partial, failed, running and changed datasets", () => {
  const store = new Store(":memory:");
  try {
    const evaluation = store.create(fixtureSuite());
    const best = run("best-old", evaluation.id, evaluation.suite, 0.95);
    store.saveRun(best);
    for (let i = 0; i < 25; i++)
      store.saveRun(run(`ordinary-${i}`, evaluation.id, evaluation.suite, 0.8));
    const partial = run("partial-perfect", evaluation.id, evaluation.suite, 1);
    delete partial.results[0].answers.department;
    partial.results[0].error = "Invalid sibling";
    partial.status = "failed";
    store.saveRun(partial);
    store.saveRun({
      ...run("running", evaluation.id, evaluation.suite, 1),
      status: "running",
    });
    store.saveRun({
      ...run("different", evaluation.id, evaluation.suite, 1),
      datasetKey: "different",
    });
    const reference = run("reference", evaluation.id, evaluation.suite, 0.8);
    store.saveRun(reference);
    assert.equal(
      store.history(evaluation.id).runs.some((r) => r.id === best.id),
      false,
    );
    assert.equal(
      store.selectedRun(reference.id)!.bestRuns.judgment!.id,
      best.id,
    );
    assert.equal(
      store.selectedRun(reference.id)!.bestRuns.department!.id,
      reference.id,
      "ties select newest eligible run",
    );
    assert.equal(
      store.selectedRun(reference.id, "another-evaluation"),
      undefined,
    );
    const improvedChoice = run(
      "choice-best",
      evaluation.id,
      evaluation.suite,
      0.8,
    );
    improvedChoice.results[0].answers = decodeAnswers(
      evaluation.suite,
      evaluation.suite.cases[0],
      {
        judgment: { type: "noul", noul: 0.8 },
        department: {
          type: "choice",
          choice: "returns",
          probabilities: { returns: 0.95, shipping: 0.05 },
          confidence: 0.9,
        },
      },
    );
    store.saveRun(improvedChoice);
    assert.equal(
      store.selectedRun(reference.id)!.bestRuns.department!.id,
      improvedChoice.id,
    );
  } finally {
    store.db.close();
  }
});
test("history cursors are stable across new insertions and progress writes", () => {
  const store = new Store(":memory:");
  try {
    const evaluation = store.create(fixtureSuite());
    for (let i = 0; i < 6; i++)
      store.saveRun(run(`old-${i}`, evaluation.id, evaluation.suite));
    const first = store.history(evaluation.id, undefined, 3);
    store.saveRun(run("new", evaluation.id, evaluation.suite));
    store.saveRun({
      ...run("old-0", evaluation.id, evaluation.suite),
      status: "failed",
    });
    const second = store.history(evaluation.id, first.nextCursor!, 3);
    assert.deepEqual(
      second.runs.map((r) => r.id),
      ["old-2", "old-1", "old-0"],
    );
    assert.equal(
      store.list().find((e) => e.id === evaluation.id)!.latestRun!.id,
      "new",
    );
    for (const [before, limit] of [
      [-1, 20],
      [0, 20],
      [1, 51],
      [1, 0],
      [1, 1.5],
      [NaN, 20],
    ])
      assert.throws(() => store.history(evaluation.id, before, limit));
  } finally {
    store.db.close();
  }
});
test("projection failure rolls back both raw snapshot and derived reads", () => {
  const store = new Store(":memory:");
  try {
    const evaluation = store.create(fixtureSuite());
    const original = run("atomic", evaluation.id, evaluation.suite);
    store.saveRun(original);
    const raw = store.db
      .prepare("SELECT json FROM runs WHERE id=?")
      .get(original.id)!.json;
    store.db.exec(
      "CREATE TRIGGER reject_projection BEFORE UPDATE ON run_summaries BEGIN SELECT RAISE(ABORT, 'projection failure'); END",
    );
    assert.throws(
      () => store.saveRun({ ...original, status: "failed" }),
      /projection failure/,
    );
    assert.equal(
      store.db.prepare("SELECT json FROM runs WHERE id=?").get(original.id)!
        .json,
      raw,
    );
    assert.equal(store.history(evaluation.id).runs[0].status, "complete");
    assert.equal(store.selectedRun(original.id)!.run.status, "complete");
  } finally {
    store.db.close();
  }
});
test("summary backfill is idempotent and recovery preserves historical definition and trace shapes", () => {
  const dir = mkdtempSync(join(tmpdir(), "jevals-history-")),
    path = join(dir, "test.sqlite");
  try {
    const suite = encodeSuite(seed);
    delete suite.questions;
    suite.cases.forEach((c) => delete c.expectations);
    const db = new DatabaseSync(path);
    db.exec(
      "CREATE TABLE evaluations(id TEXT PRIMARY KEY,json TEXT NOT NULL);CREATE TABLE runs(id TEXT PRIMARY KEY,json TEXT NOT NULL,evaluation_id TEXT)",
    );
    db.prepare("INSERT INTO evaluations VALUES(?,?)").run(
      "e",
      JSON.stringify({
        id: "e",
        suite,
        revision: 1,
        createdAt: "",
        updatedAt: "",
      }),
    );
    const finished = {
      id: "finished",
      evaluationId: "e",
      suite,
      createdAt: "",
      status: "complete",
      results: [],
      datasetKey: "same",
    };
    const interrupted = { ...finished, id: "interrupted", status: "running" };
    db.prepare("INSERT INTO runs VALUES(?,?,?)").run(
      finished.id,
      JSON.stringify(finished),
      "e",
    );
    db.prepare("INSERT INTO runs VALUES(?,?,?)").run(
      interrupted.id,
      JSON.stringify(interrupted),
      "e",
    );
    db.close();
    let store = new Store(path);
    assert.deepEqual(store.snapshot(finished.id), finished);
    assert.deepEqual(store.snapshot(interrupted.id), {
      ...interrupted,
      status: "failed",
    });
    assert.equal(store.history("e").runs.length, 2);
    assert.equal(store.history("e").runs[0].outcome, "failed");
    const json = store.db
      .prepare("SELECT json FROM run_summaries ORDER BY position")
      .all();
    store.db.close();
    store = new Store(path);
    assert.deepEqual(
      store.db
        .prepare("SELECT json FROM run_summaries ORDER BY position")
        .all(),
      json,
    );
    assert.deepEqual(store.snapshot(finished.id), finished);
    store.db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pure and cached ranking settle ties identically across all primitives and input orders", () => {
  const store = new Store(":memory:");
  try {
    const suite = fixtureSuite();
    suite.questions.push({
      id: "severity",
      name: "Severity",
      type: "score",
      instructions: "Rate",
      criteria: ["Low", "High"],
    });
    suite.cases[0].expectations.severity = { value: 1, rationale: "Reviewed" };
    const evaluation = store.create(suite);
    const candidates = ["z-old", "a-new", "z-new"].map((id) => {
      const candidate = run(id, evaluation.id, suite);
      candidate.createdAt =
        id === "z-old"
          ? "2026-09-17T01:00:00.000Z"
          : "2026-09-18T01:00:00.000Z";
      const raw = candidate.results[0].response;
      if (!raw || typeof raw !== "object")
        throw Error("Fixture response missing");
      const response = {
        ...raw,
        severity: {
          type: "score",
          score: 0.8,
          confidence: 0.8,
          probabilities: { "0": 0.2, "1": 0.8 },
        },
      };
      candidate.results[0].answers = decodeAnswers(
        suite,
        suite.cases[0],
        response,
      );
      return candidate;
    });
    // Deliberately insert the oldest run last, ruling out SQLite insertion-order ties.
    for (const candidate of [candidates[2], candidates[1], candidates[0]])
      store.saveRun(candidate);
    const cached = store.selectedRun(candidates[0].id)!;
    for (const question of suite.questions) {
      assert.equal(cached.bestRuns[question.id]!.id, "z-new");
      for (const ordered of [candidates, [...candidates].reverse()])
        assert.equal(bestRun(ordered, candidates[0], question.id)!.id, "z-new");
    }
  } finally {
    store.db.close();
  }
});

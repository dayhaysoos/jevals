import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import {
  RunExecutor,
  RunRequestError,
  type JudgmentProvider,
  type JudgmentRequest,
} from "../src/run-executor.js";
import { runOutcome } from "../src/questions.js";
import type { Run } from "../src/types.js";

function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "jevals-runner-"));
  const store = new Store(join(dir, "test.sqlite"));
  t.after(() => {
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const first = store.first();
  const suite = structuredClone(first.suite);
  suite.cases = suite.cases.slice(0, 1);
  const a = store.update(first.id, suite, first.revision);
  const b = store.create({ ...suite, name: "Independent B" });
  const requests: JudgmentRequest[] = [];
  let failSave: ((run: Run) => boolean) | undefined;
  let createProvider = (): JudgmentProvider => ({
    async systemOne(request) {
      requests.push(request);
      return {
        model: "jev-1.13.0",
        answers: Object.fromEntries(
          Object.keys(request.questions).map((id) => [
            id,
            { type: "noul", noul: 0.9 },
          ]),
        ),
        usage: { input_tokens: 100, output_tokens: 5 },
      };
    },
  });
  const executor = new RunExecutor({
    store: {
      get: (id) => store.get(id),
      first: () => store.first(),
      saveRun: (run) => {
        if (failSave?.(run)) throw Error("Simulated storage failure");
        store.saveRun(run);
      },
    },
    configured: true,
    redact: (message) => message.replaceAll("test-secret", "[redacted]"),
    createProvider: () => createProvider(),
  });
  return {
    store,
    executor,
    a,
    b,
    requests,
    failSave(predicate?: (run: Run) => boolean) {
      failSave = predicate;
    },
    provider(factory: () => JudgmentProvider) {
      createProvider = factory;
    },
  };
}

test("run admission snapshots saved definitions, batches questions and permits parallel Jevals only", async (t) => {
  const f = fixture(t);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.provider(() => ({
    async systemOne(request) {
      f.requests.push(request);
      await gate;
      return {
        model: "jev-1.13.0",
        answers: { judgment: { type: "noul", noul: 0.9 } },
        usage: { input_tokens: 100, output_tokens: 5 },
      };
    },
  }));
  const a = f.executor.start({ evaluationId: f.a.id });
  assert.equal(
    f.store.run(a.id)!.status,
    "running",
    "acceptance is durable before returning",
  );
  assert.throws(
    () => f.executor.start({ evaluationId: f.a.id }),
    (error) => error instanceof RunRequestError && error.status === 409,
  );
  const b = f.executor.start({ evaluationId: f.b.id });
  assert.equal(
    f.requests.length,
    2,
    "both evaluations reach the provider before either finishes",
  );
  f.store.update(
    f.a.id,
    { ...f.a.suite, name: "Edited after acceptance" },
    f.a.revision,
  );
  release();
  const [completedA, completedB] = await Promise.all([a.finished, b.finished]);
  assert.equal(completedA.status, "complete");
  assert.equal(completedB.status, "complete");
  assert.equal(completedA.suite.name, f.a.suite.name);
  const again = f.executor.start({ evaluationId: f.a.id });
  await again.finished;
});

test("initial persistence failure rejects acceptance without a provider call and releases admission", async (t) => {
  const f = fixture(t);
  f.failSave(() => true);
  assert.throws(
    () => f.executor.start({ evaluationId: f.a.id }),
    (error) => error instanceof RunRequestError && error.status === 500,
  );
  assert.equal(f.requests.length, 0);
  assert.equal(f.store.runs(f.a.id).length, 0);
  f.failSave();
  assert.equal(
    (await f.executor.start({ evaluationId: f.a.id }).finished).status,
    "complete",
  );
});

test("final persistence failure rejects completion but still releases admission", async (t) => {
  const f = fixture(t);
  f.failSave((run) => run.status === "complete");
  const accepted = f.executor.start({ evaluationId: f.a.id });
  await assert.rejects(accepted.finished, /storage failure/);
  assert.equal(
    f.store.run(accepted.id)!.status,
    "running",
    "failed final write cannot claim durable completion",
  );
  f.failSave();
  assert.equal(
    (await f.executor.start({ evaluationId: f.a.id }).finished).status,
    "complete",
  );
});

test("progress persistence failure finalizes as failed, preserves available results, and releases admission", async (t) => {
  const f = fixture(t);
  let failedOnce = false;
  f.failSave((run) => {
    if (!failedOnce && run.status === "running" && run.results.length) {
      failedOnce = true;
      return true;
    }
    return false;
  });
  const accepted = f.executor.start({ evaluationId: f.a.id });
  const failed = await accepted.finished;
  assert.equal(failed.status, "failed");
  assert.equal(f.store.run(accepted.id)!.status, "failed");
  assert.equal(runOutcome(failed), "partial");
  assert.equal(
    failed.results[0].answers.judgment.type === "noul"
      ? failed.results[0].answers.judgment.probability
      : null,
    0.9,
  );
  assert.equal(
    (await f.executor.start({ evaluationId: f.a.id }).finished).status,
    "complete",
  );
});

test("provider construction and request errors become failed runs with safe traces", async (t) => {
  const f = fixture(t);
  f.provider(() => {
    throw Error("Provider setup failed");
  });
  const setup = await f.executor.start({ evaluationId: f.a.id }).finished;
  assert.equal(setup.status, "failed");
  assert.equal(setup.results.length, 0);
  f.provider(() => ({
    async systemOne() {
      throw Error("Provider rejected test-secret");
    },
  }));
  const request = await f.executor.start({ evaluationId: f.a.id }).finished;
  assert.equal(request.status, "failed");
  assert.equal(request.results[0].cost, null);
  assert.equal(request.results[0].error, "Provider rejected [redacted]");
  assert.equal(runOutcome(request), "failed");
});

test("archived and incomplete evaluations are rejected before acceptance or provider requests", async (t) => {
  const f = fixture(t);
  f.store.setArchived(f.a.id, true, f.a.revision);
  assert.throws(
    () => f.executor.start({ evaluationId: f.a.id }),
    /Restore this evaluation/,
  );
  const b = f.store.get(f.b.id)!;
  f.store.update(b.id, { ...b.suite, cases: [] }, b.revision);
  assert.throws(() => f.executor.start({ evaluationId: b.id }), /1–100 cases/);
  assert.equal(f.requests.length, 0);
  assert.equal(f.store.runs(f.a.id).length, 0);
});

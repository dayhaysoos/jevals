import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.js";
import { seedExamples } from "../src/seed-examples.js";
import { validateSuite } from "../src/questions.js";
test("curated seeding is repeatable, preserves edited examples and never imports runs", () => {
  const store = new Store(":memory:", {
    starter: false,
  });
  try {
    assert.deepEqual(seedExamples(store), { added: 7, skipped: 0 });
    const before = store.db
      .prepare("SELECT id,json FROM evaluations ORDER BY id")
      .all();
    assert.deepEqual(seedExamples(store), { added: 0, skipped: 7 });
    assert.deepEqual(
      store.db.prepare("SELECT id,json FROM evaluations ORDER BY id").all(),
      before,
    );
    const evaluation = store.get(String(before[0].id))!;
    const suite = structuredClone(evaluation.suite);
    suite.name = "My edited example";
    store.update(evaluation.id, suite, evaluation.revision);
    assert.deepEqual(seedExamples(store), { added: 0, skipped: 7 });
    assert.equal(store.get(evaluation.id)!.suite.name, "My edited example");
    assert.equal(
      store.db.prepare("SELECT count(*) AS n FROM runs").get()!.n,
      0,
    );
    for (const row of before)
      validateSuite(store.get(String(row.id))!.suite, true);
  } finally {
    store.db.close();
  }
});
test("existing Jevals with example names are adopted without changing their content", () => {
  const store = new Store(":memory:");
  try {
    const before = store.db.prepare("SELECT id,json FROM evaluations").get()!;
    assert.deepEqual(seedExamples(store), { added: 6, skipped: 1 });
    assert.deepEqual(
      store.db
        .prepare("SELECT id,json FROM evaluations WHERE id=?")
        .get(String(before.id)),
      before,
    );
  } finally {
    store.db.close();
  }
});

test("opening a seed connection does not interrupt an active run", () => {
  const dir = mkdtempSync(join(tmpdir(), "jevals-seed-active-")),
    path = join(dir, "test.sqlite");
  const first = new Store(path);
  try {
    const evaluation = first.get(
      String(first.db.prepare("SELECT id FROM evaluations").get()!.id),
    )!;
    first.saveRun({
      id: "active",
      evaluationId: evaluation.id,
      createdAt: new Date().toISOString(),
      datasetKey: "same",
      status: "running",
      suite: evaluation.suite,
      results: [],
    });
    const before = first.db
      .prepare("SELECT json FROM runs WHERE id='active'")
      .get();
    const seeder = new Store(path, {
      starter: false,
    });
    try {
      seedExamples(seeder);
      assert.deepEqual(
        seeder.db.prepare("SELECT json FROM runs WHERE id='active'").get(),
        before,
      );
    } finally {
      seeder.db.close();
    }
  } finally {
    first.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

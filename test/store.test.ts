import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import {
  encodeSuite,
  decodeSuite,
  type SnapshotRun,
} from "../src/snapshots.js";
import { seed } from "../src/seed.js";
import type { Run } from "../src/types.js";
test("legacy migration preserves edited cases and run snapshots and stays idempotent", () => {
  const dir = mkdtempSync(join(tmpdir(), "jevals-migration-"));
  const path = join(dir, "eval.sqlite");
  try {
    const old = new DatabaseSync(path);
    old.exec(
      "CREATE TABLE settings(id INTEGER PRIMARY KEY,json TEXT NOT NULL); CREATE TABLE runs(id TEXT PRIMARY KEY,json TEXT NOT NULL)",
    );
    const suite = encodeSuite(seed);
    delete suite.stateSchema;
    suite.cases[0].state = "User-owned text";
    const run: SnapshotRun = {
      id: "legacy-run",
      createdAt: "2026-09-17",
      suite: structuredClone(suite),
      results: [],
      status: "complete",
      datasetKey: "legacy",
    };
    old.prepare("INSERT INTO settings VALUES(1,?)").run(JSON.stringify(suite));
    old
      .prepare("INSERT INTO runs VALUES(?,?)")
      .run(run.id, JSON.stringify(run));
    old.close();
    let store = new Store(path);
    const e = store.first();
    assert.equal(e.suite.cases[0].state, "User-owned text");
    assert.ok(e.suite.stateSchema);
    assert.equal(store.runs(e.id).length, 1);
    assert.deepEqual(store.run(run.id)!.suite, decodeSuite(run.suite));
    assert.equal(store.run(run.id)!.evaluationId, e.id);
    store.db.close();
    store = new Store(path);
    assert.equal(store.list().length, 1);
    assert.equal(store.first().id, e.id);
    assert.equal(store.runs(e.id).length, 1);
    store.db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("evaluations own their histories and stale revisions cannot overwrite saved edits", () => {
  const store = new Store(":memory:");
  try {
    const a = store.first();
    const b = store.create({
      ...structuredClone(seed),
      name: "Second evaluation",
      cases: [],
    });
    const updated = store.update(
      a.id,
      { ...a.suite, name: "Reviewed" },
      a.revision,
    );
    assert.equal(updated.revision, 2);
    assert.throws(
      () =>
        store.update(a.id, { ...a.suite, name: "Stale overwrite" }, a.revision),
      /changed elsewhere/,
    );
    assert.equal(store.get(a.id)!.suite.name, "Reviewed");
    store.saveRun({
      id: "owned",
      evaluationId: a.id,
      createdAt: "2026-09-17",
      suite: a.suite,
      results: [],
      status: "failed",
      datasetKey: "x",
    });
    assert.equal(store.runs(b.id).length, 0);
    assert.equal(store.runs(a.id).length, 1);
    assert.equal(store.list().find((e) => e.id === b.id)!.latestRun, null);
  } finally {
    store.db.close();
  }
});
test("saved evaluation collection migration is idempotent and does not change historical JSON", () => {
  const dir = mkdtempSync(join(tmpdir(), "jevals-questions-"));
  const path = join(dir, "eval.sqlite");
  try {
    const db = new DatabaseSync(path);
    db.exec(
      "CREATE TABLE evaluations(id TEXT PRIMARY KEY,json TEXT NOT NULL); CREATE TABLE runs(id TEXT PRIMARY KEY,json TEXT NOT NULL,evaluation_id TEXT)",
    );
    const suite = encodeSuite(seed);
    delete suite.questions;
    suite.cases.forEach((c) => delete c.expectations);
    suite.cases[0].rationale = "User-reviewed label";
    db.prepare("INSERT INTO evaluations VALUES(?,?)").run(
      "saved",
      JSON.stringify({
        id: "saved",
        suite,
        revision: 7,
        createdAt: "then",
        updatedAt: "then",
      }),
    );
    const historical = JSON.stringify({
      id: "old",
      evaluationId: "saved",
      suite,
      results: [],
      status: "complete",
      datasetKey: "old",
      createdAt: "then",
    });
    db.prepare("INSERT INTO runs VALUES(?,?,?)").run(
      "old",
      historical,
      "saved",
    );
    db.close();
    let store = new Store(path);
    const migrated = store.get("saved")!;
    assert.equal(migrated.revision, 8);
    assert.equal(migrated.suite.questions![0].id, "judgment");
    assert.equal(migrated.suite.questions![0].instructions, suite.instructions);
    assert.deepEqual(migrated.suite.cases[0].expectations!.judgment, {
      value: true,
      rationale: "User-reviewed label",
    });
    assert.equal(
      store.db.prepare("SELECT json FROM runs WHERE id='old'").get()!.json,
      historical,
    );
    store.db.close();
    store = new Store(path);
    assert.deepEqual(store.get("saved"), migrated);
    store.db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("archive and restore preserve definitions and run history, with revision protection", () => {
  const store = new Store(":memory:");
  try {
    const original = store.first();
    const run: Run = {
      id: "retained",
      evaluationId: original.id,
      suite: original.suite,
      results: [],
      status: "complete",
      datasetKey: "same",
      createdAt: "then",
    };
    store.saveRun(run);
    const history = store.db
      .prepare("SELECT json FROM runs WHERE id='retained'")
      .get()!.json;
    const archived = store.setArchived(original.id, true, original.revision);
    assert.ok(archived.archivedAt);
    assert.deepEqual(archived.suite, original.suite);
    assert.equal(store.list()[0].archivedAt, archived.archivedAt);
    assert.throws(
      () => store.setArchived(original.id, false, original.revision),
      /changed elsewhere/,
    );
    const edited = store.update(
      original.id,
      { ...original.suite, name: "Edited archive" },
      archived.revision,
    );
    assert.equal(edited.archivedAt, archived.archivedAt);
    const restored = store.setArchived(original.id, false, edited.revision);
    assert.equal(restored.archivedAt, null);
    assert.equal(restored.suite.name, "Edited archive");
    assert.equal(
      store.db.prepare("SELECT json FROM runs WHERE id='retained'").get()!.json,
      history,
    );
  } finally {
    store.db.close();
  }
});

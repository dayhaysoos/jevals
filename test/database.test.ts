import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../src/database.js";
import { Store } from "../src/store.js";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "jevals-owning-"));
  return {
    dir,
    path: join(dir, "db.sqlite"),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test("file and directory aliases cannot seed or recover an owned database", () => {
  const f = fixture();
  const first = openDatabase(f.path, "server");
  try {
    const evaluation = first.store.list()[0];
    first.store.saveRun({
      id: "active",
      evaluationId: evaluation.id,
      createdAt: "",
      datasetKey: "same",
      status: "running",
      suite: first.store.get(evaluation.id)!.suite,
      results: [],
    });
    const before = first.store.snapshot("active");
    const alias = join(f.dir, "alias.sqlite");
    symlinkSync(f.path, alias);
    const parentAlias = f.dir + "-alias";
    symlinkSync(f.dir, parentAlias, "dir");
    try {
      for (const path of [f.path, alias, join(parentAlias, "db.sqlite")]) {
        for (const purpose of ["seed", "server"] as const)
          assert.throws(() => openDatabase(path, purpose), /already using/);
      }
      assert.deepEqual(first.store.snapshot("active"), before);
    } finally {
      rmSync(parentAlias);
    }
  } finally {
    first.close();
    f.cleanup();
  }
});

test("only owning server startup recovers runs; close releases ownership once", () => {
  const f = fixture();
  try {
    const first = openDatabase(f.path, "server");
    const e = first.store.list()[0];
    first.store.saveRun({
      id: "interrupted",
      evaluationId: e.id,
      createdAt: "",
      datasetKey: "same",
      status: "running",
      suite: first.store.get(e.id)!.suite,
      results: [],
    });
    const before = first.store.snapshot("interrupted");
    first.close();
    const raw = new Store(f.path);
    assert.deepEqual(raw.snapshot("interrupted"), before);
    raw.db.close();
    const seeder = openDatabase(f.path, "seed");
    assert.deepEqual(seeder.store.snapshot("interrupted"), before);
    seeder.close();
    const restarted = openDatabase(f.path, "server");
    assert.deepEqual(restarted.store.snapshot("interrupted"), {
      ...before,
      status: "failed",
    });
    first.close();
    assert.throws(() => openDatabase(f.path, "seed"), /already using/);
    restarted.close();
    assert.equal(existsSync(f.path + ".lock"), false);
  } finally {
    f.cleanup();
  }
});

test("failed initialization and failed recovery release their database ownership", () => {
  for (const failure of ["initialization", "recovery"]) {
    const f = fixture();
    try {
      const initial = openDatabase(f.path, "server");
      if (failure === "recovery") {
        const e = initial.store.list()[0];
        initial.store.saveRun({
          id: "pending",
          evaluationId: e.id,
          createdAt: "",
          datasetKey: "same",
          status: "running",
          suite: initial.store.get(e.id)!.suite,
          results: [],
        });
      }
      initial.close();
      const db = new DatabaseSync(f.path);
      if (failure === "initialization")
        db.prepare("UPDATE evaluations SET json='invalid'").run();
      else
        db.exec(
          "CREATE TRIGGER refuse_recovery BEFORE UPDATE ON runs BEGIN SELECT RAISE(ABORT, 'recovery refused'); END",
        );
      db.close();
      assert.throws(() => openDatabase(f.path, "server"));
      assert.equal(existsSync(f.path + ".lock"), false);
      const repair = new DatabaseSync(f.path);
      repair.exec(
        "DROP TRIGGER IF EXISTS refuse_recovery; DELETE FROM evaluations; DELETE FROM runs; DELETE FROM run_summaries",
      );
      repair.close();
      const retry = openDatabase(f.path, "server");
      retry.close();
    } finally {
      f.cleanup();
    }
  }
});

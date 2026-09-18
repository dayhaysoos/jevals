import { test } from "node:test";
import assert from "node:assert/strict";
import { metrics } from "../src/questions.js";
import type { RunSummary, RunView } from "../src/types.js";
import { seed } from "../src/seed.js";
import {
  EvaluationWorkspace,
  type EvaluationDocument,
  type WorkspacePersistence,
} from "../src/workspace.js";

function gate() {
  let release!: () => void;
  let enter!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release, entered, enter };
}
function fixture() {
  const documents = new Map<string, EvaluationDocument>();
  for (const id of ["a", "b"])
    documents.set(id, {
      id,
      suite: { ...structuredClone(seed), name: id },
      revision: 1,
      createdAt: "",
      updatedAt: "",
      runs: [],
      runCursor: null,
      selectedRun: null,
      bestRuns: {},
    });
  let readGate: ReturnType<typeof gate> | undefined;
  let writeGate: ReturnType<typeof gate> | undefined;
  let writeError: Error | undefined;
  let writes = 0;
  const persistence: WorkspacePersistence = {
    async history() {
      return { runs: [], nextCursor: null };
    },
    async read(id) {
      const snapshot = structuredClone(documents.get(id)!);
      const pending = readGate;
      readGate = undefined;
      if (pending) {
        pending.enter();
        await pending.promise;
      }
      return snapshot;
    },
    async write(id, suite, revision) {
      writes++;
      const snapshot = structuredClone(suite);
      const pending = writeGate;
      writeGate = undefined;
      if (pending) {
        pending.enter();
        await pending.promise;
      }
      if (writeError) throw writeError;
      const old = documents.get(id)!;
      if (revision !== old.revision)
        throw Error("Evaluation changed elsewhere.");
      const saved = { ...old, suite: snapshot, revision: revision + 1 };
      documents.set(id, saved);
      return structuredClone(saved);
    },
    async archive(id, archived, revision) {
      const pending = writeGate;
      writeGate = undefined;
      if (pending) {
        pending.enter();
        await pending.promise;
      }
      const old = documents.get(id)!;
      if (revision !== old.revision)
        throw Error("Evaluation changed elsewhere.");
      const saved = {
        ...old,
        archivedAt: archived ? "now" : null,
        revision: revision + 1,
      };
      documents.set(id, saved);
      return structuredClone(saved);
    },
  };
  return {
    workspace: new EvaluationWorkspace(persistence),
    persistence,
    documents,
    pauseRead() {
      return (readGate = gate());
    },
    pauseWrite() {
      return (writeGate = gate());
    },
    failWrites(error?: Error) {
      writeError = error;
    },
    writes: () => writes,
  };
}

test("navigation preserves edits made during reads and ignores older navigation completions", async () => {
  const f = fixture(),
    w = f.workspace;
  await w.navigate("a");
  const read = f.pauseRead();
  const openingB = w.navigate("b");
  w.suite.name = "Edited during navigation";
  w.markDirty();
  read.release();
  assert.equal(await openingB, true);
  assert.equal(w.id, "b");
  await w.navigate("a");
  assert.equal(w.suite.name, "Edited during navigation");
  assert.equal(w.dirty, true);
  const older = f.pauseRead();
  const oldNavigation = w.navigate("b");
  await w.navigate(null);
  older.release();
  assert.equal(await oldNavigation, false);
  assert.equal(w.id, null);
  assert.equal(w.hasUnsavedChanges("a"), true);
});

test("save advances the baseline without losing newer edits across navigation and refresh", async () => {
  const f = fixture(),
    w = f.workspace;
  await w.navigate("a");
  w.suite.name = "Snapshot";
  w.markDirty();
  const write = f.pauseWrite();
  const saving = w.save("a");
  assert.equal(w.isSaving("a"), true);
  await assert.rejects(w.save("a"), /being saved/);
  w.suite.name = "Newer human edit";
  w.markDirty();
  await w.navigate("b");
  await w.refresh();
  write.release();
  await saving;
  assert.equal(f.documents.get("a")!.suite.name, "Snapshot");
  await w.navigate("a");
  assert.equal(w.suite.name, "Newer human edit");
  assert.equal(w.revision, 2);
  assert.equal(w.dirty, true);
  assert.equal(w.canMutate("a"), false);
  await w.save("a");
  assert.equal(w.revision, 3);
  assert.equal(w.dirty, false);
  assert.equal(f.documents.get("a")!.suite.name, "Newer human edit");
});

test("an agent rechecks human drafts after its pending read, before sending a write", async () => {
  const f = fixture(),
    w = f.workspace;
  await w.navigate("a");
  const read = f.pauseRead();
  const mutation = w.mutateSaved("a", 1, (suite) => {
    suite.name = "Agent update";
  });
  const rejected = assert.rejects(mutation, /unsaved UI edits/);
  w.suite.name = "Human update";
  w.markDirty();
  read.release();
  await rejected;
  assert.equal(f.writes(), 0);
  assert.equal(w.suite.name, "Human update");
  assert.equal(w.isSaving("a"), false);
  await w.save("a");
  assert.equal(w.revision, 2);
});

test("agent writes reconcile pending human edits; different Jevals can be written concurrently", async () => {
  const f = fixture(),
    w = f.workspace;
  await w.navigate("a");
  const write = f.pauseWrite();
  const mutation = w.mutateSaved("a", 1, (suite) => {
    suite.description = "Agent documentation";
  });
  // Wait for the agent read to finish and its write to start.
  await write.entered;
  w.suite.name = "Human edit during agent write";
  w.markDirty();
  await w.mutateSaved("b", 1, (suite) => {
    suite.name = "Independent B";
  });
  await w.refresh();
  write.release();
  await mutation;
  assert.equal(f.documents.get("a")!.suite.description, "Agent documentation");
  assert.equal(w.suite.name, "Human edit during agent write");
  assert.equal(w.revision, 2);
  assert.equal(w.dirty, true);
  assert.equal(f.documents.get("b")!.suite.name, "Independent B");
});

test("archive metadata advances the revision while preserving edits made during the request", async () => {
  const f = fixture(),
    w = f.workspace;
  await w.navigate("a");
  const write = f.pauseWrite();
  const archive = w.changeArchive("a", true, 1);
  w.suite.name = "Draft during archive";
  w.markDirty();
  await w.navigate("b");
  write.release();
  await archive;
  await w.navigate("a");
  assert.equal(w.archivedAt, "now");
  assert.equal(w.revision, 2);
  assert.equal(w.suite.name, "Draft during archive");
  assert.equal(w.dirty, true);
  await w.save("a");
  assert.equal(w.revision, 3);
  assert.equal(w.archivedAt, "now");
});

test("stale server responses and failed writes cannot reset a draft or trap write ownership", async () => {
  const f = fixture(),
    w = f.workspace;
  await w.navigate("a");
  const read = f.pauseRead();
  const staleRefresh = w.refresh();
  w.suite.name = "Saved newer revision";
  w.markDirty();
  await w.save("a");
  read.release();
  await staleRefresh;
  assert.equal(w.revision, 2);
  assert.equal(w.suite.name, "Saved newer revision");
  w.suite.name = "Unsaved";
  w.markDirty();
  f.failWrites(Error("Disk full"));
  await assert.rejects(w.save("a"), /Disk full/);
  assert.equal(w.dirty, true);
  assert.equal(w.isSaving("a"), false);
  f.failWrites();
  const remote = f.documents.get("a")!;
  remote.revision++;
  remote.suite.name = "Changed elsewhere";
  await w.refresh();
  assert.equal(
    w.revision,
    2,
    "dirty draft retains its conflict-detecting revision",
  );
  await assert.rejects(w.save("a"), /changed elsewhere/);
  assert.equal(w.suite.name, "Unsaved");
});

test("stale agent revisions fail and later clean writes still work", async () => {
  const f = fixture(),
    w = f.workspace;
  await w.navigate("a");
  f.documents.get("a")!.revision = 2;
  await assert.rejects(
    w.mutateSaved("a", 1, () => {}),
    /Revision is stale/,
  );
  assert.equal(w.isSaving("a"), false);
  const saved = await w.mutateSaved("a", 2, (suite) => {
    suite.name = "Fresh agent edit";
  });
  assert.equal(saved.revision, 3);
  assert.equal(w.revision, 3);
  assert.equal(w.suite.name, "Fresh agent edit");
  assert.equal(w.dirty, false);
});

function summary(id: string, evaluationId = "a"): RunSummary {
  const run: RunView = {
    id,
    evaluationId,
    createdAt: "",
    datasetKey: "same",
    status: "failed",
    suite: structuredClone(seed),
    results: [],
  };
  const m = metrics(run);
  return {
    id,
    evaluationId,
    createdAt: "",
    datasetKey: "same",
    status: "failed",
    outcome: "failed",
    name: id,
    model: seed.model,
    questions: seed.questions.map(({ id, name, type }) => ({ id, name, type })),
    metrics: m,
    questionMetrics: { judgment: m },
  };
}
test("paged history deduplicates refreshes, preserves cursor and resets across navigation", async () => {
  const f = fixture(),
    w = f.workspace;
  f.documents.get("a")!.runs = [summary("a-3"), summary("a-2")];
  f.documents.get("a")!.runCursor = 2;
  f.persistence.history = async () => ({
    runs: [summary("a-1")],
    nextCursor: null,
  });
  await w.navigate("a");
  assert.equal(w.runCursor, 2);
  assert.equal(await w.loadMoreRuns(), true);
  assert.equal(w.runCursor, null);
  await w.refresh();
  assert.deepEqual(
    w.runs.map((r) => r.id),
    ["a-3", "a-2", "a-1"],
  );
  f.documents.get("a")!.runs = [summary("a-4"), summary("a-3")];
  f.documents.get("a")!.runCursor = 3;
  await w.refresh();
  assert.deepEqual(
    w.runs.map((r) => r.id),
    ["a-4", "a-3", "a-2", "a-1"],
  );
  assert.equal(w.runCursor, null);
  await w.navigate("b");
  assert.deepEqual(w.runs, []);
  assert.equal(w.runCursor, null);
});
test("late history pages and selected runs cannot restore an earlier route", async () => {
  const f = fixture(),
    w = f.workspace;
  f.documents.get("a")!.runs = [summary("a-2")];
  f.documents.get("a")!.runCursor = 2;
  await w.navigate("a");
  const page = gate();
  f.persistence.history = async () => {
    page.enter();
    await page.promise;
    return { runs: [summary("a-1")], nextCursor: null };
  };
  const loading = w.loadMoreRuns();
  await page.entered;
  assert.equal(w.isLoadingHistory, true);
  await w.navigate("b");
  page.release();
  assert.equal(await loading, false);
  assert.deepEqual(w.runs, []);
  assert.equal(w.isLoadingHistory, false);
  await w.navigate("a");
  const read = f.pauseRead();
  const selecting = w.selectRun("a-1");
  await read.entered;
  await w.navigate("b");
  read.release();
  assert.equal(await selecting, false);
  assert.equal(w.id, "b");
  assert.equal(w.run, null);
});
test("run selection ignores stale refreshes and newer selection wins", async () => {
  const f = fixture(),
    w = f.workspace;
  await w.navigate("a");
  const read = f.pauseRead();
  const refreshing = w.refresh();
  await read.entered;
  assert.equal(await w.selectRun("new"), true);
  read.release();
  assert.equal(await refreshing, false);
  const older = f.pauseRead();
  const first = w.selectRun("old");
  await older.entered;
  assert.equal(await w.selectRun("newer"), true);
  older.release();
  assert.equal(await first, false);
});
test("a nonoverlapping new history head restarts pagination to avoid hidden gaps", async () => {
  const f = fixture(),
    w = f.workspace;
  f.documents.get("a")!.runs = [summary("a-2")];
  f.documents.get("a")!.runCursor = 2;
  f.persistence.history = async () => ({
    runs: [summary("a-1")],
    nextCursor: null,
  });
  await w.navigate("a");
  await w.loadMoreRuns();
  f.documents.get("a")!.runs = [summary("a-30"), summary("a-29")];
  f.documents.get("a")!.runCursor = 29;
  await w.refresh();
  assert.deepEqual(
    w.runs.map((r) => r.id),
    ["a-30", "a-29"],
  );
  assert.equal(w.runCursor, 29);
});

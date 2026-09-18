import { rankingQuery } from "./run-ranking.js";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { seed } from "./seed.js";
import type {
  Suite,
  Run,
  Evaluation,
  RunSummary,
  RunHistoryPage,
  RunView,
  SelectedRun,
} from "./types.js";
import { metrics, questionMetrics, runOutcome } from "./questions.js";
import {
  decodeSuite,
  decodeRun,
  encodeSuite,
  encodeRun,
  type SnapshotSuite,
  type SnapshotRun,
  type SnapshotEvaluation,
} from "./snapshots.js";
// Bump when derived metrics or projection shape change; historical JSON stays untouched.
const projectionVersion = 2;
export class Store {
  readonly db: DatabaseSync;
  constructor(path: string, options: { starter?: boolean } = {}) {
    this.db = new DatabaseSync(path);
    try {
      this.db.exec(
        "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY,json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS evaluations(id TEXT PRIMARY KEY,json TEXT NOT NULL)",
      );
      this.db.exec(`
      CREATE TABLE IF NOT EXISTS run_summaries (
        run_id TEXT PRIMARY KEY,
        evaluation_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        dataset_key TEXT NOT NULL,
        version INTEGER NOT NULL,
        json TEXT NOT NULL,
        view_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS summary_history ON run_summaries(evaluation_id, position DESC);
      CREATE INDEX IF NOT EXISTS summary_dataset ON run_summaries(evaluation_id, dataset_key);
    `);
      const columns = this.db.prepare("PRAGMA table_info(runs)").all();
      if (!columns.some((c) => c.name === "evaluation_id"))
        this.db.exec(
          "ALTER TABLE runs ADD COLUMN evaluation_id TEXT; CREATE INDEX runs_evaluation ON runs(evaluation_id)",
        );
      this.db.exec("BEGIN IMMEDIATE");
      try {
        if (
          !this.db.prepare("SELECT id FROM evaluations LIMIT 1").get() &&
          (options.starter !== false ||
            this.db.prepare("SELECT json FROM settings WHERE id=1").get())
        ) {
          const row = this.db
            .prepare("SELECT json FROM settings WHERE id=1")
            .get();
          const suite: SnapshotSuite = row
            ? JSON.parse(String(row.json))
            : structuredClone(seed);
          if (
            suite.stateSchema === undefined &&
            suite.instructions === seed.questions[0].instructions
          )
            suite.stateSchema = seed.stateSchema;
          const evaluation = this.create(decodeSuite(suite));
          for (const row of this.db
            .prepare("SELECT id,json FROM runs WHERE evaluation_id IS NULL")
            .all()) {
            const run = JSON.parse(String(row.json)) as SnapshotRun;
            run.evaluationId = evaluation.id;
            this.db
              .prepare("UPDATE runs SET json=?,evaluation_id=? WHERE id=?")
              .run(JSON.stringify(run), evaluation.id, String(row.id));
          }
        }
        for (const row of this.db
          .prepare("SELECT id,json FROM evaluations")
          .all()) {
          const e = JSON.parse(String(row.json)) as SnapshotEvaluation;
          if (e.suite.questions === undefined) {
            e.suite = encodeSuite(decodeSuite(e.suite));
            e.revision += 1;
            this.db
              .prepare("UPDATE evaluations SET json=? WHERE id=?")
              .run(JSON.stringify(e), e.id);
          }
        }
        this.db.exec("COMMIT");
      } catch (e) {
        this.db.exec("ROLLBACK");
        throw e;
      }
      this.backfillSummaries();
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  /** Called by the owning database connection, never by ordinary construction. */
  recoverInterruptedRuns() {
    // Interrupted recovery changes status only; preserve the historical snapshot shape.
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const row of this.db
        .prepare(
          "SELECT id,json FROM runs WHERE json_extract(json, '$.status')='running'",
        )
        .all()) {
        const snapshot = JSON.parse(String(row.json)) as SnapshotRun;
        snapshot.status = "failed";
        this.db
          .prepare("UPDATE runs SET json=? WHERE id=?")
          .run(JSON.stringify(snapshot), String(row.id));
        this.db
          .prepare("DELETE FROM run_summaries WHERE run_id=?")
          .run(String(row.id));
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    this.backfillSummaries();
  }
  private backfillSummaries() {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const row of this.db
        .prepare(
          `
        SELECT r.rowid AS position, r.json, r.evaluation_id
        FROM runs r LEFT JOIN run_summaries s ON s.run_id=r.id
        WHERE s.run_id IS NULL OR s.version != ?
        ORDER BY r.rowid
      `,
        )
        .iterate(projectionVersion)) {
        const run = decodeRun(JSON.parse(String(row.json)));
        run.evaluationId ??= String(row.evaluation_id);
        this.projectRun(run, Number(row.position));
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  private projectRun(run: Run, position: number) {
    const summary: RunSummary = {
      id: run.id,
      evaluationId: run.evaluationId!,
      name: run.suite.name,
      model: run.suite.model,
      createdAt: run.createdAt,
      status: run.status,
      outcome: runOutcome(run),
      datasetKey: run.datasetKey,
      questions: run.suite.questions.map(({ id, name, type }) => ({
        id,
        name,
        type,
      })),
      metrics: metrics(run),
      questionMetrics: questionMetrics(run),
    };
    const view: RunView = {
      ...run,
      results: run.results.map(({ request, response, ...result }) => result),
    };
    this.db
      .prepare(
        `
      INSERT INTO run_summaries(run_id,evaluation_id,position,dataset_key,version,json,view_json)
      VALUES (?,?,?,?,?,?,?) ON CONFLICT(run_id) DO UPDATE SET
      evaluation_id=excluded.evaluation_id, position=excluded.position, dataset_key=excluded.dataset_key,
      version=excluded.version, json=excluded.json, view_json=excluded.view_json
    `,
      )
      .run(
        run.id,
        run.evaluationId!,
        position,
        run.datasetKey,
        projectionVersion,
        JSON.stringify(summary),
        JSON.stringify(view),
      );
  }
  /** Cursor positions belong to immutable insert order; progress updates do not move runs. */
  history(id: string, before?: number, limit = 20): RunHistoryPage {
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 50 ||
      (before !== undefined && (!Number.isSafeInteger(before) || before < 1))
    )
      throw Error("Provide a limit from 1–50 and a positive history cursor.");
    const rows = this.db
      .prepare(
        `
      SELECT position,json FROM run_summaries
      WHERE evaluation_id=? AND position < ? ORDER BY position DESC LIMIT ?
    `,
      )
      .all(id, before ?? Number.MAX_SAFE_INTEGER, limit + 1);
    const page = rows.slice(0, limit);
    return {
      runs: page.map((row) => JSON.parse(String(row.json))),
      nextCursor: rows.length > limit ? Number(page.at(-1)!.position) : null,
    };
  }
  /** Ranking uses every matching summary, never just the visible history page. */
  selectedRun(id: string, evaluationId?: string): SelectedRun | undefined {
    const row = this.db
      .prepare(
        "SELECT evaluation_id,view_json FROM run_summaries WHERE run_id=?",
      )
      .get(id);
    if (
      !row ||
      (evaluationId !== undefined && row.evaluation_id !== evaluationId)
    )
      return undefined;
    const run: RunView = JSON.parse(String(row.view_json));
    const bestRuns = Object.fromEntries(
      run.suite.questions.map((q) => {
        const plan = rankingQuery(q);
        const best = this.db
          .prepare(plan.sql)
          .get(row.evaluation_id, run.datasetKey, ...plan.paths);
        return [
          q.id,
          best ? (JSON.parse(String(best.json)) as RunSummary) : null,
        ];
      }),
    );
    return { run, bestRuns };
  }
  /** Adopt reviewed examples atomically without replacing existing Jevals. */
  adoptExamples(suites: Suite[]): { added: number; skipped: number } {
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS example_seeds (name TEXT PRIMARY KEY, evaluation_id TEXT NOT NULL)",
    );
    this.db.exec("BEGIN IMMEDIATE");
    let added = 0,
      skipped = 0;
    try {
      for (const suite of suites) {
        // Remember adoption, so renaming/editing an example never causes a duplicate later.
        const marker = this.db
          .prepare("SELECT evaluation_id FROM example_seeds WHERE name=?")
          .get(suite.name);
        const existing =
          marker ||
          this.db
            .prepare(
              "SELECT id AS evaluation_id FROM evaluations WHERE json_extract(json,'$.suite.name')=? LIMIT 1",
            )
            .get(suite.name);
        if (existing) {
          this.db
            .prepare("INSERT OR IGNORE INTO example_seeds VALUES (?,?)")
            .run(suite.name, String(existing.evaluation_id));
          skipped++;
        } else {
          const evaluation = this.create(suite);
          this.db
            .prepare("INSERT INTO example_seeds VALUES (?,?)")
            .run(suite.name, evaluation.id);
          added++;
        }
      }
      this.db.exec("COMMIT");
      return { added, skipped };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  create(suite: Suite): Evaluation {
    suite = structuredClone(suite);
    const now = new Date().toISOString();
    const evaluation = {
      id: randomUUID(),
      suite,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .prepare("INSERT INTO evaluations VALUES (?,?)")
      .run(
        evaluation.id,
        JSON.stringify({ ...evaluation, suite: encodeSuite(evaluation.suite) }),
      );
    return evaluation;
  }
  get(id: string): Evaluation | undefined {
    const row = this.db
      .prepare("SELECT json FROM evaluations WHERE id=?")
      .get(id);
    return row
      ? this.decodeEvaluation(JSON.parse(String(row.json)))
      : undefined;
  }
  first(): Evaluation {
    return this.decodeEvaluation(
      JSON.parse(
        String(
          this.db
            .prepare("SELECT json FROM evaluations ORDER BY rowid LIMIT 1")
            .get()!.json,
        ),
      ),
    );
  }
  private decodeEvaluation(value: SnapshotEvaluation): Evaluation {
    return { ...value, suite: decodeSuite(value.suite) };
  }
  update(id: string, suite: Suite, revision: number): Evaluation {
    suite = structuredClone(suite);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const old = this.get(id);
      if (!old) throw Error("Evaluation not found.");
      if (old.revision !== revision)
        throw Error(
          "Evaluation changed elsewhere. Reload before saving to avoid overwriting it.",
        );
      const evaluation = {
        ...old,
        suite,
        revision: old.revision + 1,
        updatedAt: new Date().toISOString(),
      };
      this.db.prepare("UPDATE evaluations SET json=? WHERE id=?").run(
        JSON.stringify({
          ...evaluation,
          suite: encodeSuite(evaluation.suite),
        }),
        id,
      );
      this.db.exec("COMMIT");
      return evaluation;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  runs(id: string): Run[] {
    return this.db
      .prepare(
        "SELECT json FROM runs WHERE evaluation_id=? ORDER BY rowid DESC",
      )
      .all(id)
      .map((r) => decodeRun(JSON.parse(String(r.json))));
  }
  setArchived(id: string, archived: boolean, revision: number): Evaluation {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const old = this.get(id);
      if (!old) throw Error("Evaluation not found.");
      if (old.revision !== revision)
        throw Error("Evaluation changed elsewhere. Reload before updating it.");
      const evaluation = {
        ...old,
        archivedAt: archived
          ? (old.archivedAt ?? new Date().toISOString())
          : null,
        revision: old.revision + 1,
        updatedAt: new Date().toISOString(),
      };
      this.db.prepare("UPDATE evaluations SET json=? WHERE id=?").run(
        JSON.stringify({
          ...evaluation,
          suite: encodeSuite(evaluation.suite),
        }),
        id,
      );
      this.db.exec("COMMIT");
      return evaluation;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  run(id: string): Run | undefined {
    const row = this.db.prepare("SELECT json FROM runs WHERE id=?").get(id);
    return row ? decodeRun(JSON.parse(String(row.json))) : undefined;
  }
  trace(
    runId: string,
    caseId: string,
  ): SnapshotRun["results"][number] | undefined {
    const row = this.db
      .prepare(
        `
      SELECT result.value AS json FROM runs r, json_each(r.json,'$.results') result
      WHERE r.id=? AND json_extract(result.value,'$.case.id')=? LIMIT 1
    `,
      )
      .get(runId, caseId);
    return row ? JSON.parse(String(row.json)) : undefined;
  }
  snapshot(id: string): SnapshotRun | undefined {
    const row = this.db.prepare("SELECT json FROM runs WHERE id=?").get(id);
    return row ? JSON.parse(String(row.json)) : undefined;
  }
  saveRun(run: Run) {
    const snapshot = encodeRun(run);
    const evaluationId = run.evaluationId ?? this.first().id;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          "INSERT INTO runs(id,json,evaluation_id) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json",
        )
        .run(run.id, JSON.stringify(snapshot), evaluationId);
      const row = this.db
        .prepare("SELECT rowid AS position FROM runs WHERE id=?")
        .get(run.id)!;
      this.projectRun({ ...run, evaluationId }, Number(row.position));
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  list() {
    return this.db
      .prepare("SELECT json FROM evaluations ORDER BY rowid DESC")
      .all()
      .map((row) => {
        const e = this.decodeEvaluation(JSON.parse(String(row.json)));
        const latestRow = this.db
          .prepare(
            "SELECT json FROM run_summaries WHERE evaluation_id=? ORDER BY position DESC LIMIT 1",
          )
          .get(e.id);
        const latest: RunSummary | undefined = latestRow
          ? JSON.parse(String(latestRow.json))
          : undefined;
        return {
          id: e.id,
          archivedAt: e.archivedAt ?? null,
          name: e.suite.name,
          questionCount: e.suite.questions?.length ?? 1,
          questionTypes: [
            ...new Set(e.suite.questions?.map((q) => q.type) ?? ["noul"]),
          ],
          caseCount: e.suite.cases.length,
          updatedAt: e.updatedAt,
          revision: e.revision,
          latestRun: latest
            ? {
                id: latest.id,
                status: latest.status,
                outcome: latest.outcome,
                createdAt: latest.createdAt,
                metrics: latest.metrics,
                questionMetrics: latest.questionMetrics,
              }
            : null,
        };
      });
  }
}

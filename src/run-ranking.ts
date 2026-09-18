import type { Question, RunSummary } from "./types.js";
type Metrics = RunSummary["metrics"];
type Field = "accuracy" | "brier" | "meanAbsoluteError";
function fields(type: Question["type"] | null): [Field, "ASC" | "DESC"][] {
  return type === "score"
    ? [
        ["meanAbsoluteError", "ASC"],
        ["accuracy", "DESC"],
      ]
    : [
        ["accuracy", "DESC"],
        ["brier", "ASC"],
      ];
}
/** Both adapters use this policy: complete, comparable runs with measured metrics;
 * newest timestamp and then greatest stable ID settle equal measurements. */
export function rankRuns<
  T extends { id: string; createdAt: string; datasetKey: string },
>(
  candidates: { run: T; outcome: string; metrics: Metrics }[],
  datasetKey: string,
): T | undefined {
  return candidates
    .filter(
      (c) =>
        c.run.datasetKey === datasetKey &&
        c.outcome === "complete" &&
        fields(c.metrics.type).every(([field]) => c.metrics[field] !== null),
    )
    .sort((a, b) => {
      for (const [field, direction] of fields(a.metrics.type)) {
        const difference = a.metrics[field]! - b.metrics[field]!;
        if (difference) return direction === "ASC" ? difference : -difference;
      }
      // Binary ordering matches SQLite, independent of locale and input order.
      for (const field of ["createdAt", "id"] as const) {
        if (a.run[field] !== b.run[field])
          return a.run[field] > b.run[field] ? -1 : 1;
      }
      return 0;
    })[0]?.run;
}
/** Parameterized SQLite plan over cached summaries; no full traces are loaded. */
export function rankingQuery(question: Question): {
  sql: string;
  paths: string[];
} {
  const ordered = fields(question.type);
  const paths = ordered.map(
    ([field]) => `$.questionMetrics."${question.id}".${field}`,
  );
  return {
    sql: `SELECT json FROM run_summaries WHERE evaluation_id=? AND dataset_key=?
      AND json_extract(json,'$.outcome')='complete'
      AND ${ordered.map(() => "json_extract(json,?) IS NOT NULL").join(" AND ")}
      ORDER BY ${ordered.map(([, direction]) => `json_extract(json,?) ${direction}`).join(", ")},
      json_extract(json,'$.createdAt') DESC, run_id DESC LIMIT 1`,
    paths: [...paths, ...paths],
  };
}

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Store } from "./store.js";
import { openDatabase } from "./database.js";
import { validateSuite } from "./questions.js";

/** Frozen, reviewed examples; never read the author's live database at seed time. */
export function seedExamples(store: Store): { added: number; skipped: number } {
  const examples = JSON.parse(
    readFileSync(
      new URL("../examples/starter-jevals.json", import.meta.url),
      "utf8",
    ),
  ).map((s: unknown) => validateSuite(s, true));
  store.db.exec(
    "CREATE TABLE IF NOT EXISTS example_seeds (name TEXT PRIMARY KEY, evaluation_id TEXT NOT NULL)",
  );
  store.db.exec("BEGIN IMMEDIATE");
  let added = 0,
    skipped = 0;
  try {
    for (const suite of examples) {
      // Remember adoption, so renaming/editing an example never causes a duplicate later.
      const marker = store.db
        .prepare("SELECT evaluation_id FROM example_seeds WHERE name=?")
        .get(suite.name);
      const existing =
        marker ||
        store.db
          .prepare(
            "SELECT id AS evaluation_id FROM evaluations WHERE json_extract(json,'$.suite.name')=? LIMIT 1",
          )
          .get(suite.name);
      if (existing) {
        store.db
          .prepare("INSERT OR IGNORE INTO example_seeds VALUES (?,?)")
          .run(suite.name, String(existing.evaluation_id));
        skipped++;
      } else {
        const evaluation = store.create(suite);
        store.db
          .prepare("INSERT INTO example_seeds VALUES (?,?)")
          .run(suite.name, evaluation.id);
        added++;
      }
    }
    store.db.exec("COMMIT");
    return { added, skipped };
  } catch (error) {
    store.db.exec("ROLLBACK");
    throw error;
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2);
  if (args.includes("--help"))
    console.log(
      "Usage: npm run seed -- [--db path/to/jevals.sqlite]\nAdds curated examples without overwriting existing Jevals or creating runs.",
    );
  else {
    if (args.length && (args.length !== 2 || args[0] !== "--db" || !args[1]))
      throw Error("Use --db <path>, or --help.");
    const dbPath = resolve(
      args[1] ?? process.env.JEVALS_DB ?? ".data/jevals.sqlite",
    );
    const connection = openDatabase(dbPath, "seed");
    const { store } = connection;
    try {
      const result = seedExamples(store);
      console.log(
        `Added ${result.added} example Jevals; skipped ${result.skipped}. Database: ${dbPath}`,
      );
    } finally {
      connection.close();
    }
  }
}

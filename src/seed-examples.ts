import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Store } from "./store.js";
import { prepareWorkspace } from "./workspace-config.js";
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
  return store.adoptExamples(examples);
}
/** Complete seed operation shared by development and installed launch adapters. */
export function seedWorkspace(database: string) {
  const connection = openDatabase(database, "seed");
  try {
    return seedExamples(connection.store);
  } finally {
    connection.close();
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
    const workspace = prepareWorkspace({ db: args[1] });
    const result = seedWorkspace(workspace.database);
    console.log(
      `Added ${result.added} example Jevals; skipped ${result.skipped}. Database: ${workspace.database}`,
    );
  }
}

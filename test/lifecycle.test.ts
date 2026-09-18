import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { startWorkbench } from "../src/server.js";
import { seedWorkspace } from "../src/seed-examples.js";
import { prepareWorkspace } from "../src/workspace-config.js";
import { seed } from "../src/seed.js";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "jevals-lifecycle-"));
  return {
    dir,
    database: join(dir, "db.sqlite"),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test("failed listening rolls back ownership and development middleware", async () => {
  const f = fixture();
  const occupied = createServer();
  await new Promise<void>((resolve) =>
    occupied.listen(0, "127.0.0.1", resolve),
  );
  const port = (occupied.address() as { port: number }).port;
  try {
    await assert.rejects(
      startWorkbench({ database: f.database, port, built: false }),
      /already in use/,
    );
    assert.equal(existsSync(f.database + ".lock"), false);
    const retry = await startWorkbench({
      database: f.database,
      port: 0,
      built: true,
    });
    assert.equal((await fetch(retry.url + "/api/evaluations")).status, 200);
    await retry.close();
    await retry.close();
    assert.equal(existsSync(f.database + ".lock"), false);
  } finally {
    await new Promise<void>((resolve) => occupied.close(() => resolve()));
    f.cleanup();
  }
});

test("shutdown drains accepted requests before releasing their storage", async () => {
  const f = fixture();
  let resolveResponse!: (response: {
    model: string;
    answers: unknown;
    usage: { input_tokens: number; output_tokens: number };
  }) => void;
  const response = new Promise<Parameters<typeof resolveResponse>[0]>(
    (resolve) => {
      resolveResponse = resolve;
    },
  );
  const workbench = await startWorkbench(
    { database: f.database, port: 0, built: true, apiKey: "simulated-key" },
    () => ({ systemOne: () => response }),
  );
  try {
    const suite = structuredClone(seed);
    suite.cases = suite.cases.slice(0, 1);
    const created = await (
      await fetch(workbench.url + "/api/evaluations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(suite),
      })
    ).json();
    const accepted = await (
      await fetch(workbench.url + "/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ evaluationId: created.id }),
      })
    ).json();
    let closed = false;
    const closing = workbench.close().then(() => {
      closed = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(closed, false);
    assert.throws(() => seedWorkspace(f.database), /already using/);
    resolveResponse({
      model: "jev-1.13.0",
      answers: { judgment: { type: "noul", noul: 0.9 } },
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    await closing;
    const db = new DatabaseSync(f.database);
    try {
      const snapshot = JSON.parse(
        String(
          db.prepare("SELECT json FROM runs WHERE id=?").get(accepted.id)!.json,
        ),
      );
      assert.equal(snapshot.status, "complete");
      assert.equal(snapshot.results.length, 1);
    } finally {
      db.close();
    }
    assert.equal(existsSync(f.database + ".lock"), false);
  } finally {
    await workbench.close();
    f.cleanup();
  }
});

test("workspace configuration is shared without global environment or directory changes", () => {
  const f = fixture();
  try {
    writeFileSync(join(f.dir, ".env"), "JEVALS_DB=custom.sqlite\nPORT=4319\n");
    const cwd = process.cwd(),
      env = { ...process.env };
    const configured = prepareWorkspace({ dir: f.dir });
    assert.equal(
      configured.database,
      join(f.dir, process.env.JEVALS_DB ?? "custom.sqlite"),
    );
    assert.equal(configured.port, Number(process.env.PORT ?? 4319));
    assert.equal(
      prepareWorkspace({ dir: f.dir, db: "override.sqlite", port: "4320" })
        .database,
      join(f.dir, "override.sqlite"),
    );
    assert.equal(process.cwd(), cwd);
    assert.equal(JSON.stringify({ ...process.env }), JSON.stringify(env));
  } finally {
    f.cleanup();
  }
});

test("example adoption failure rolls back the complete seed operation and releases ownership", () => {
  const f = fixture();
  try {
    seedWorkspace(f.database);
    const db = new DatabaseSync(f.database);
    db.exec(
      "DELETE FROM evaluations; DELETE FROM example_seeds; CREATE TRIGGER reject_second BEFORE INSERT ON evaluations WHEN (SELECT count(*) FROM evaluations)>0 BEGIN SELECT RAISE(ABORT, 'second insert rejected'); END",
    );
    db.close();
    assert.throws(() => seedWorkspace(f.database), /second insert rejected/);
    assert.equal(existsSync(f.database + ".lock"), false);
    const inspect = new DatabaseSync(f.database);
    assert.equal(
      inspect.prepare("SELECT count(*) AS n FROM evaluations").get()!.n,
      0,
    );
    assert.equal(
      inspect.prepare("SELECT count(*) AS n FROM example_seeds").get()!.n,
      0,
    );
    inspect.exec("DROP TRIGGER reject_second");
    inspect.close();
    assert.deepEqual(seedWorkspace(f.database), { added: 7, skipped: 0 });
  } finally {
    f.cleanup();
  }
});

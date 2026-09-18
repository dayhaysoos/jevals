import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("SDK request, snapshots, persistence, errors and export work with a simulated provider", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jevals-test-"));
  let failing = false;
  let calls = 0;
  const provider = createServer((req, res) => {
    calls++;
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const data = JSON.parse(body);
      assert.equal(data.questions.judgment.type, "noul");
      res.setHeader("content-type", "application/json");
      if (failing) {
        res.writeHead(500);
        res.end(JSON.stringify({ message: "simulated failure" }));
        return;
      }
      res.end(
        JSON.stringify({
          model: "jev-1.13.0",
          answers: {
            judgment: {
              type: "noul",
              noul:
                data.state.food?.includes("tortilla") ||
                data.state.food?.includes("Lettuce")?.valueOf()
                  ? 0.1
                  : 0.9,
            },
          },
          usage: { input_tokens: 100, output_tokens: 5 },
        }),
      );
    });
  });
  await new Promise<void>((r) => provider.listen(0, "127.0.0.1", r));
  const port = (provider.address() as { port: number }).port;
  const child = spawn(process.execPath, ["--import", "tsx", "src/dev.ts"], {
    env: {
      ...process.env,
      PORT: "4328",
      JEVALS_DB: join(dir, "test.sqlite"),
      TYPESAFE_API_KEY: "simulated-test-key",
      TYPESAFE_BASE_URL: `http://127.0.0.1:${port}`,
    },
    stdio: "pipe",
  });
  const url = "http://127.0.0.1:4328";
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(url + "/api/workbench")).ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(ready, "server starts");
    const initial = await (await fetch(url + "/api/workbench")).json();
    const suite = initial.suite;
    const post = () =>
      fetch(url + "/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(suite),
      });
    const first = await post();
    assert.equal(first.status, 202);
    const { id } = await first.json();
    async function waitRun(runId: string) {
      for (let i = 0; i < 100; i++) {
        const data = await (await fetch(url + "/api/workbench")).json();
        const run = data.runs.find((r: { id: string }) => r.id === runId);
        if (run.status !== "running") return run;
        await new Promise((r) => setTimeout(r, 30));
      }
      throw Error("run timed out");
    }
    const run = await waitRun(id);
    assert.equal(run.status, "complete");
    assert.equal(run.results.length, 5);
    assert.equal(calls, 5);
    assert.equal(run.results[0].inputTokens, 100);
    assert.equal(run.results[0].probability, 0.9);
    suite.instructions = "Changed after the run";
    const saved = await fetch(url + "/api/suite", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(suite),
    });
    assert.equal(saved.status, 200);
    const exported = await (await fetch(url + `/api/runs/${id}/export`)).json();
    assert.notEqual(exported.run.suite.instructions, suite.instructions);
    assert.equal(exported.metrics.accuracy, 1);
    assert.equal(exported.metrics.inputTokens, 500);
    const originalSchema = suite.stateSchema;
    suite.stateSchema = [
      ...originalSchema,
      {
        key: "new_required",
        label: "New required field",
        type: "text",
        required: true,
        defaultValue: "",
      },
    ];
    const incompleteSave = await fetch(url + "/api/suite", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(suite),
    });
    assert.equal(
      incompleteSave.status,
      200,
      "incomplete case drafts can be saved",
    );
    const incompleteRun = await post();
    assert.equal(incompleteRun.status, 400, "incomplete states cannot run");
    assert.equal(calls, 5, "validation does not send model requests");
    suite.stateSchema = originalSchema;
    failing = true;
    const next = await (await post()).json();
    const failed = await waitRun(next.id);
    assert.equal(failed.status, "failed");
    assert.ok(
      failed.results.every(
        (r: { probability: unknown }) => r.probability === null,
      ),
    );
    assert.equal(calls, 10, "retries disabled for trace fidelity");
    suite.questions[0].threshold = 2;
    const invalid = await post();
    assert.equal(invalid.status, 400);
  } finally {
    child.kill();
    await new Promise<void>((r) => child.once("exit", () => r()));
    provider.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

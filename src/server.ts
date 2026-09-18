import { openDatabase } from "./database.js";
import "dotenv/config";
import express from "express";
import { fileURLToPath } from "node:url";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import {
  metrics,
  questionMetrics,
  validateSuite,
  runOutcome,
} from "./questions.js";
import { decodeSuite, encodeSuite, encodeRun } from "./snapshots.js";
import { RunExecutor, RunRequestError } from "./run-executor.js";
const database = process.env.JEVALS_DB ?? ".data/jevals.sqlite";
const port = Number(process.env.PORT ?? 4317);
if (!Number.isInteger(port) || port < 0 || port > 65535)
  throw Error("PORT must be a whole number from 0 to 65535.");
const connection = openDatabase(database, "server");
const { store } = connection;
const app = express();
app.use(express.json({ limit: "2mb" }));
app.get("/api/evaluations", (_req, res) =>
  res.json({
    evaluations: store.list(),
    configured: Boolean(process.env.TYPESAFE_API_KEY),
  }),
);
app.post("/api/evaluations", (req, res) => {
  try {
    const evaluation = store.create(validateSuite(decodeSuite(req.body)));
    res.status(201).json(evaluation);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});
app.get("/api/evaluations/:id", (req, res) => {
  const evaluation = store.get(String(req.params.id));
  if (!evaluation) {
    res.status(404).json({ error: "Evaluation not found." });
    return;
  }
  const page = store.history(evaluation.id);
  const runId =
    typeof req.query.run === "string" ? req.query.run : page.runs[0]?.id;
  const selected =
    req.query.includeRun === "1" && runId
      ? store.selectedRun(runId, evaluation.id)
      : undefined;
  if (req.query.includeRun === "1" && runId && !selected) {
    res.status(404).json({ error: "Run not found in this evaluation." });
    return;
  }
  res.json({
    ...evaluation,
    runs: page.runs,
    runCursor: page.nextCursor,
    selectedRun: selected?.run ?? null,
    bestRuns: selected?.bestRuns ?? {},
  });
});
app.get("/api/evaluations/:id/runs", (req, res) => {
  const id = String(req.params.id);
  if (!store.get(id)) {
    res.status(404).json({ error: "Evaluation not found." });
    return;
  }
  try {
    const before =
      req.query.before === undefined ? undefined : Number(req.query.before);
    const limit = req.query.limit === undefined ? 20 : Number(req.query.limit);
    res.json(store.history(id, before, limit));
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});
app.get("/api/runs/:id/view", (req, res) => {
  const selected = store.selectedRun(String(req.params.id));
  if (!selected) {
    res.status(404).json({ error: "Run not found." });
    return;
  }
  res.json(selected);
});
app.get("/api/runs/:id/traces/:caseId", (req, res) => {
  const trace = store.trace(String(req.params.id), String(req.params.caseId));
  if (!trace) {
    res.status(404).json({ error: "Case trace not found in this run." });
    return;
  }
  res.json(trace);
});
for (const action of ["archive", "restore"] as const) {
  app.post(`/api/evaluations/:id/${action}`, (req, res) => {
    const id = String(req.params.id);
    if (!store.get(id)) {
      res.status(404).json({ error: "Evaluation not found." });
      return;
    }
    try {
      if (!Number.isInteger(req.body.revision))
        throw Error("Provide the evaluation revision.");
      res.json(store.setArchived(id, action === "archive", req.body.revision));
    } catch (e) {
      const error = (e as Error).message;
      res
        .status(error.includes("changed elsewhere") ? 409 : 400)
        .json({ error });
    }
  });
}
app.put("/api/evaluations/:id", (req, res) => {
  try {
    const id = String(req.params.id);
    if (!store.get(id)) {
      res.status(404).json({ error: "Evaluation not found." });
      return;
    }
    const suite = validateSuite(decodeSuite(req.body.suite));
    if (!Number.isInteger(req.body.revision))
      throw Error("Provide the evaluation revision.");
    res.json(store.update(id, suite, req.body.revision));
  } catch (e) {
    const error = (e as Error).message;
    res.status(error.includes("changed elsewhere") ? 409 : 400).json({ error });
  }
});
// Backwards-compatible endpoints for the original single-evaluation workbench.
app.get("/api/workbench", (req, res) => {
  const e = req.query.evaluationId
    ? store.get(String(req.query.evaluationId))
    : store.first();
  if (!e) {
    res.status(404).json({ error: "Evaluation not found." });
    return;
  }
  res.json({
    ...e,
    suite: encodeSuite(e.suite),
    configured: Boolean(process.env.TYPESAFE_API_KEY),
    runs: store.runs(e.id).map(encodeRun),
    evaluations: store.list(),
  });
});
app.put("/api/suite", (req, res) => {
  try {
    const e = store.first();
    store.update(e.id, validateSuite(decodeSuite(req.body)), e.revision);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});
app.get("/api/runs/:id", (req, res) => {
  const run = store.run(String(req.params.id));
  if (!run) {
    res.status(404).json({ error: "Run not found." });
    return;
  }
  res.json({
    run: store.snapshot(run.id),
    outcome: runOutcome(run),
    metrics: metrics(run),
    questionMetrics: questionMetrics(run),
  });
});
const executor = new RunExecutor({
  store,
  configured: Boolean(process.env.TYPESAFE_API_KEY),
  redact: (message) =>
    process.env.TYPESAFE_API_KEY
      ? message.replaceAll(process.env.TYPESAFE_API_KEY, "[redacted]")
      : message,
  createProvider: () => {
    const client = new TypeSafeClient({
      retry: { maxRetries: 0 },
      timeout: 30000,
    });
    return {
      systemOne: (request) =>
        client.systemOne({ ...request, state: request.state as never }),
    };
  },
});
app.post("/api/runs", (req, res) => {
  try {
    const accepted = executor.start({
      evaluationId: req.body.evaluationId,
      suite: req.body.evaluationId ? undefined : decodeSuite(req.body),
    });
    // Accepted runs continue independently of the HTTP connection or tool cancellation.
    void accepted.finished.catch((error) =>
      console.error(
        "Run could not be persisted:",
        error instanceof Error ? error.name : "Unknown error",
      ),
    );
    res.status(202).json({ id: accepted.id });
  } catch (error) {
    res.status(error instanceof RunRequestError ? error.status : 500).json({
      error:
        error instanceof RunRequestError
          ? error.message
          : "Could not start the run.",
    });
  }
});
app.get("/api/runs/:id/export", (req, res) => {
  const run = store.run(String(req.params.id));
  if (!run) {
    res.sendStatus(404);
    return;
  }
  res.attachment(`jevals-${run.id}.json`).json({
    run: store.snapshot(run.id),
    outcome: runOutcome(run),
    metrics: metrics(run),
    questionMetrics: questionMetrics(run),
    pricing: {
      model: "jev-1.13.0",
      inputPerMillion: 0.042,
      outputPerMillion: 0,
      source: "https://docs.typesafe.ai/models",
      checkedAt: "2026-09-17",
      costKind: "estimate",
    },
  });
});
try {
  if (process.env.JEVALS_SERVE_BUILD === "1") {
    const ui = fileURLToPath(new URL("../dist/", import.meta.url));
    app.use(express.static(ui));
    app.get(/^\/api\//, (_req, res) =>
      res.status(404).json({ error: "API endpoint not found." }),
    );
    app.get(/.*/, (_req, res) =>
      res.sendFile(
        fileURLToPath(new URL("../dist/index.html", import.meta.url)),
      ),
    );
  } else {
    const { createServer } = await import("vite");
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }
} catch (error) {
  connection.close();
  throw error;
}
export const server = app.listen(port, "127.0.0.1");
server.once("listening", () => {
  const actualPort = (server.address() as { port: number }).port;
  console.log(`jevals → http://localhost:${actualPort}`);
  if (!process.env.TYPESAFE_API_KEY)
    console.log(
      "Create and edit without a key. To run evaluations, set TYPESAFE_API_KEY in your workspace .env and restart.",
    );
});
server.on("error", (error: NodeJS.ErrnoException) => {
  console.error(
    error.code === "EADDRINUSE"
      ? `Port ${port} is already in use. Try jevals --port ${port + 1 > 65535 ? 4317 : port + 1}, or stop the other server.`
      : `Could not start the local server (${error.code ?? "unknown error"}).`,
  );
  connection.close();
  process.exitCode = 1;
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    server.close(() => {
      connection.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  });

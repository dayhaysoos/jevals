import { openDatabase } from "./database.js";
import express from "express";
import { createServer as createHttpServer, type Server } from "node:http";
import type { JudgmentProvider } from "./run-executor.js";
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
export async function startWorkbench(
  config: {
    database: string;
    port: number;
    apiKey?: string;
    baseURL?: string;
    built: boolean;
  },
  createProvider?: () => JudgmentProvider,
) {
  const { database, port } = config;
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw Error("PORT must be a whole number from 0 to 65535.");
  const connection = openDatabase(database, "server");
  const { store } = connection;
  let vite:
    Awaited<ReturnType<(typeof import("vite"))["createServer"]>> | undefined;
  let server: Server | undefined;
  let executor: RunExecutor | undefined;
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= (async () => {
      // Stop admission before awaiting any resources; accepted Runs retain storage.
      const drained = executor?.close();
      const stopped = server?.listening
        ? new Promise<void>((resolve, reject) =>
            server!.close((error) => (error ? reject(error) : resolve())),
          )
        : Promise.resolve();
      const outcomes = await Promise.allSettled([
        drained,
        stopped,
        vite?.close(),
      ]);
      connection.close();
      const failure = outcomes.find((result) => result.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
    })());
  try {
    const app = express();
    // Loopback binding alone does not stop hostile DNS names resolving to loopback.
    app.use((req, res, next) => {
      const localHosts = new Set(["localhost", "127.0.0.1"]);
      if (!localHosts.has(req.hostname)) {
        res
          .status(403)
          .json({
            error: "Use the local Jevals URL to access this workbench.",
          });
        return;
      }
      if (req.headers.origin) {
        try {
          const origin = new URL(req.headers.origin);
          const address = server?.address();
          const actualPort =
            address && typeof address !== "string" ? address.port : port;
          if (
            origin.protocol !== "http:" ||
            !localHosts.has(origin.hostname) ||
            Number(origin.port || 80) !== actualPort
          )
            throw Error();
        } catch {
          res
            .status(403)
            .json({
              error: "Requests must originate from this local workbench.",
            });
          return;
        }
      }
      if (req.headers["sec-fetch-site"] === "cross-site") {
        res.status(403).json({ error: "Cross-site requests are not allowed." });
        return;
      }
      next();
    });
    app.use(express.json({ limit: "2mb" }));
    app.get("/api/evaluations", (_req, res) =>
      res.json({
        evaluations: store.list(),
        configured: Boolean(config.apiKey),
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
        const limit =
          req.query.limit === undefined ? 20 : Number(req.query.limit);
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
      const trace = store.trace(
        String(req.params.id),
        String(req.params.caseId),
      );
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
          res.json(
            store.setArchived(id, action === "archive", req.body.revision),
          );
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
        res
          .status(error.includes("changed elsewhere") ? 409 : 400)
          .json({ error });
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
        configured: Boolean(config.apiKey),
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
    executor = new RunExecutor({
      store,
      configured: Boolean(config.apiKey),
      redact: (message) =>
        config.apiKey
          ? message.replaceAll(config.apiKey, "[redacted]")
          : message,
      createProvider:
        createProvider ??
        (() => {
          const client = new TypeSafeClient({
            apiKey: config.apiKey,
            baseURL: config.baseURL,
            retry: { maxRetries: 0 },
            timeout: 30000,
          });
          return {
            systemOne: (request) =>
              client.systemOne({ ...request, state: request.state as never }),
          };
        }),
    });
    app.post("/api/runs", (req, res) => {
      try {
        const accepted = executor!.start({
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
    server = createHttpServer(app);
    if (config.built) {
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
      vite = await createServer({
        root: fileURLToPath(new URL("../", import.meta.url)),
        server: { middlewareMode: true, hmr: { server } },
        appType: "spa",
      });
      app.use(vite.middlewares);
    }
    server.listen(port, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server!.once("error", reject);
      server!.once("listening", () => {
        server!.removeListener("error", reject);
        resolve();
      });
    });
    const actualPort = (server.address() as { port: number }).port;
    return { url: `http://localhost:${actualPort}`, close };
  } catch (error) {
    await close();
    if ((error as NodeJS.ErrnoException).code === "EADDRINUSE")
      throw Error(
        `Port ${port} is already in use. Try jevals --port ${port + 1 > 65535 ? 4317 : port + 1}, or stop the other server.`,
      );
    throw error;
  }
}

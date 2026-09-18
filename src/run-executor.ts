import { createHash, randomUUID } from "node:crypto";
import type { Store } from "./store.js";
import type { Run, Result } from "./types.js";
import { stateErrors } from "./state-schema.js";
import {
  validateSuite,
  requestQuestions,
  decodeAnswers,
  failedAnswers,
} from "./questions.js";

export interface JudgmentRequest {
  model: string;
  state: unknown;
  questions: ReturnType<typeof requestQuestions>;
}
export interface JudgmentProvider {
  systemOne(request: JudgmentRequest): Promise<{
    model: string;
    answers: unknown;
    usage: { input_tokens: number; output_tokens: number };
  }>;
}
interface Options {
  store: Pick<Store, "get" | "first" | "saveRun">;
  createProvider(): JudgmentProvider;
  configured: boolean;
  redact(message: string): string;
}
export class RunRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Acceptance, progress and finalization share one ownership lifetime per Jeval. */
export class RunExecutor {
  private readonly running = new Set<string>();
  constructor(private readonly options: Options) {}

  start(input: { evaluationId?: string; suite?: unknown }): {
    id: string;
    finished: Promise<Run>;
  } {
    let suite;
    let evaluation;
    try {
      if (
        input.evaluationId !== undefined &&
        (typeof input.evaluationId !== "string" || !input.evaluationId)
      )
        throw Error("Provide an evaluation ID.");
      evaluation = input.evaluationId
        ? this.options.store.get(input.evaluationId)
        : this.options.store.first();
      if (!evaluation) throw Error("Evaluation not found.");
      if (evaluation.archivedAt)
        throw Error("Restore this evaluation before running it.");
      suite = validateSuite(
        input.evaluationId ? evaluation.suite : input.suite,
        true,
      );
      const errors = stateErrors(suite);
      if (errors.length) throw Error(errors.join("\n"));
    } catch (error) {
      throw new RunRequestError(
        400,
        error instanceof Error ? error.message : "Invalid evaluation.",
      );
    }
    if (!this.options.configured)
      throw new RunRequestError(
        400,
        "Set TYPESAFE_API_KEY in .env, then restart the server to run Jev.",
      );
    const evaluationId = evaluation.id;
    if (this.running.has(evaluationId))
      throw new RunRequestError(
        409,
        "This jeval is already running. Wait for it to finish.",
      );
    this.running.add(evaluationId);
    try {
      const run: Run = {
        id: randomUUID(),
        evaluationId,
        createdAt: new Date().toISOString(),
        suite,
        results: [],
        status: "running",
        datasetKey: createHash("sha256")
          .update(
            JSON.stringify(
              suite.cases
                .map((c) => ({
                  id: c.id,
                  state: c.state,
                  expectations: Object.fromEntries(
                    Object.entries(c.expectations ?? {})
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([id, expected]) => [
                        id,
                        expected.tolerance === undefined
                          ? expected.value
                          : {
                              value: expected.value,
                              tolerance: expected.tolerance,
                            },
                      ]),
                  ),
                  questions: suite
                    .questions!.map((q) => ({
                      id: q.id,
                      type: q.type,
                      ...(q.type === "choice"
                        ? { options: Object.keys(q.criteria).sort() }
                        : q.type === "score"
                          ? { levels: q.criteria }
                          : {}),
                    }))
                    .sort((a, b) => a.id.localeCompare(b.id)),
                }))
                .sort((a, b) => a.id.localeCompare(b.id)),
            ),
          )
          .digest("hex"),
      };
      // A run is accepted only once its initial snapshot is durable.
      this.options.store.saveRun(run);
      return { id: run.id, finished: this.execute(run) };
    } catch {
      this.running.delete(evaluationId);
      throw new RunRequestError(
        500,
        "Could not save the run. Check local storage and try again.",
      );
    }
  }

  private async execute(run: Run): Promise<Run> {
    try {
      const provider = this.options.createProvider();
      for (const c of run.suite.cases) {
        let state: unknown;
        try {
          state = JSON.parse(c.state);
        } catch {
          state = c.state;
        }
        const request = {
          model: run.suite.model,
          state,
          questions: requestQuestions(run.suite),
        };
        const started = performance.now();
        let result: Result;
        try {
          const response = await provider.systemOne(request);
          const answers = decodeAnswers(run.suite, c, response.answers);
          const input = response.usage.input_tokens;
          const output = response.usage.output_tokens;
          result = {
            case: c,
            answers,
            latencyMs: performance.now() - started,
            request,
            response,
            error: Object.values(answers).some((a) => a.error)
              ? "One or more question answers are invalid."
              : null,
            inputTokens: input,
            outputTokens: output,
            cost:
              response.model === "jev-1.13.0" ? (input * 0.042) / 1e6 : null,
          };
        } catch (e) {
          const message = e instanceof Error ? e.message : "Request failed";
          result = {
            case: c,
            answers: failedAnswers(run.suite, "Request failed"),
            latencyMs: performance.now() - started,
            request,
            response: null,
            error: this.options.redact(message),
            inputTokens: null,
            outputTokens: null,
            cost: null,
          };
        }
        run.results.push(result);
        this.options.store.saveRun(run);
      }
      run.status = run.results.some((r) => r.error) ? "failed" : "complete";
    } catch {
      run.status = "failed";
    } finally {
      try {
        this.options.store.saveRun(run);
      } finally {
        this.running.delete(run.evaluationId!);
      }
    }
    return run;
  }
}

import { rankRuns } from "./run-ranking.js";
import type {
  Suite,
  Run,
  RunView,
  Question,
  Answer,
  Case,
  ChoiceQuestion,
  ScoreQuestion,
} from "./types.js";
import { validateSchema } from "./state-schema.js";

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function validProbability(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}
function safeId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(value) &&
    !["__proto__", "constructor", "prototype"].includes(value)
  );
}
function choiceValid(q: ChoiceQuestion, value: unknown): boolean {
  const a = record(value),
    probabilities = record(a.probabilities);
  const labels = Object.keys(q.criteria);
  const values = labels.map((label) => probabilities[label]);
  return (
    a.type === "choice" &&
    typeof a.choice === "string" &&
    Object.hasOwn(q.criteria, a.choice) &&
    validProbability(a.confidence) &&
    Object.keys(probabilities).length === labels.length &&
    values.every(validProbability) &&
    // Provider probabilities may be rounded; reject materially invalid distributions.
    Math.abs((values as number[]).reduce((s, p) => s + p, 0) - 1) <=
      0.02 + Number.EPSILON &&
    validProbability(probabilities[a.choice]) &&
    values.every(
      (p) => Number(p) <= Number(probabilities[String(a.choice)]) + 1e-9,
    )
  );
}
function scoreValid(q: ScoreQuestion, value: unknown): boolean {
  const a = record(value),
    probabilities = record(a.probabilities);
  const keys = q.criteria.map((_, i) => String(i));
  const values = keys.map((k) => probabilities[k]);
  return (
    a.type === "score" &&
    typeof a.score === "number" &&
    Number.isFinite(a.score) &&
    a.score >= 0 &&
    a.score <= q.criteria.length - 1 &&
    validProbability(a.confidence) &&
    Object.keys(probabilities).length === keys.length &&
    values.every(validProbability) &&
    Math.abs(values.reduce((sum, p) => sum + Number(p), 0) - 1) <=
      0.02 + Number.EPSILON &&
    Math.abs(values.reduce((sum, p, i) => sum + i * Number(p), 0) - a.score) <=
      0.02 * q.criteria.length
  );
}
function usable(q: Question, answer: Answer | undefined): boolean {
  if (!answer || answer.error || typeof answer.correct !== "boolean")
    return false;
  return q.type === "noul"
    ? answer.type === "noul" && validProbability(answer.probability)
    : q.type === "choice"
      ? answer.type === "choice" && choiceValid(q, answer)
      : answer.type === "score" && scoreValid(q, answer);
}

/** Selected answers never replace the owning request trace or its error. */
export function questionResults(run: RunView, questionId?: string) {
  const question =
    questionId === undefined
      ? run.suite.questions[0]
      : run.suite.questions.find((q) => q.id === questionId);
  return run.results.map((requestResult) => ({
    case: requestResult.case,
    expected:
      question &&
      run.suite.cases.find((c) => c.id === requestResult.case.id)?.expectations[
        question.id
      ],
    answer: question ? requestResult.answers[question.id] : undefined,
    requestResult,
  }));
}

/** Question correctness is scoped; resources cover each provider request once. */
export function metrics(run: RunView, questionId?: string) {
  const q =
    questionId === undefined
      ? run.suite.questions[0]
      : run.suite.questions.find((q) => q.id === questionId);
  const rows = questionResults(run, questionId);
  const done = q ? rows.filter((r) => usable(q, r.answer)) : [];
  const correct = done.filter((r) => r.answer!.correct).length;
  const brier =
    q?.type !== "score" && done.length
      ? done.reduce((sum, r) => {
          const a = r.answer!;
          return (
            sum +
            (a.type === "noul"
              ? (a.probability! - Number(r.expected?.value)) ** 2
              : a.type === "choice"
                ? Object.keys(a.probabilities!).reduce(
                    (s, label) =>
                      s +
                      (a.probabilities![label] -
                        Number(r.expected?.value === label)) **
                        2,
                    0,
                  )
                : 0)
          );
        }, 0) / done.length
      : null;
  const confusion = new Map<
    string,
    { expected: string; predicted: string; count: number }
  >();
  if (q?.type === "choice")
    for (const r of done) {
      const a = r.answer!;
      if (a.type !== "choice") continue;
      const expected = String(r.expected?.value),
        predicted = a.choice!;
      const key = JSON.stringify([expected, predicted]);
      const entry = confusion.get(key) ?? { expected, predicted, count: 0 };
      entry.count++;
      confusion.set(key, entry);
    }
  return {
    type: q?.type ?? null,
    correct,
    total: run.suite.cases.length,
    accuracy:
      done.length > 0 && done.length === run.suite.cases.length
        ? correct / done.length
        : null,
    brier,
    meanAbsoluteError:
      q?.type === "score" && done.length
        ? done.reduce(
            (sum, r) =>
              sum +
              Math.abs(
                (r.answer as import("./types.js").ScoreAnswer).score! -
                  Number(r.expected?.value),
              ),
            0,
          ) / done.length
        : null,
    falsePositive:
      q?.type === "noul"
        ? done.filter(
            (r) =>
              r.expected?.value === false &&
              r.answer?.type === "noul" &&
              r.answer.probability! >= q.threshold,
          ).length
        : null,
    falseNegative:
      q?.type === "noul"
        ? done.filter(
            (r) =>
              r.expected?.value === true &&
              r.answer?.type === "noul" &&
              r.answer.probability! < q.threshold,
          ).length
        : null,
    confusion: [...confusion.values()],
    inputTokens: run.results.reduce((s, r) => s + (r.inputTokens ?? 0), 0),
    outputTokens: run.results.reduce((s, r) => s + (r.outputTokens ?? 0), 0),
    cost: run.results.some((r) => r.cost === null)
      ? null
      : run.results.reduce((s, r) => s + r.cost!, 0),
    latencyMs: run.results.reduce((s, r) => s + r.latencyMs, 0),
  };
}
export function questionMetrics(run: RunView) {
  return Object.fromEntries(
    run.suite.questions.map((q) => [q.id, metrics(run, q.id)]),
  );
}

/** Validate canonical authoring values; adapters decode historical shapes separately. */
export function validateSuite(value: unknown, forRun = false): Suite {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Provide an evaluation definition.");
  const s = value as Suite;
  if (
    typeof s.name !== "string" ||
    !s.name.trim() ||
    typeof s.model !== "string" ||
    !s.model.trim() ||
    !Array.isArray(s.cases) ||
    s.cases.length > 100 ||
    (forRun && !s.cases.length)
  )
    throw Error("Provide a name, model, and 1–100 cases before running.");
  if (
    !Array.isArray(s.questions) ||
    s.questions.length > 30 ||
    (forRun && !s.questions.length)
  )
    throw Error("Add 1–30 typed questions before running.");
  const questionIds = new Set<string>();
  for (const q of s.questions) {
    if (!q || !["noul", "choice", "score"].includes(q.type))
      throw Error("Use Noul, Choice, or Score questions.");
    if (!safeId(q.id) || questionIds.has(q.id))
      throw Error("Questions need unique, safe stable IDs.");
    if (
      typeof q.name !== "string" ||
      !q.name.trim() ||
      typeof q.instructions !== "string" ||
      (forRun && !q.instructions.trim())
    )
      throw Error(
        "Each question needs a name and instructions before running.",
      );
    if (q.type === "noul") {
      if (
        typeof q.yes !== "string" ||
        typeof q.no !== "string" ||
        !validProbability(q.threshold)
      )
        throw Error(
          "Each Noul question needs criteria and a threshold from 0–1.",
        );
    } else if (q.type === "score") {
      if (
        !Array.isArray(q.criteria) ||
        q.criteria.length > 10 ||
        (forRun && q.criteria.length < 2) ||
        q.criteria.some(
          (level) => typeof level !== "string" || (forRun && !level.trim()),
        )
      )
        throw Error(
          "Score needs 2–10 ordered nonempty text levels before running.",
        );
    } else {
      if (
        !q.criteria ||
        typeof q.criteria !== "object" ||
        Array.isArray(q.criteria)
      )
        throw Error(
          "Choice options must be a map of labels to text descriptions.",
        );
      const entries = Object.entries(q.criteria);
      if (
        entries.length > 255 ||
        (forRun && entries.length < 2) ||
        entries.some(
          ([label, description]) =>
            !label.trim() ||
            label.length > 200 ||
            ["__proto__", "constructor", "prototype"].includes(label) ||
            typeof description !== "string",
        )
      )
        throw Error(
          "Choice needs 2–255 distinct options before running, with nonempty labels and text descriptions.",
        );
    }
    questionIds.add(q.id);
  }
  validateSchema(s.stateSchema ?? []);
  if (
    s.description !== undefined &&
    (typeof s.description !== "string" || s.description.length > 20000)
  )
    throw Error("Description must be text of at most 20,000 characters.");
  const ids = new Set<string>();
  for (const c of s.cases) {
    if (
      !c ||
      typeof c.id !== "string" ||
      !c.id ||
      ids.has(c.id) ||
      typeof c.name !== "string" ||
      !c.name.trim() ||
      typeof c.state !== "string" ||
      (forRun && !c.state.trim())
    )
      throw Error(
        "Each case needs a unique ID, name, and state before running.",
      );
    if (
      !c.expectations ||
      typeof c.expectations !== "object" ||
      Array.isArray(c.expectations)
    )
      throw Error("Case expectations must be keyed by question ID.");
    for (const [id, expected] of Object.entries(c.expectations)) {
      const q = s.questions.find((q) => q.id === id);
      if (
        !q ||
        !expected ||
        typeof expected.rationale !== "string" ||
        (q.type === "noul"
          ? typeof expected.value !== "boolean"
          : q.type === "score"
            ? typeof expected.value !== "number" ||
              !Number.isFinite(expected.value) ||
              expected.value < 0 ||
              expected.value > q.criteria.length - 1 ||
              (expected.tolerance !== undefined &&
                (typeof expected.tolerance !== "number" ||
                  !Number.isFinite(expected.tolerance) ||
                  expected.tolerance < 0 ||
                  expected.tolerance > q.criteria.length - 1))
            : typeof expected.value !== "string" ||
              !Object.hasOwn(q.criteria, expected.value))
      )
        throw Error(
          "Expected answers must match their question: a boolean for Noul, exact option label for Choice, or in-range number and nonnegative tolerance for Score, with a rationale.",
        );
    }
    if (forRun && s.questions.some((q) => !Object.hasOwn(c.expectations, q.id)))
      throw Error(
        `Case ${c.name} needs an expected answer for every question.`,
      );
    ids.add(c.id);
  }
  return structuredClone(s);
}

const common = {
  id: { type: "string" },
  name: { type: "string" },
  instructions: { type: "string" },
};
export const questionSchema = {
  oneOf: [
    {
      type: "object",
      properties: {
        ...common,
        type: { type: "string", const: "score" },
        criteria: { type: "array", items: { type: "string" }, maxItems: 10 },
      },
      required: ["id", "name", "type", "instructions", "criteria"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        ...common,
        type: { type: "string", const: "noul" },
        yes: { type: "string" },
        no: { type: "string" },
        threshold: { type: "number", minimum: 0, maximum: 1 },
      },
      required: [
        "id",
        "name",
        "type",
        "instructions",
        "yes",
        "no",
        "threshold",
      ],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        ...common,
        type: { type: "string", const: "choice" },
        criteria: {
          type: "object",
          additionalProperties: { type: "string" },
          maxProperties: 255,
        },
      },
      required: ["id", "name", "type", "instructions", "criteria"],
      additionalProperties: false,
    },
  ],
};
export const expectationsSchema = {
  type: "object",
  description:
    "Expected answers keyed by stable question ID: boolean for Noul; exact option label for Choice; numeric score and optional tolerance (default 0.5 levels) for Score. Independently reviewed. Missing expectations are allowed in drafts but block running.",
  additionalProperties: {
    type: "object",
    properties: {
      value: {
        oneOf: [{ type: "boolean" }, { type: "string" }, { type: "number" }],
      },
      rationale: { type: "string" },
      tolerance: { type: "number", minimum: 0 },
    },
    required: ["value", "rationale"],
    additionalProperties: false,
  },
};

/** All supported question types share one provider request per case. */
function scoreCriteria(q: ScoreQuestion): [string, string, ...string[]] {
  if (q.criteria.length < 2 || q.criteria.length > 10)
    throw Error("Score needs 2–10 levels.");
  return [q.criteria[0], q.criteria[1], ...q.criteria.slice(2)];
}
export function requestQuestions(suite: Suite) {
  return Object.fromEntries(
    suite.questions.map((q) => [
      q.id,
      q.type === "noul"
        ? {
            type: "noul" as const,
            instructions: q.instructions,
            ...(q.yes || q.no
              ? { criteria: { true: q.yes, false: q.no } }
              : {}),
          }
        : q.type === "score"
          ? {
              type: "score" as const,
              instructions: q.instructions,
              criteria: scoreCriteria(q),
            }
          : {
              type: "choice" as const,
              instructions: q.instructions,
              criteria: structuredClone(q.criteria),
            },
    ]),
  );
}
export function decodeAnswers(
  suite: Suite,
  c: Case,
  value: unknown,
): Record<string, Answer> {
  const answers = record(value);
  return Object.fromEntries(
    suite.questions.map((q) => {
      const a = record(answers[q.id]),
        expected = c.expectations[q.id]?.value;
      if (q.type === "noul") {
        const p = a.type === "noul" ? a.noul : undefined,
          valid = validProbability(p);
        return [
          q.id,
          {
            type: "noul",
            probability: valid ? p : null,
            correct:
              valid && typeof expected === "boolean"
                ? p >= q.threshold === expected
                : null,
            error: !valid
              ? "Jev returned a missing or invalid probability."
              : typeof expected !== "boolean"
                ? "Missing expected answer."
                : null,
          } satisfies Answer,
        ];
      }
      if (q.type === "score") {
        const valid = scoreValid(q, a),
          hasExpected =
            typeof expected === "number" &&
            Number.isFinite(expected) &&
            expected >= 0 &&
            expected <= q.criteria.length - 1;
        return [
          q.id,
          {
            type: "score",
            score: valid ? (a.score as number) : null,
            confidence: valid ? (a.confidence as number) : null,
            probabilities: valid
              ? (structuredClone(a.probabilities) as Record<string, number>)
              : null,
            correct:
              valid && hasExpected
                ? Math.abs(Number(a.score) - expected) <=
                  (c.expectations[q.id]?.tolerance ?? 0.5) + 1e-9
                : null,
            error: !valid
              ? "Jev returned a missing or invalid Score answer."
              : !hasExpected
                ? "Missing expected answer."
                : null,
          } satisfies Answer,
        ];
      }
      const valid = choiceValid(q, a),
        hasExpected =
          typeof expected === "string" && Object.hasOwn(q.criteria, expected);
      return [
        q.id,
        {
          type: "choice",
          choice: valid ? (a.choice as string) : null,
          confidence: valid ? (a.confidence as number) : null,
          probabilities: valid
            ? (structuredClone(a.probabilities) as Record<string, number>)
            : null,
          correct: valid && hasExpected ? a.choice === expected : null,
          error: !valid
            ? "Jev returned a missing or invalid Choice answer."
            : !hasExpected
              ? "Missing expected answer."
              : null,
        } satisfies Answer,
      ];
    }),
  );
}
export function failedAnswers(
  suite: Suite,
  error: string,
): Record<string, Answer> {
  return Object.fromEntries(
    suite.questions.map((q) => [
      q.id,
      q.type === "noul"
        ? { type: "noul", probability: null, correct: null, error }
        : q.type === "score"
          ? {
              type: "score",
              score: null,
              confidence: null,
              probabilities: null,
              correct: null,
              error,
            }
          : {
              type: "choice",
              choice: null,
              confidence: null,
              probabilities: null,
              correct: null,
              error,
            },
    ]),
  );
}
export function runOutcome(
  run: RunView,
): "running" | "complete" | "partial" | "failed" {
  if (run.status === "running") return "running";
  let valid = 0;
  const total = run.suite.cases.length * run.suite.questions.length;
  for (const c of run.suite.cases)
    for (const q of run.suite.questions) {
      const r = run.results.find((r) => r.case.id === c.id);
      if (usable(q, r?.answers[q.id])) valid++;
    }
  if (
    total > 0 &&
    valid === total &&
    run.status === "complete" &&
    !run.results.some((r) => r.error)
  )
    return "complete";
  return valid > 0 ? "partial" : "failed";
}
/** Rank comparable, fully successful runs by selected-question accuracy then Brier. */
export function bestRun(
  runs: Run[],
  reference: Run,
  questionId?: string,
): Run | undefined {
  return rankRuns(
    runs.map((run) => ({
      run,
      outcome: runOutcome(run),
      metrics: metrics(run, questionId),
    })),
    reference.datasetKey,
  );
}

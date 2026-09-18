import type {
  Case,
  Suite,
  Run,
  Result,
  Question,
  Evaluation,
} from "./types.js";

/** Only persistence and HTTP adapters carry the historical first-question fields. */
export type SnapshotCase = Omit<Case, "expectations"> & {
  expectations?: Case["expectations"];
  expected?: boolean;
  rationale?: string;
};
export type SnapshotSuite = Omit<Suite, "questions" | "cases"> & {
  questions?: Question[];
  cases: SnapshotCase[];
  instructions?: string;
  yes?: string;
  no?: string;
  threshold?: number;
};
export type SnapshotEvaluation = Omit<Evaluation, "suite"> & {
  suite: SnapshotSuite;
};
export type SnapshotResult = Omit<Result, "answers" | "case"> & {
  answers?: Result["answers"];
  case: SnapshotCase;
  probability?: number | null;
  correct?: boolean | null;
};
export type SnapshotRun = Omit<Run, "suite" | "results"> & {
  suite: SnapshotSuite;
  results: SnapshotResult[];
};

export function decodeCase(value: SnapshotCase, questions: Question[]): Case {
  const { expected, rationale, expectations, ...c } = structuredClone(value);
  const first = questions[0];
  return {
    ...c,
    expectations:
      expectations === undefined
        ? first?.type === "noul" && typeof expected === "boolean"
          ? { [first.id]: { value: expected, rationale: rationale ?? "" } }
          : {}
        : expectations,
  };
}
export function decodeSuite(value: SnapshotSuite): Suite {
  const { instructions, yes, no, threshold, questions, cases, ...suite } =
    structuredClone(value);
  const collection: Question[] =
    questions === undefined
      ? [
          {
            id: "judgment",
            name: "Question 1",
            type: "noul",
            instructions: instructions!,
            yes: yes!,
            no: no!,
            threshold: threshold!,
          },
        ]
      : questions;
  return {
    ...suite,
    questions: collection,
    cases: cases.map((c) => decodeCase(c, collection)),
  };
}
export function decodeRun(value: SnapshotRun): Run {
  const run = structuredClone(value);
  const suite = decodeSuite(run.suite);
  const first = suite.questions[0];
  return {
    ...run,
    suite,
    results: run.results.map((r) => {
      const { probability, correct, answers, ...request } = r;
      return {
        ...request,
        case: decodeCase(r.case, suite.questions),
        answers:
          answers ??
          (first?.type === "noul"
            ? {
                [first.id]: {
                  type: "noul",
                  probability: probability ?? null,
                  correct: correct ?? null,
                  error: r.error,
                },
              }
            : {}),
      };
    }),
  };
}
export function encodeCase(c: Case, questions: Question[]): SnapshotCase {
  const expected = questions[0] && c.expectations[questions[0].id];
  return {
    ...structuredClone(c),
    expected: expected?.value === true,
    rationale: expected?.rationale ?? "",
  };
}
export function encodeSuite(suite: Suite): SnapshotSuite {
  const q = suite.questions[0];
  return {
    ...structuredClone(suite),
    cases: suite.cases.map((c) => encodeCase(c, suite.questions)),
    instructions: q?.instructions ?? "",
    yes: q?.type === "noul" ? q.yes : "",
    no: q?.type === "noul" ? q.no : "",
    threshold: q?.type === "noul" ? q.threshold : 0.5,
  };
}
export function encodeRun(run: Run): SnapshotRun {
  return {
    ...structuredClone(run),
    suite: encodeSuite(run.suite),
    results: run.results.map((r) => {
      const first = r.answers[run.suite.questions[0]?.id];
      return {
        ...r,
        case: encodeCase(r.case, run.suite.questions),
        probability: first?.type === "noul" ? first.probability : null,
        correct: first?.correct ?? null,
      };
    }),
  };
}

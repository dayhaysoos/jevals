import type { metrics } from "./questions.js";
export interface ExpectedAnswer {
  value: boolean | string | number;
  tolerance?: number;
  rationale: string;
}
export interface Case {
  id: string;
  name: string;
  state: string;
  expectations: Record<string, ExpectedAnswer>;
}
export interface StateField {
  key: string;
  label: string;
  type: "text" | "long-text";
  required: boolean;
  defaultValue: string;
}
export interface Suite {
  description?: string;
  questions: Question[];
  stateSchema?: StateField[];
  name: string;
  model: string;
  cases: Case[];
}
export interface NoulAnswer {
  type: "noul";
  probability: number | null;
  correct: boolean | null;
  error: string | null;
}
export interface ChoiceAnswer {
  type: "choice";
  choice: string | null;
  probabilities: Record<string, number> | null;
  confidence: number | null;
  correct: boolean | null;
  error: string | null;
}
export interface ScoreAnswer {
  type: "score";
  score: number | null;
  probabilities: Record<string, number> | null;
  confidence: number | null;
  correct: boolean | null;
  error: string | null;
}
export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;
/** One provider request, with independently decoded answers. */
export interface Result {
  answers: Record<string, Answer>;
  case: Case;
  latencyMs: number;
  request: unknown;
  response: unknown;
  error: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cost: number | null;
}
export interface Evaluation {
  archivedAt?: string | null;
  id: string;
  suite: Suite;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
export interface Run {
  evaluationId?: string;
  id: string;
  createdAt: string;
  suite: Suite;
  results: Result[];
  status: "running" | "complete" | "failed";
  datasetKey: string;
}
/** Selected-run judgments and snapshots, without raw request/response traces. */
export type RunView = Omit<Run, "results"> & {
  results: Omit<Result, "request" | "response">[];
};
export interface RunSummary {
  id: string;
  evaluationId: string;
  name: string;
  model: string;
  createdAt: string;
  status: Run["status"];
  outcome: "running" | "complete" | "partial" | "failed";
  datasetKey: string;
  questions: Pick<Question, "id" | "name" | "type">[];
  metrics: ReturnType<typeof metrics>;
  questionMetrics: Record<string, ReturnType<typeof metrics>>;
}
export interface RunHistoryPage {
  runs: RunSummary[];
  nextCursor: number | null;
}
export interface SelectedRun {
  run: RunView;
  bestRuns: Record<string, RunSummary | null>;
}
export interface EvaluationSummary {
  archivedAt?: string | null;
  questionCount: number;
  questionTypes: string[];
  id: string;
  name: string;
  caseCount: number;
  updatedAt: string;
  revision: number;
  latestRun: {
    id: string;
    status: Run["status"];
    outcome: "running" | "complete" | "partial" | "failed";
    createdAt: string;
    metrics: ReturnType<typeof metrics>;
  } | null;
}
export interface NoulQuestion {
  id: string;
  name: string;
  type: "noul";
  instructions: string;
  yes: string;
  no: string;
  threshold: number;
}
export interface ChoiceQuestion {
  id: string;
  name: string;
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
}
export interface ScoreQuestion {
  id: string;
  name: string;
  type: "score";
  instructions: string;
  criteria: string[];
}
export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;

import {
  replaceQuestions,
  upsertQuestion,
  removeQuestion,
} from "./question-authoring.js";
import { questionSchema, expectationsSchema } from "./questions.js";
import { api } from "./api.js";
import { decodeCase, type SnapshotCase } from "./snapshots.js";
import type { Suite, Question } from "./types.js";
import type { EvaluationWorkspace } from "./workspace.js";
type Schema = Record<string, unknown>;
interface Tool {
  name: string;
  description: string;
  inputSchema: Schema;
  annotations: {
    readOnlyHint: boolean;
    consequentialHint: boolean;
    untrustedContentHint: boolean;
  };
  execute: (
    input: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ) => Promise<string>;
}
interface Context {
  registerTool(
    tool: Tool,
    options?: { signal: AbortSignal },
  ): Promise<void> | void;
}
interface Hooks {
  workspace: EvaluationWorkspace;
  creationDialog: (action: "open" | "close") => Promise<void>;
  changed: () => Promise<void>;
  open: (id: string, tab: string) => Promise<void>;
  status: (message: string) => void;
}
const str = { type: "string" };
const id = {
  evaluationId: {
    ...str,
    description: "Stable evaluation ID from list_evaluations.",
  },
};
const field = {
  type: "object",
  properties: {
    key: str,
    label: str,
    type: { type: "string", enum: ["text", "long-text"] },
    required: { type: "boolean" },
    defaultValue: str,
  },
  required: ["key", "label", "type", "required", "defaultValue"],
  additionalProperties: false,
};
const caseSchema = {
  type: "object",
  properties: {
    id: str,
    name: str,
    state: {
      oneOf: [str, { type: "object" }],
      description:
        "Plain text, JSON text, or a JSON object matching the evaluation state schema.",
    },
    expectations: expectationsSchema,
    expected: {
      type: "boolean",
      description:
        "Expected yes/no label to be reviewed by the user independently of Jev outputs.",
    },
    rationale: str,
  },
  required: ["id", "name", "state"],
  additionalProperties: false,
};
const definition = {
  description: {
    type: "string",
    maxLength: 20000,
    description:
      "Optional detailed explanation of what this jeval tests. Documentation only; not sent as model instructions.",
  },
  questions: { type: "array", items: questionSchema, maxItems: 30 },
  name: str,
  instructions: str,
  yes: str,
  no: str,
  model: str,
  threshold: { type: "number", minimum: 0, maximum: 1 },
  stateSchema: { type: "array", items: field, maxItems: 30 },
};
export function tools(hooks: Hooks): Tool[] {
  const schema = (properties: Schema, required: string[] = []) => ({
    type: "object",
    properties,
    required,
    additionalProperties: false,
  });
  const make = (
    name: string,
    description: string,
    inputSchema: Schema,
    execute: (
      input: Record<string, unknown>,
      signal?: AbortSignal,
    ) => Promise<unknown>,
    readOnlyHint = true,
    consequentialHint = false,
  ): Tool => ({
    name,
    description,
    inputSchema,
    annotations: {
      readOnlyHint,
      consequentialHint,
      untrustedContentHint: true,
    },
    execute: async (input, options) => {
      try {
        return JSON.stringify(await execute(input, options?.signal));
      } catch (e) {
        if (options?.signal?.aborted) throw e;
        return JSON.stringify({
          isError: true,
          error: e instanceof Error ? e.message : "Tool execution failed.",
        });
      }
    },
  });
  const path = (input: Record<string, unknown>) => {
    if (typeof input.evaluationId !== "string" || !input.evaluationId)
      throw Error("Provide an evaluation ID.");
    return `/api/evaluations/${encodeURIComponent(input.evaluationId)}`;
  };
  const mutation = async (
    input: Record<string, unknown>,
    signal: AbortSignal | undefined,
    edit: (suite: Suite) => void,
  ) => {
    path(input);
    const saved = await hooks.workspace.mutateSaved(
      String(input.evaluationId),
      Number(input.revision),
      edit,
      signal,
    );
    await hooks.changed();
    return saved;
  };
  return [
    make(
      "open_evaluation_creation",
      "Open the accessible new evaluation dialog to name a collection. Add typed questions later in Definition. Does not create an evaluation.",
      schema({}, []),
      async () => {
        await hooks.creationDialog("open");
        return {
          opened: true,
          questionTypes: [
            { name: "Noul", enabled: true },
            { name: "Choice", enabled: true },
            { name: "Score", enabled: true },
          ],
        };
      },
      false,
    ),
    make(
      "close_evaluation_creation",
      "Cancel the new evaluation dialog without creating an evaluation.",
      schema({}, []),
      async () => {
        await hooks.creationDialog("close");
        return { closed: true };
      },
      false,
    ),
    make(
      "get_eval_framework",
      "Read jevals capabilities and the data contract before creating evaluations. Noul, Choice and Score execution; schemas generate case forms; expected answers must be independently reviewed.",
      schema({}),
      async () => ({
        structure:
          "An evaluation contains shared state schema, typed questions with stable IDs, and cases with expectations keyed by question ID. The canonical definition contains questions and keyed expectations. Legacy instructions/yes/no/threshold and case expected/rationale are accepted only for compatibility with first-Noul definitions; use questions and expectations for new work. Saved historical/exported snapshots may retain compatibility projections.",
        questionTypes: [
          { type: "noul", enabled: true },
          { type: "choice", enabled: true },
          { type: "score", enabled: true },
        ],
        answer:
          "Noul: probability of yes from 0 to 1. Choice: selected option, full probability distribution, and separate confidence. Score: fractional position on 2–10 ordered levels, probabilities per level and confidence; expected numeric score with optional tolerance (default 0.5 levels). Metrics use mean absolute error and within-tolerance pass rate.",
        workflow: [
          "Create a named evaluation with shared state schema and zero or more atomic typed questions.",
          "Add cases and proposed expected boolean, option or numeric labels with rationales for user review.",
          "Save definitions before running.",
          "Run sends case state to TypeSafe and incurs API cost.",
          "Read question-scoped run results and compare only identical question IDs and case answer keys.",
        ],
        definitionFields: definition,
        caseSchema,
        thresholdMeaning:
          "Probability >= threshold is yes. Defaults initialize new cases; schema changes do not rewrite stored state. No credentials are exposed.",
      }),
    ),
    make(
      "list_evaluations",
      "List saved evaluations with IDs, primitive, case counts, latest run and metrics. No aggregate accuracy across unrelated evaluations.",
      schema({}),
      async (_i, s) => api("/api/evaluations", "GET", undefined, s),
    ),
    ...(["archive", "restore"] as const).map((action) =>
      make(
        `${action}_evaluation`,
        `${action === "archive" ? "Archive an evaluation from the active list" : "Restore an archived evaluation"}. Preserves all cases and historical runs. Requires current revision; blocked by unsaved UI edits.`,
        schema({ ...id, revision: { type: "integer", minimum: 1 } }, [
          "evaluationId",
          "revision",
        ]),
        async (i, signal) => {
          path(i);
          const saved = await hooks.workspace.changeArchive(
            String(i.evaluationId),
            action === "archive",
            Number(i.revision),
            signal,
          );
          await hooks.changed();
          return saved;
        },
        false,
      ),
    ),
    make(
      "get_evaluation",
      "Read an evaluation definition, schema, cases, revision and first page of run summaries. Use list_evaluation_runs with runCursor for older history; get_run inspects one full run. Use the revision for updates.",
      schema(id, ["evaluationId"]),
      async (i, s) => api(path(i), "GET", undefined, s),
    ),
    make(
      "list_evaluation_runs",
      "Read a bounded page of run summaries without raw traces. Pass nextCursor as before for older runs. Defaults to 20; maximum 50. Progress updates do not reorder history.",
      schema(
        {
          ...id,
          before: { type: "integer", minimum: 1 },
          limit: { type: "integer", minimum: 1, maximum: 50 },
        },
        ["evaluationId"],
      ),
      async (i, s) => {
        const query = new URLSearchParams();
        if (i.before !== undefined) query.set("before", String(i.before));
        if (i.limit !== undefined) query.set("limit", String(i.limit));
        return api(`${path(i)}/runs?${query}`, "GET", undefined, s);
      },
    ),
    make(
      "create_evaluation",
      "Create and persist an evaluation collection. Questions and cases may be empty. Noul, Choice and Score questions share one state/request per case; Score uses ordered rubric levels. Review expected labels with the user before treating results as accuracy.",
      schema(
        {
          ...definition,
          cases: { type: "array", items: caseSchema, maxItems: 100 },
        },
        ["name"],
      ),
      async (i, s) => {
        const body = {
          model: "jev-1.13.0",
          threshold: 0.5,
          instructions: "",
          yes: "",
          no: "",
          stateSchema: [],
          ...(i.questions === undefined && i.instructions === undefined
            ? { questions: [] }
            : {}),
          ...i,
          cases: Array.isArray(i.cases)
            ? i.cases.map((c) => normalizeCase(c as SnapshotCase))
            : [],
        };
        const created = await api("/api/evaluations", "POST", body, s);
        await hooks.changed();
        return created;
      },
      false,
    ),
    make(
      "update_evaluation_definition",
      "Update named definition fields or replace state schema. Requires current revision. Preserves case state. Question replacements apply the same expected-answer invalidation as question upserts; required schema changes may make cases incomplete.",
      schema(
        {
          ...id,
          revision: { type: "integer", minimum: 1 },
          changes: {
            type: "object",
            properties: definition,
            additionalProperties: false,
          },
        },
        ["evaluationId", "revision", "changes"],
      ),
      async (i, s) =>
        mutation(i, s, (suite) => {
          if (
            !i.changes ||
            typeof i.changes !== "object" ||
            Array.isArray(i.changes)
          )
            throw Error("Provide definition changes.");
          for (const [key, value] of Object.entries(i.changes)) {
            if (!(key in definition))
              throw Error(`Unsupported definition field: ${key}`);
            if (["instructions", "yes", "no", "threshold"].includes(key)) {
              const first = suite.questions?.[0];
              if (!first || first.type !== "noul")
                throw Error(
                  "Legacy fields require a first Noul question; use upsert_evaluation_question.",
                );
              Object.assign(first, { [key]: value });
            } else if (key === "questions")
              replaceQuestions(suite, value as Question[]);
            else Object.assign(suite, { [key]: value });
          }
        }),
      false,
    ),
    make(
      "upsert_evaluation_question",
      "Add or replace a typed question by stable ID. Noul, Choice and Score are enabled; Score uses ordered rubric levels. Adding a question leaves case expectations unset. Changing primitive, or adding/removing/reordering Score levels, clears affected expectations; removing Choice labels clears their expectations. Wording edits preserve expectations. Review missing expected answers before running. Requires current revision.",
      schema(
        {
          ...id,
          revision: { type: "integer", minimum: 1 },
          question: questionSchema,
        },
        ["evaluationId", "revision", "question"],
      ),
      async (i, s) =>
        mutation(i, s, (suite) => {
          upsertQuestion(suite, i.question as Question);
        }),
      false,
    ),
    make(
      "remove_evaluation_question",
      "Remove a question and its current case expectations. Historical runs remain intact. Requires current revision.",
      schema(
        { ...id, revision: { type: "integer", minimum: 1 }, questionId: str },
        ["evaluationId", "revision", "questionId"],
      ),
      async (i, s) =>
        mutation(i, s, (suite) => {
          removeQuestion(suite, String(i.questionId));
        }),
      false,
    ),
    make(
      "upsert_evaluation_case",
      "Add or replace a case by stable ID. Include its shared state and expectations keyed by question ID, with independently reviewed boolean (Noul) or exact option (Choice) labels, or numeric Score values with optional tolerance and rationales. Legacy expected/rationale fields apply only to the first question. Requires current evaluation revision.",
      schema(
        { ...id, revision: { type: "integer", minimum: 1 }, case: caseSchema },
        ["evaluationId", "revision", "case"],
      ),
      async (i, s) =>
        mutation(i, s, (suite) => {
          const c = decodeCase(
            normalizeCase(i.case as SnapshotCase),
            suite.questions,
          );
          const index = suite.cases.findIndex((item) => item.id === c.id);
          if (index < 0) suite.cases.push(c);
          else suite.cases[index] = c;
        }),
      false,
    ),
    make(
      "remove_evaluation_case",
      "Remove one saved case by ID. Historical run snapshots remain intact. Requires the current evaluation revision.",
      schema(
        { ...id, revision: { type: "integer", minimum: 1 }, caseId: str },
        ["evaluationId", "revision", "caseId"],
      ),
      async (i, s) =>
        mutation(i, s, (suite) => {
          const index = suite.cases.findIndex((c) => c.id === i.caseId);
          if (index < 0) throw Error("Case not found.");
          suite.cases.splice(index, 1);
        }),
      false,
    ),
    make(
      "run_evaluation",
      "Run all questions in the SAVED evaluation together, once per case, against TypeSafe. Sends all case states externally and incurs API cost. Returns a run ID immediately; accepted server runs continue even if this tool is cancelled. Use get_run to poll completion.",
      schema(id, ["evaluationId"]),
      async (i, s) => {
        path(i);
        if (!hooks.workspace.canMutate(String(i.evaluationId)))
          throw Error("Save pending UI edits before running.");
        const run = await api(
          "/api/runs",
          "POST",
          { evaluationId: i.evaluationId },
          s,
        );
        await hooks.changed();
        return run;
      },
      false,
      true,
    ),
    make(
      "get_run",
      "Read a saved run, its immutable definition, per-case raw traces, metrics, errors, status and derived outcome (running, complete, partial or failed). Only fully successful runs qualify as best. A running run is incomplete.",
      schema({ runId: str }, ["runId"]),
      async (i, s) => {
        if (typeof i.runId !== "string") throw Error("Provide a run ID.");
        return api(
          `/api/runs/${encodeURIComponent(i.runId)}`,
          "GET",
          undefined,
          s,
        );
      },
    ),
    make(
      "export_run",
      "Read the complete JSON report for a saved run, including case data and request/response traces, for user-reviewed sharing.",
      schema({ runId: str }, ["runId"]),
      async (i, s) => {
        if (typeof i.runId !== "string") throw Error("Provide a run ID.");
        return api(
          `/api/runs/${encodeURIComponent(i.runId)}/export`,
          "GET",
          undefined,
          s,
        );
      },
    ),
    make(
      "open_evaluation",
      "Navigate to an evaluation and Results, Cases, Definition or Runs. Unsaved drafts remain in memory.",
      schema(
        {
          ...id,
          tab: {
            type: "string",
            enum: ["results", "cases", "definition", "runs"],
          },
        },
        ["evaluationId"],
      ),
      async (i) => {
        path(i);
        await hooks.open(String(i.evaluationId), String(i.tab ?? "results"));
        return { opened: i.evaluationId, tab: i.tab ?? "results" };
      },
      false,
    ),
  ];
}
function normalizeCase(c: SnapshotCase): SnapshotCase {
  if (!c || typeof c !== "object") throw Error("Provide a case.");
  return {
    ...c,
    state:
      typeof c.state === "string" ? c.state : JSON.stringify(c.state, null, 2),
  };
}
export async function registerWebMCP(hooks: Hooks) {
  const context =
    (document as Document & { modelContext?: Context }).modelContext ??
    (navigator as Navigator & { modelContext?: Context }).modelContext;
  if (!context?.registerTool) {
    hooks.status("WebMCP unavailable in this browser");
    return;
  }
  const controller = new AbortController();
  try {
    const registered = tools(hooks);
    for (const tool of registered)
      await context.registerTool(tool, { signal: controller.signal });
    hooks.status(`WebMCP ready · ${registered.length} tools`);
  } catch (e) {
    controller.abort();
    hooks.status("WebMCP registration failed");
    console.error(
      "WebMCP registration failed:",
      e instanceof Error ? e.name : "Unknown error",
    );
  }
  import.meta.hot?.dispose(() => controller.abort());
}

// Native WebMCP smoke test with an isolated database and simulated Jev provider.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.ts";
import { decodeAnswers } from "../src/questions.ts";
const dir = mkdtempSync(join(tmpdir(), "jevals-browser-"));
let responseGate = null;
let responseMode = "complete";
const requests = [];
const provider = createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", async () => {
    const input = JSON.parse(body);
    requests.push(input);
    if (responseGate) await responseGate;
    res.setHeader("Content-Type", "application/json");
    if (responseMode === "failed") {
      res.writeHead(500);
      res.end(JSON.stringify({ message: "Simulated provider failure" }));
      return;
    }
    res.end(
      JSON.stringify({
        model: "jev-1.13.0",
        answers: Object.fromEntries(
          Object.keys(input.questions)
            .filter(
              (id) =>
                (responseMode !== "partial" || id !== "second") &&
                (responseMode !== "partial-choice" ||
                  input.questions[id].type !== "choice"),
            )
            .map((id) => [
              id,
              input.questions[id].type === "choice"
                ? {
                    type: "choice",
                    choice: "returns",
                    confidence: 0.7,
                    probabilities: Object.fromEntries(
                      Object.keys(input.questions[id].criteria).map((label) => [
                        label,
                        label === "returns"
                          ? 0.8
                          : 0.2 /
                            (Object.keys(input.questions[id].criteria).length -
                              1),
                      ]),
                    ),
                  }
                : input.questions[id].type === "score"
                  ? {
                      type: "score",
                      score: 1.3,
                      confidence: 0.54,
                      legend: Object.fromEntries(
                        input.questions[id].criteria.map((level, i) => [
                          String(i),
                          level,
                        ]),
                      ),
                      probabilities: { 0: 0, 1: 0.7, 2: 0.3 },
                    }
                  : {
                      type: "noul",
                      noul:
                        id === "urgency"
                          ? 0.1
                          : input.state.message?.includes("refund")
                            ? 0.9
                            : 0.1,
                    },
            ]),
        ),
        usage: { input_tokens: 100, output_tokens: 5 },
      }),
    );
  });
});
await new Promise((r) => provider.listen(0, "127.0.0.1", r));
const child = spawn(process.execPath, ["--import", "tsx", "src/dev.ts"], {
  env: {
    ...process.env,
    PORT: "4339",
    JEVALS_SERVE_BUILD: "1",
    JEVALS_DB: join(dir, "test.sqlite"),
    TYPESAFE_API_KEY: "simulated-key",
    TYPESAFE_BASE_URL: `http://127.0.0.1:${provider.address().port}`,
  },
  stdio: "pipe",
});
let browser;
try {
  const url = "http://127.0.0.1:4339";
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url + "/api/evaluations")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(ready, "server starts");
  browser = await chromium.launch({
    channel: "chrome",
    args: ["--enable-blink-features=WebMCP"],
  });
  const p = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(url);
  await p.waitForFunction(() =>
    document.documentElement.dataset.webmcpStatus?.startsWith("WebMCP ready"),
  );
  const names = await p.evaluate(async () =>
    (await document.modelContext.getTools()).map((t) => t.name),
  );
  assert.equal(names.length, 18);
  const stringArgs = Number(browser.version().split(".")[0]) < 155;
  const call = (name, input = {}) =>
    p.evaluate(
      async ({ name, input, stringArgs }) => {
        const tool = (await document.modelContext.getTools()).find(
          (t) => t.name === name,
        );
        return JSON.parse(
          await document.modelContext.executeTool(
            tool,
            stringArgs ? JSON.stringify(input) : input,
          ),
        );
      },
      { name, input, stringArgs },
    );
  const initial = await call("list_evaluations");
  const originalId = initial.evaluations[0].id;
  const suite = {
    name: "Refund detection",
    instructions: "Does `message` request a refund?",
    yes: "The sender explicitly asks for money back.",
    no: "No request for money back.",
    model: "jev-1.13.0",
    threshold: 0.5,
    stateSchema: [
      {
        key: "message",
        label: "Customer message",
        type: "long-text",
        required: true,
        defaultValue: "",
      },
    ],
    cases: [],
  };
  const created = await call("create_evaluation", suite);
  assert.ok(created.id);
  assert.equal(created.revision, 1);
  const withCase = await call("upsert_evaluation_case", {
    evaluationId: created.id,
    revision: 1,
    case: {
      id: "refund-yes",
      name: "Explicit refund",
      state: { message: "Please refund my order." },
      expected: true,
      rationale: "The message explicitly requests a refund.",
    },
  });
  assert.equal(withCase.revision, 2);
  const stale = await call("update_evaluation_definition", {
    evaluationId: created.id,
    revision: 1,
    changes: { name: "Stale" },
  });
  assert.equal(stale.isError, true);
  assert.match(stale.error, /stale/);
  await call("open_evaluation", { evaluationId: created.id, tab: "cases" });
  assert.equal(
    await p.locator('[data-state-field="0"]').inputValue(),
    "Please refund my order.",
  );
  await p.locator('[data-state-field="0"]').fill("Unsaved human draft");
  const editorUrl = p.url();
  await p.getByRole("button", { name: "Create jeval", exact: true }).click();
  assert.equal(p.url(), editorUrl);
  await p.keyboard.press("Escape");
  await p.waitForFunction(() => document.activeElement.id === "sidebar-create");
  assert.equal(
    await p.locator('[data-state-field="0"]').inputValue(),
    "Unsaved human draft",
  );
  assert.equal(await p.locator("#webmcp-status").count(), 0);
  const blocked = await call("upsert_evaluation_case", {
    evaluationId: created.id,
    revision: 2,
    case: {
      id: "another",
      name: "Agent case",
      state: { message: "Hello" },
      expected: false,
      rationale: "No refund request.",
    },
  });
  assert.equal(blocked.isError, true);
  assert.match(blocked.error, /unsaved/);
  assert.match(await p.locator("#save-state").innerText(), /Unsaved/);
  let signalStarted;
  const started = new Promise((r) => (signalStarted = r));
  let releaseRequest;
  const released = new Promise((r) => (releaseRequest = r));
  await p.route(
    (url) => url.pathname === `/api/evaluations/${originalId}`,
    async (route) => {
      signalStarted();
      await released;
      await route.continue();
    },
  );
  const destinationClick = p
    .locator(`[data-evaluation="${originalId}"]`)
    .first()
    .click();
  await started;
  await p
    .locator('[data-state-field="0"]')
    .fill("Draft edited during navigation");
  releaseRequest();
  await destinationClick;

  await p.waitForURL(`**/evaluations/${originalId}/results`);
  await p.locator(`[data-evaluation="${created.id}"]`).first().click();
  await p.waitForURL(`**/evaluations/${created.id}/results`);
  await p.getByRole("link", { name: "Cases", exact: true }).click();
  await p.waitForFunction(
    (page) => document.querySelector(".workspace")?.dataset.page === page,
    "cases",
  );
  assert.equal(
    await p.locator('[data-state-field="0"]').inputValue(),
    "Draft edited during navigation",
  );
  await p.locator('[data-state-field="0"]').fill("Please refund my order.");
  await p.getByRole("button", { name: "Save changes", exact: true }).click();
  await p.waitForFunction(
    () => document.querySelector("#notice").textContent === "Changes saved.",
  );
  assert.equal(await p.locator("#save-state").innerText(), "");
  const current = await call("get_evaluation", { evaluationId: created.id });
  assert.equal(current.revision, 3);
  const updated = await call("update_evaluation_definition", {
    evaluationId: created.id,
    revision: 3,
    changes: {
      name: "Refund requests",
      description:
        "Tests explicit refund requests.\nPolicy questions should be negative.",
    },
  });
  assert.equal(updated.revision, 4);
  const accepted = await call("run_evaluation", { evaluationId: created.id });
  assert.ok(accepted.id);
  let finished;
  for (let i = 0; i < 100; i++) {
    finished = await call("get_run", { runId: accepted.id });
    if (finished.run.status !== "running") break;
    await p.waitForTimeout(50);
  }
  assert.equal(finished.run.status, "complete");
  assert.equal(finished.metrics.accuracy, 1);
  assert.equal(
    finished.run.suite.description,
    "Tests explicit refund requests.\nPolicy questions should be negative.",
  );
  const original = await call("get_evaluation", { evaluationId: originalId });
  assert.equal(original.runs.length, 0);
  const exported = await call("export_run", { runId: accepted.id });
  assert.equal(exported.run.evaluationId, created.id);
  await call("open_evaluation", { evaluationId: created.id, tab: "runs" });
  await p.locator(`[data-run="${accepted.id}"]`).click();
  await p.waitForURL(`**/results?run=${accepted.id}`);
  await p.getByRole("button", { name: "Explicit refund", exact: true }).click();
  await p.screenshot({
    path: "/tmp/jevals-nav-results-desktop.png",
    fullPage: true,
  });
  await p.setViewportSize({ width: 390, height: 844 });
  await p.screenshot({
    path: "/tmp/jevals-nav-results-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
  );
  await p.reload();
  await p.waitForSelector("table");
  assert.ok((await p.locator("table").innerText()).includes("Explicit refund"));
  await p.locator("[data-home]").first().click();
  await p.waitForURL(url + "/");
  await p.locator("#search").fill("refund");
  assert.equal(await p.locator(".evaluation-table tbody tr").count(), 1);
  await p.locator("#search").fill("no such evaluation");
  assert.equal(await p.locator(".evaluation-table").count(), 0);
  await p.locator("#search").fill("");
  await p.setViewportSize({ width: 1440, height: 950 });
  await p.screenshot({
    path: "/tmp/jevals-nav-home-desktop.png",
    fullPage: true,
  });
  await p.setViewportSize({ width: 390, height: 844 });
  await p.screenshot({
    path: "/tmp/jevals-nav-home-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
  );
  // Glossary shares the same native dismissal and deferred-refresh lifecycle.
  await p.locator("#sidebar-glossary").click();
  assert.equal(await p.locator("#glossary-dialog").isVisible(), true);
  await p.locator("#close-glossary").focus();
  const glossaryEvaluation = await call("get_evaluation", {
    evaluationId: created.id,
  });
  await call("update_evaluation_definition", {
    evaluationId: created.id,
    revision: glossaryEvaluation.revision,
    changes: { name: glossaryEvaluation.suite.name },
  });
  assert.equal(await p.locator("#glossary-dialog").isVisible(), true);
  assert.equal(
    await p.evaluate(() => document.activeElement.id),
    "close-glossary",
  );
  await p.keyboard.press("Escape");
  await p.waitForFunction(
    () => document.activeElement.id === "sidebar-glossary",
  );
  await p.locator("#sidebar-glossary").click();
  await p.locator("#close-glossary").click();
  await p.waitForFunction(
    () => document.activeElement.id === "sidebar-glossary",
  );
  await call("open_evaluation_creation", {});
  assert.equal(
    await p
      .getByRole("dialog", { name: "New evaluation", exact: true })
      .isVisible(),
    true,
  );
  assert.equal(await p.getByRole("radio").count(), 0);
  await p.locator("#new-name").fill("Preserved during agent refresh");
  await p
    .getByRole("button", { name: "Create evaluation", exact: true })
    .focus();
  const modalEval = await call("get_evaluation", { evaluationId: created.id });
  await call("update_evaluation_definition", {
    evaluationId: created.id,
    revision: modalEval.revision,
    changes: { name: modalEval.suite.name },
  });
  assert.equal(
    await p.locator("#new-name").inputValue(),
    "Preserved during agent refresh",
  );
  assert.equal(await p.locator("#create-dialog").isVisible(), true);
  await p.locator("#new-name").focus();
  await p.keyboard.press("Shift+Tab");
  assert.equal(
    await p.evaluate(() =>
      document.querySelector("#create-dialog").contains(document.activeElement),
    ),
    true,
  );
  await p.keyboard.press("Escape");
  assert.equal(await p.locator("#create-dialog").isVisible(), false);
  await p.waitForFunction(() => document.activeElement.id === "new-evaluation");
  await call("open_evaluation_creation", {});
  await call("close_evaluation_creation", {});
  assert.equal(await p.locator("#create-dialog").isVisible(), false);
  await p.evaluate(() => {
    document.querySelector("#sidebar-create").click();
    document.querySelector("#create-dialog").close();
    document.querySelector("#sidebar-create").click();
  });
  await p.waitForTimeout(30);
  assert.equal(
    await p.locator("#create-dialog").isVisible(),
    true,
    "queued close does not dismiss a reopened dialog",
  );
  await p.keyboard.press("Escape");
  await p.waitForFunction(() => document.activeElement.id === "sidebar-create");
  await p.getByRole("button", { name: "New jeval", exact: true }).click();
  await p.locator("#new-name").fill("UI-created draft");
  assert.equal(
    await p.locator("#new-description").getAttribute("required"),
    null,
  );
  await p
    .locator("#new-description")
    .fill("Description provided during creation.");
  await p
    .getByRole("button", { name: "Create evaluation", exact: true })
    .click();
  await p.waitForURL("**/definition");
  assert.equal(
    await p.locator('[data-suite="name"]').inputValue(),
    "UI-created draft",
  );
  assert.equal(
    await p.locator('[data-suite="description"]').inputValue(),
    "Description provided during creation.",
  );
  assert.equal(
    await p.locator("#jeval-description").textContent(),
    "Description provided during creation.",
  );
  assert.equal(await p.locator("#jeval-description").isVisible(), false);
  await p
    .getByRole("button", { name: "About this jeval", exact: true })
    .click();
  assert.equal(
    await p
      .getByRole("dialog", { name: "About this jeval", exact: true })
      .isVisible(),
    true,
  );
  assert.equal(
    await p.locator("#mobile-description").innerText(),
    "Description provided during creation.",
  );
  await p.keyboard.press("Escape");
  await p.waitForFunction(() => document.activeElement.id === "about-jeval");
  await p.setViewportSize({ width: 1440, height: 950 });
  await p
    .getByRole("button", { name: "About this jeval", exact: true })
    .click();
  assert.equal(
    await p
      .locator("#about-popover")
      .evaluate((el) => el.matches(":popover-open")),
    true,
  );
  await p.screenshot({ path: "/tmp/jevals-about-desktop.png", fullPage: true });
  await p.locator('[data-suite="description"]').click();
  await p.waitForFunction(
    () => !document.querySelector("#about-popover").matches(":popover-open"),
  );
  assert.equal(
    await p
      .locator('[data-suite="description"]')
      .evaluate((el) => document.activeElement === el),
    true,
  );
  await p
    .getByRole("button", { name: "About this jeval", exact: true })
    .click();
  await p.keyboard.press("Escape");
  await p.waitForFunction(() => document.activeElement.id === "about-jeval");
  await p.setViewportSize({ width: 390, height: 844 });
  await p
    .locator('[data-suite="description"]')
    .fill(
      "Checks the intended behavior.\nIncludes <literal text> and edge cases.",
    );
  assert.equal(
    await p.locator("#jeval-description").textContent(),
    "Checks the intended behavior.\nIncludes <literal text> and edge cases.",
  );
  await p.getByRole("button", { name: "Add question", exact: true }).click();
  assert.equal(
    await p
      .getByRole("button", { name: "Choice · Select an option", exact: true })
      .isDisabled(),
    false,
  );
  assert.equal(
    await p
      .getByRole("button", { name: "Score · Ordered rubric", exact: true })
      .isDisabled(),
    false,
  );
  await p.getByRole("button", { name: "Noul · Yes/no", exact: true }).click();
  assert.equal(
    await p.locator('[data-question="instructions"]').inputValue(),
    "",
  );
  await p.getByRole("link", { name: "Cases", exact: true }).click();
  await p.waitForFunction(
    (page) => document.querySelector(".workspace")?.dataset.page === page,
    "cases",
  );
  await p.getByRole("button", { name: "Add case", exact: true }).click();
  await p.getByRole("button", { name: "Save changes", exact: true }).click();
  await p.waitForFunction(
    () => document.querySelector("#notice").textContent === "Changes saved.",
  );
  await p.reload();
  await p.waitForSelector("#jeval-description", { state: "attached" });
  assert.equal(
    await p.locator("#jeval-description").textContent(),
    "Checks the intended behavior.\nIncludes <literal text> and edge cases.",
  );
  assert.equal(await p.locator("#notice").isVisible(), false);
  let collection = await call("get_evaluation", { evaluationId: created.id });
  collection = await call("upsert_evaluation_question", {
    evaluationId: created.id,
    revision: collection.revision,
    question: {
      id: "urgency",
      name: "Urgency",
      type: "noul",
      instructions: "Does this message require urgent attention?",
      yes: "An immediate deadline is stated.",
      no: "No immediate deadline is stated.",
      threshold: 0.5,
    },
  });
  assert.equal(collection.suite.questions.length, 2);
  const beforeRequests = requests.length;
  const incomplete = await call("run_evaluation", { evaluationId: created.id });
  assert.equal(incomplete.isError, true);
  assert.match(incomplete.error, /expected answer for every question/);
  assert.equal(requests.length, beforeRequests);
  const multiCase = collection.suite.cases[0];
  collection = await call("upsert_evaluation_case", {
    evaluationId: created.id,
    revision: collection.revision,
    case: {
      ...multiCase,
      expectations: {
        ...multiCase.expectations,
        urgency: {
          value: true,
          rationale:
            "Deliberately incorrect answer key for metric isolation test.",
        },
      },
    },
  });
  const multiAccepted = await call("run_evaluation", {
    evaluationId: created.id,
  });
  assert.ok(multiAccepted.id);
  let multiRun;
  for (let i = 0; i < 100; i++) {
    multiRun = await call("get_run", { runId: multiAccepted.id });
    if (multiRun.run.status !== "running") break;
    await p.waitForTimeout(50);
  }
  assert.equal(multiRun.run.status, "complete");
  assert.equal(
    requests.length - beforeRequests,
    1,
    "one batched request per shared case",
  );
  assert.deepEqual(Object.keys(requests.at(-1).questions), [
    "judgment",
    "urgency",
  ]);
  assert.equal(multiRun.questionMetrics.judgment.accuracy, 1);
  assert.equal(multiRun.questionMetrics.urgency.accuracy, 0);
  assert.equal(multiRun.questionMetrics.urgency.falseNegative, 1);
  assert.equal(
    multiRun.metrics.inputTokens,
    100,
    "request tokens counted once",
  );
  await call("open_evaluation", { evaluationId: created.id, tab: "results" });
  await p.locator("#result-question").selectOption("urgency");
  assert.match(await p.locator(".summary").innerText(), /0%/);
  await p.getByRole("link", { name: "Definition", exact: true }).click();
  await p.waitForFunction(
    (page) => document.querySelector(".workspace")?.dataset.page === page,
    "definition",
  );
  await p.setViewportSize({ width: 1440, height: 950 });
  await p.screenshot({
    path: "/tmp/jevals-questions-desktop.png",
    fullPage: true,
  });
  await p.setViewportSize({ width: 390, height: 844 });
  await p.screenshot({
    path: "/tmp/jevals-questions-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
  );
  await p.getByRole("link", { name: "Cases", exact: true }).click();
  await p.waitForFunction(
    (page) => document.querySelector(".workspace")?.dataset.page === page,
    "cases",
  );
  await p.locator("#case-question").selectOption("urgency");
  assert.ok(await p.locator('[data-case="rationale"]').inputValue());
  await p.locator('[data-case="expected"]').selectOption("");
  assert.equal(await p.locator('[data-case="rationale"]').inputValue(), "");
  assert.equal(await p.locator('[data-case="rationale"]').isDisabled(), true);
  await p.locator('[data-case="expected"]').selectOption("false");
  assert.equal(await p.locator('[data-case="rationale"]').inputValue(), "");
  await p
    .locator('[data-case="rationale"]')
    .fill("Reviewed: no immediate deadline.");
  await p.getByRole("button", { name: "Save changes", exact: true }).click();
  await p.waitForFunction(
    () => document.querySelector("#notice").textContent === "Changes saved.",
  );
  await p.reload();
  await p.waitForSelector("#case-question");
  await p.locator("#case-question").selectOption("urgency");
  assert.equal(
    await p.locator('[data-case="rationale"]').inputValue(),
    "Reviewed: no immediate deadline.",
  );
  collection = await call("get_evaluation", { evaluationId: created.id });
  collection = await call("remove_evaluation_question", {
    evaluationId: created.id,
    revision: collection.revision,
    questionId: "urgency",
  });
  assert.equal(collection.suite.questions.length, 1);
  const retained = await call("get_run", { runId: multiAccepted.id });
  assert.equal(
    retained.run.suite.questions.length,
    2,
    "saved run snapshots remain intact",
  );
  await call("open_evaluation", { evaluationId: created.id, tab: "cases" });
  let enteredArchive, releaseArchive;
  const archiveEntered = new Promise((resolve) => {
    enteredArchive = resolve;
  });
  const archiveGate = new Promise((resolve) => {
    releaseArchive = resolve;
  });
  const archiveUrl = `**/api/evaluations/${created.id}/archive`;
  await p.route(archiveUrl, async (route) => {
    enteredArchive();
    await archiveGate;
    await route.continue();
  });
  const pendingArchive = call("archive_evaluation", {
    evaluationId: created.id,
    revision: collection.revision,
  });
  await archiveEntered;
  await p.locator('[data-case="name"]').fill("Edited while archive pending");
  releaseArchive();
  const racedArchive = await pendingArchive;
  assert.ok(racedArchive.archivedAt);
  await p.unroute(archiveUrl);
  await p.getByRole("button", { name: "Save changes", exact: true }).click();
  await p.waitForFunction(
    () => document.querySelector("#notice").textContent === "Changes saved.",
  );
  collection = await call("get_evaluation", { evaluationId: created.id });
  assert.equal(collection.suite.cases[0].name, "Edited while archive pending");
  collection = await call("restore_evaluation", {
    evaluationId: created.id,
    revision: collection.revision,
  });
  const archiveStale = await call("archive_evaluation", {
    evaluationId: created.id,
    revision: 1,
  });
  assert.equal(archiveStale.isError, true);
  const archived = await call("archive_evaluation", {
    evaluationId: created.id,
    revision: collection.revision,
  });
  assert.ok(archived.archivedAt);
  assert.deepEqual(archived.suite, collection.suite);
  const archiveRun = await call("run_evaluation", { evaluationId: created.id });
  assert.equal(archiveRun.isError, true);
  assert.match(archiveRun.error, /Restore/);
  await p.locator("[data-home]").first().click();
  await p.waitForURL(url + "/");
  assert.equal(await p.locator(`[data-evaluation="${created.id}"]`).count(), 0);
  await p.locator("#archive-filter").selectOption("archived");
  assert.match(
    await p.locator(".evaluation-table").innerText(),
    /Refund requests/,
  );
  await p
    .getByRole("button", { name: "Restore Refund requests", exact: true })
    .click();
  await p.waitForFunction(
    () =>
      document.querySelector("#notice").textContent === "Evaluation restored.",
  );
  collection = await call("get_evaluation", { evaluationId: created.id });
  assert.equal(collection.archivedAt, null);
  assert.ok(collection.runs.some((run) => run.id === multiAccepted.id));
  await call("open_evaluation", {
    evaluationId: created.id,
    tab: "definition",
  });
  await p.locator('[data-suite="name"]').fill("Unsaved name");
  assert.equal(
    await p
      .getByRole("button", { name: "Archive evaluation", exact: true })
      .isDisabled(),
    true,
  );
  const archiveBlocked = await call("archive_evaluation", {
    evaluationId: created.id,
    revision: collection.revision,
  });
  assert.equal(archiveBlocked.isError, true);
  await p.getByRole("button", { name: "Save changes", exact: true }).click();
  await p.waitForFunction(
    () => document.querySelector("#notice").textContent === "Changes saved.",
  );
  await p
    .getByRole("button", { name: "Archive evaluation", exact: true })
    .click();
  await p.waitForURL(url + "/");
  collection = await call("get_evaluation", { evaluationId: created.id });
  assert.ok(collection.archivedAt);
  const restored = await call("restore_evaluation", {
    evaluationId: created.id,
    revision: collection.revision,
  });
  assert.equal(restored.archivedAt, null);
  await call("open_evaluation", { evaluationId: originalId, tab: "cases" });
  await p.setViewportSize({ width: 1440, height: 950 });
  const beforeSidebarRun = requests.length;
  const sidebarLink = p.locator(`.sidebar [data-evaluation="${created.id}"]`);
  await sidebarLink.click();
  await p.waitForURL(`**/evaluations/${created.id}/results`);
  assert.equal(
    requests.length,
    beforeSidebarRun,
    "clicking row link does not run",
  );
  const sidebarPlay = p.locator(`[data-sidebar-run="${created.id}"]`);
  await p.locator(`.sidebar [data-evaluation="${originalId}"]`).hover();
  assert.equal(
    await sidebarPlay.evaluate((el) => getComputedStyle(el).opacity),
    "0",
  );
  await p.locator(`.sidebar [data-evaluation="${created.id}"]`).focus();
  assert.equal(
    await sidebarPlay.evaluate((el) => getComputedStyle(el).opacity),
    "1",
    "keyboard focus reveals play",
  );
  await p.locator(`.sidebar [data-evaluation="${created.id}"]`).hover();
  await p.screenshot({ path: "/tmp/jevals-sidebar-play.png", fullPage: true });
  await sidebarPlay.click();
  await p.waitForURL(`**/results?run=*`);
  await p.waitForSelector('.run-caption [data-run-outcome="complete"]');
  assert.equal(
    requests.length - beforeSidebarRun,
    1,
    "explicit play button runs exactly once",
  );
  await p.getByRole("link", { name: "Definition", exact: true }).click();
  await p.waitForFunction(
    (page) => document.querySelector(".workspace")?.dataset.page === page,
    "definition",
  );
  await p.locator('[data-question="name"]').fill("Unsaved question name");
  assert.equal(
    await p.locator(`[data-sidebar-run="${created.id}"]`).isDisabled(),
    true,
  );
  const concurrentCases = [
    {
      id: "c",
      name: "Refund",
      state: { message: "Please refund this order." },
      expected: true,
      rationale: "Explicit request.",
    },
  ];
  const evalA = await call("create_evaluation", {
    ...suite,
    name: "Concurrent A",
    cases: concurrentCases,
  });
  const evalB = await call("create_evaluation", {
    ...suite,
    name: "Concurrent B",
    cases: concurrentCases,
  });
  let releaseResponses;
  responseGate = new Promise((resolve) => {
    releaseResponses = resolve;
  });
  const requestCount = requests.length;
  await call("open_evaluation", { evaluationId: evalA.id, tab: "results" });
  await p.getByRole("button", { name: "Run evaluation", exact: true }).click();
  await p.waitForFunction(
    (id) =>
      document
        .querySelector(`[data-sidebar-run="${id}"]`)
        ?.getAttribute("aria-busy") === "true",
    evalA.id,
  );
  assert.equal(
    await p.locator(`[data-sidebar-run="${originalId}"]`).isDisabled(),
    false,
  );
  await p.locator(`.sidebar [data-evaluation="${evalB.id}"]`).hover();
  await p.locator(`[data-sidebar-run="${evalB.id}"]`).click();
  await p.waitForFunction(
    (id) =>
      document
        .querySelector(`[data-sidebar-run="${id}"]`)
        ?.getAttribute("aria-busy") === "true",
    evalB.id,
  );
  for (let i = 0; i < 100 && requests.length < requestCount + 2; i++)
    await p.waitForTimeout(20);
  assert.equal(
    requests.length - requestCount,
    2,
    "different evaluations reach provider concurrently",
  );
  const runningA = await call("get_evaluation", { evaluationId: evalA.id });
  const runningB = await call("get_evaluation", { evaluationId: evalB.id });
  assert.equal(runningA.runs[0].status, "running");
  assert.equal(runningB.runs[0].status, "running");
  const duplicateA = await call("run_evaluation", { evaluationId: evalA.id });
  assert.equal(duplicateA.isError, true);
  assert.match(duplicateA.error, /already running/);
  await p.locator("[data-home]").first().hover();
  assert.equal(
    await p
      .locator(`[data-sidebar-run="${originalId}"]`)
      .evaluate((el) => getComputedStyle(el).opacity),
    "0",
  );
  assert.equal(await p.locator(`.sidebar .is-running .run-spinner`).count(), 2);
  releaseResponses();
  responseGate = null;
  for (const run of [runningA.runs[0], runningB.runs[0]]) {
    let completed;
    for (let i = 0; i < 100; i++) {
      completed = await call("get_run", { runId: run.id });
      if (completed.run.status !== "running") break;
      await p.waitForTimeout(20);
    }
    assert.equal(completed.run.status, "complete");
    assert.equal(completed.metrics.accuracy, 1);
  }
  // The same saved dataset succeeds, partially succeeds, then fails completely.
  // Exercise provider decoding, persisted outcomes, native WebMCP and visible status.
  const outcomeEval = await call("create_evaluation", {
    name: "Answer integrity",
    description: "Check that a missing sibling answer preserves valid results.",
    questions: ["judgment", "second"].map((id) => ({
      id,
      name: id === "judgment" ? "Refund" : "Second judgment",
      type: "noul",
      instructions: "Does the message request a refund?",
      yes: "Explicit refund request",
      no: "No refund request",
      threshold: 0.5,
    })),
    cases: [
      {
        id: "refund",
        name: "Refund request",
        state: { message: "Please refund my order" },
        expectations: {
          judgment: { value: true, rationale: "Explicit request" },
          second: { value: true, rationale: "Same reviewed request" },
        },
      },
    ],
  });
  const finishOutcomeRun = async () => {
    const accepted = await call("run_evaluation", {
      evaluationId: outcomeEval.id,
    });
    assert.ok(accepted.id, JSON.stringify(accepted));
    let report;
    for (let i = 0; i < 100; i++) {
      report = await call("get_run", { runId: accepted.id });
      if (report.run.status !== "running") return report;
      await p.waitForTimeout(20);
    }
    assert.fail("outcome run did not finish");
  };
  const successful = await finishOutcomeRun();
  assert.equal(successful.outcome, "complete");
  responseMode = "partial";
  const partial = await finishOutcomeRun();
  assert.equal(partial.outcome, "partial");
  assert.equal(
    partial.run.status,
    "failed",
    "stored status remains compatible",
  );
  assert.equal(partial.questionMetrics.judgment.accuracy, 1);
  assert.equal(partial.questionMetrics.second.accuracy, null);
  assert.equal(partial.metrics.inputTokens, 100, "request tokens counted once");
  assert.equal(
    (await call("export_run", { runId: partial.run.id })).outcome,
    "partial",
  );
  await p.goto(
    `${url}/evaluations/${outcomeEval.id}/results?run=${partial.run.id}`,
  );
  await p.waitForSelector('.run-caption [data-run-outcome="partial"]');
  assert.equal(
    await p.locator('.run-caption [data-run-outcome="partial"] svg').count(),
    1,
  );
  assert.match(
    await p.locator(".run-outcome-note").textContent(),
    /Valid answers/,
  );
  const partialHistory = p.locator(`[data-run="${partial.run.id}"]`);
  const successfulHistory = p.locator(`[data-run="${successful.run.id}"]`);
  assert.equal(await partialHistory.locator(".best").count(), 0);
  assert.equal(await successfulHistory.locator(".best").count(), 1);
  await p.locator("#result-question").selectOption("second");
  assert.match(await p.locator(".summary").textContent(), /Incomplete/);
  assert.match(await p.locator(".verdict").first().textContent(), /Error/);
  await p.locator("#result-question").selectOption("judgment");
  assert.match(await p.locator(".summary").textContent(), /100%/);
  const visualDir = mkdtempSync(join(tmpdir(), "jevals-noul-foundation-"));
  await p.screenshot({
    path: join(visualDir, "partial-desktop.png"),
    fullPage: true,
  });
  await p.setViewportSize({ width: 390, height: 844 });
  await p.screenshot({
    path: join(visualDir, "partial-mobile.png"),
    fullPage: true,
  });
  assert.equal(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  await p.setViewportSize({ width: 1440, height: 950 });
  responseMode = "failed";
  const failed = await finishOutcomeRun();
  assert.equal(failed.outcome, "failed");
  assert.equal(failed.questionMetrics.judgment.accuracy, null);
  assert.equal(failed.metrics.cost, null);
  responseMode = "complete";
  await p.goto(
    `${url}/evaluations/${outcomeEval.id}/results?run=${failed.run.id}`,
  );
  await p.waitForSelector('.run-caption [data-run-outcome="failed"]');
  assert.equal(
    await p.locator('.run-caption [data-run-outcome="failed"] svg').count(),
    1,
  );
  assert.match(
    await p.locator(".run-outcome-note").textContent(),
    /No valid answers/,
  );
  assert.equal(
    await p.locator(`[data-run="${failed.run.id}"] .best`).count(),
    0,
  );
  await p.screenshot({
    path: join(visualDir, "failed-desktop.png"),
    fullPage: true,
  });
  await p.locator("[data-home]").first().click();
  const outcomeRow = p
    .locator(".evaluation-table tr")
    .filter({ hasText: "Answer integrity" });
  await outcomeRow.locator('[data-run-outcome="failed"]').waitFor();
  await p.locator("#status-filter").selectOption("failed");
  assert.equal(
    await outcomeRow.count(),
    1,
    "partial and failed outcomes retain failed status filter compatibility",
  );
  console.log(`Noul outcome visual evidence: ${visualDir}`);
  // Pending saves, navigation and agent-triggered refresh share the workspace policy.
  const draftEval = await call("create_evaluation", {
    ...suite,
    name: "Draft reconciliation",
    cases: [
      {
        id: "draft",
        name: "Draft case",
        state: { message: "Please refund my order." },
        expected: true,
        rationale: "Reviewed refund request",
      },
    ],
  });
  await call("open_evaluation", { evaluationId: draftEval.id, tab: "cases" });
  await p.locator('[data-state-field="0"]').fill("Snapshot sent to storage");
  let enteredSave, releaseSave;
  const saveEntered = new Promise((resolve) => {
    enteredSave = resolve;
  });
  const saveGate = new Promise((resolve) => {
    releaseSave = resolve;
  });
  const draftEndpoint = (url) =>
    url.pathname === `/api/evaluations/${draftEval.id}`;
  const saveRoute = async (route) => {
    if (route.request().method() === "PUT") {
      enteredSave();
      await saveGate;
    }
    await route.continue();
  };
  await p.route(draftEndpoint, saveRoute);
  await p.getByRole("button", { name: "Save changes", exact: true }).click();
  await saveEntered;
  assert.equal(await p.locator("#save").isDisabled(), true);
  assert.equal(
    await p.locator('[data-state-field="0"]').isEnabled(),
    true,
    "editing stays available during save",
  );
  await p
    .locator('[data-state-field="0"]')
    .fill("Newer edit during pending save");
  const refreshTrigger = await call("create_evaluation", {
    name: "Agent refresh during save",
  });
  assert.ok(refreshTrigger.id);
  assert.equal(
    await p.locator('[data-state-field="0"]').inputValue(),
    "Newer edit during pending save",
  );
  await call("open_evaluation", { evaluationId: originalId, tab: "results" });
  const blockedDuringSave = await call("update_evaluation_definition", {
    evaluationId: draftEval.id,
    revision: draftEval.revision,
    changes: { name: "Blocked agent overwrite" },
  });
  assert.equal(blockedDuringSave.isError, true);
  releaseSave();
  let savedDraft;
  for (let i = 0; i < 100; i++) {
    savedDraft = await call("get_evaluation", { evaluationId: draftEval.id });
    if (savedDraft.revision > draftEval.revision) break;
    await p.waitForTimeout(20);
  }
  assert.equal(
    JSON.parse(savedDraft.suite.cases[0].state).message,
    "Snapshot sent to storage",
  );
  await p.unroute(draftEndpoint, saveRoute);
  await call("open_evaluation", { evaluationId: draftEval.id, tab: "cases" });
  assert.equal(
    await p.locator('[data-state-field="0"]').inputValue(),
    "Newer edit during pending save",
  );
  assert.match(await p.locator("#save-state").textContent(), /Unsaved/);
  await p.getByRole("button", { name: "Save changes", exact: true }).click();
  await p.waitForFunction(
    () => document.querySelector("#notice").textContent === "Changes saved.",
  );
  const afterSecondSave = await call("get_evaluation", {
    evaluationId: draftEval.id,
  });
  assert.equal(afterSecondSave.revision, draftEval.revision + 2);
  assert.equal(
    JSON.parse(afterSecondSave.suite.cases[0].state).message,
    "Newer edit during pending save",
  );

  // An agent's initially clean read must not authorize a write after a human starts editing.
  let enteredAgentRead,
    releaseAgentRead,
    gateFirstRead = true,
    agentWrites = 0;
  const agentReadEntered = new Promise((resolve) => {
    enteredAgentRead = resolve;
  });
  const agentReadGate = new Promise((resolve) => {
    releaseAgentRead = resolve;
  });
  const agentReadRoute = async (route) => {
    if (route.request().method() === "GET" && gateFirstRead) {
      gateFirstRead = false;
      enteredAgentRead();
      await agentReadGate;
    }
    if (route.request().method() === "PUT") agentWrites++;
    await route.continue();
  };
  await p.route(draftEndpoint, agentReadRoute);
  const delayedAgent = call("update_evaluation_definition", {
    evaluationId: draftEval.id,
    revision: afterSecondSave.revision,
    changes: { name: "Agent replacement" },
  });
  await agentReadEntered;
  await p
    .locator('[data-state-field="0"]')
    .fill("Human edit during agent read");
  releaseAgentRead();
  const agentRejected = await delayedAgent;
  assert.equal(agentRejected.isError, true);
  assert.match(agentRejected.error, /unsaved UI edits/);
  assert.equal(agentWrites, 0, "agent preflight is rechecked before a write");
  await p.unroute(draftEndpoint, agentReadRoute);
  await p.getByRole("button", { name: "Save changes", exact: true }).click();
  await p.waitForFunction(
    () => document.querySelector("#notice").textContent === "Changes saved.",
  );
  const savedAfterAgentRead = await call("get_evaluation", {
    evaluationId: draftEval.id,
  });
  assert.equal(
    JSON.parse(savedAfterAgentRead.suite.cases[0].state).message,
    "Human edit during agent read",
  );
  assert.equal(savedAfterAgentRead.suite.name, "Draft reconciliation");
  // Editing a question after a completed save still targets the current document.
  await p.getByRole("link", { name: "Definition", exact: true }).click();
  await p.waitForFunction(
    (page) => document.querySelector(".workspace")?.dataset.page === page,
    "definition",
  );
  await p.locator('[data-question="name"]').fill("First saved name");
  await p.getByRole("button", { name: "Save changes", exact: true }).click();
  await p.waitForFunction(
    () => document.querySelector("#notice").textContent === "Changes saved.",
  );
  await p.locator('[data-question="name"]').fill("Second saved name");
  await p.getByRole("button", { name: "Save changes", exact: true }).click();
  await p.waitForFunction(
    () => document.querySelector("#notice").textContent === "Changes saved.",
  );
  assert.equal(
    (await call("get_evaluation", { evaluationId: draftEval.id })).suite
      .questions[0].name,
    "Second saved name",
  );
  // Canonical Choice-first mixed Jeval: agent authoring, UI option edits, expectations, and typed traces.
  const capabilities = await call("get_eval_framework");
  assert.equal(
    capabilities.questionTypes.find((q) => q.type === "choice").enabled,
    true,
  );
  assert.equal(
    capabilities.questionTypes.find((q) => q.type === "score").enabled,
    true,
  );
  let mixed = await call("create_evaluation", {
    name: "Support triage — mixed primitives",
    description: "Route support tickets and check refund requests together.",
    questions: [
      {
        id: "department",
        name: "Support department",
        type: "choice",
        instructions: "Which team should handle this ticket?",
        criteria: {
          returns: "Exchanges and refunds",
          shipping: "Delivery status",
          billing: "Charges and invoices",
        },
      },
      {
        id: "refund",
        name: "Refund requested",
        type: "noul",
        instructions: "Does this message request a refund?",
        yes: "Explicit money-back request",
        no: "No money-back request",
        threshold: 0.5,
      },
    ],
    cases: [
      {
        id: "ticket",
        name: "Wrong-size refund",
        state: { message: "Please refund my shoes; they are the wrong size." },
        expectations: {
          department: { value: "returns", rationale: "Wrong size and refund" },
          refund: { value: true, rationale: "Explicit refund request" },
        },
      },
    ],
  });
  assert.ok(mixed.id);
  assert.equal("instructions" in mixed.suite, false);
  await call("open_evaluation", { evaluationId: mixed.id, tab: "definition" });
  await p.locator('[data-choice-label="returns"]').fill("returns_renamed");
  await p.locator('[data-question="instructions"]').click();
  await p.waitForSelector('[data-choice-label="returns_renamed"]');
  await p.getByRole("link", { name: "Cases", exact: true }).click();
  await p.waitForFunction(
    (page) => document.querySelector(".workspace")?.dataset.page === page,
    "cases",
  );
  assert.equal(await p.locator('[data-case="expected"]').inputValue(), "");
  assert.match(
    await p.locator('[data-index="0"] small').innerText(),
    /Needs expected/,
  );
  await p.locator('[data-case="expected"]').selectOption("returns_renamed");
  assert.equal(
    await p.locator('[data-index="0"] small').innerText(),
    "Expected returns_renamed",
  );
  await p.getByRole("link", { name: "Definition", exact: true }).click();
  await p.waitForFunction(
    (page) => document.querySelector(".workspace")?.dataset.page === page,
    "definition",
  );
  await p.locator('[data-choice-label="returns_renamed"]').fill("returns");
  await p.locator('[data-question="instructions"]').click();
  await p.waitForSelector('[data-choice-label="returns"]');
  await p.locator('[data-choice-label="shipping"]').fill("shipping_renamed");
  await p.keyboard.press("Tab");
  assert.equal(
    await p
      .locator('[data-choice-description="shipping_renamed"]')
      .evaluate((el) => document.activeElement === el),
    true,
    "label commit preserves Tab progression to description",
  );
  await p.locator('[data-choice-label="shipping_renamed"]').fill("shipping");
  await p.keyboard.press("Tab");
  assert.equal(
    await p
      .locator('[data-choice-description="shipping"]')
      .evaluate((el) => document.activeElement === el),
    true,
  );
  await p.getByRole("button", { name: "Add option", exact: true }).click();
  assert.equal(await p.locator("[data-choice-label]").count(), 4);
  await p
    .getByRole("button", { name: "Remove option option_1", exact: true })
    .click();
  assert.equal(await p.locator("[data-choice-label]").count(), 3);
  await p.getByRole("button", { name: "Add question", exact: true }).click();
  await p
    .getByRole("button", { name: "Choice · Select an option", exact: true })
    .click();
  assert.equal(await p.locator("[data-choice-label]").count(), 2);
  await p.getByRole("button", { name: "Remove question", exact: true }).click();
  await p.getByRole("link", { name: "Cases", exact: true }).click();
  await p.waitForFunction(
    (page) => document.querySelector(".workspace")?.dataset.page === page,
    "cases",
  );
  await p.locator('[data-case="expected"]').selectOption("returns");
  await p
    .locator('[data-case="rationale"]')
    .fill("Wrong-size refund goes to returns.");
  await p.locator('[data-case="expected"]').selectOption("");
  assert.equal(
    await p.locator('[data-index="0"] small').innerText(),
    "Needs expected answer",
  );
  await p.locator('[data-case="expected"]').selectOption("returns");
  assert.equal(
    await p.locator('[data-index="0"] small').innerText(),
    "Expected returns",
  );
  await p.getByRole("button", { name: "Save changes", exact: true }).click();
  await p.waitForFunction(
    () => document.querySelector("#notice").textContent === "Changes saved.",
  );
  mixed = await call("get_evaluation", { evaluationId: mixed.id });
  assert.equal(mixed.suite.cases[0].expectations.department.value, "returns");
  const choiceVisualDir = mkdtempSync(join(tmpdir(), "jevals-choice-"));
  await p.setViewportSize({ width: 1440, height: 950 });
  await p.getByRole("link", { name: "Definition", exact: true }).click();
  await p.waitForFunction(
    (page) => document.querySelector(".workspace")?.dataset.page === page,
    "definition",
  );
  await p.screenshot({
    path: join(choiceVisualDir, "definition-desktop.png"),
    fullPage: true,
  });
  const callsBeforeMixed = requests.length;
  responseMode = "complete";
  const mixedAccepted = await call("run_evaluation", {
    evaluationId: mixed.id,
  });
  let mixedRun;
  for (let i = 0; i < 100; i++) {
    mixedRun = await call("get_run", { runId: mixedAccepted.id });
    if (mixedRun.run.status !== "running") break;
    await p.waitForTimeout(50);
  }
  assert.equal(mixedRun.outcome, "complete");
  assert.equal(
    requests.length,
    callsBeforeMixed + 1,
    "mixed types share one request",
  );
  assert.equal(requests.at(-1).questions.department.type, "choice");
  assert.equal(requests.at(-1).questions.refund.type, "noul");
  assert.equal(mixedRun.questionMetrics.department.accuracy, 1);
  assert.equal(mixedRun.questionMetrics.refund.accuracy, 1);
  assert.equal(mixedRun.metrics.inputTokens, 100);
  await call("open_evaluation", { evaluationId: mixed.id, tab: "results" });
  await p.locator("#result-question").selectOption("department");
  assert.match(await p.locator(".summary").innerText(), /Multiclass Brier/);
  assert.equal(
    await p
      .getByRole("columnheader", { name: "Confidence", exact: true })
      .count(),
    1,
  );
  assert.equal(
    await p.getByRole("columnheader", { name: "P(yes)", exact: true }).count(),
    0,
  );
  await p.locator(".choice-distribution summary").click();
  assert.match(
    await p.locator(".choice-distribution").innerText(),
    /returns.*0.800/s,
  );
  assert.match(
    await p
      .locator(".run-meta")
      .allTextContents()
      .then((a) => a.join(" ")),
    /100 input/,
  );
  await p.screenshot({
    path: join(choiceVisualDir, "results-desktop.png"),
    fullPage: true,
  });
  await p.setViewportSize({ width: 390, height: 844 });
  await p.screenshot({
    path: join(choiceVisualDir, "results-mobile.png"),
    fullPage: true,
  });
  assert.equal(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  await p.getByRole("link", { name: "Cases", exact: true }).click();
  await p.waitForFunction(
    (page) => document.querySelector(".workspace")?.dataset.page === page,
    "cases",
  );
  await p.locator("#case-question").selectOption("department");
  await p.screenshot({
    path: join(choiceVisualDir, "cases-mobile.png"),
    fullPage: true,
  });
  await p.setViewportSize({ width: 1440, height: 950 });
  responseMode = "partial-choice";
  const partialChoiceAccepted = await call("run_evaluation", {
    evaluationId: mixed.id,
  });
  let partialChoice;
  for (let i = 0; i < 100; i++) {
    partialChoice = await call("get_run", { runId: partialChoiceAccepted.id });
    if (partialChoice.run.status !== "running") break;
    await p.waitForTimeout(50);
  }
  assert.equal(partialChoice.outcome, "partial");
  assert.equal(partialChoice.questionMetrics.refund.accuracy, 1);
  assert.equal(partialChoice.questionMetrics.department.accuracy, null);
  await call("open_evaluation", { evaluationId: mixed.id, tab: "results" });
  await p.locator("#result-question").selectOption("refund");
  await p.locator("[data-trace]").click();
  const trace = await p.locator("#trace pre").innerText();
  const traceJson = JSON.parse(trace);
  assert.match(traceJson.error, /invalid/);
  assert.equal(
    traceJson.answer.error,
    null,
    "selected success retains aggregate request failure",
  );
  assert.equal(traceJson.questionId, "refund");
  assert.equal(
    await p.locator(`[data-run="${mixedAccepted.id}"] .best`).count(),
    1,
    "fully successful comparable run remains best",
  );
  assert.equal(
    await p.locator(`[data-run="${partialChoiceAccepted.id}"] .best`).count(),
    0,
  );
  await p.screenshot({
    path: join(choiceVisualDir, "partial-trace-desktop.png"),
    fullPage: true,
  });
  await p.setViewportSize({ width: 390, height: 844 });
  await p.screenshot({
    path: join(choiceVisualDir, "partial-trace-mobile.png"),
    fullPage: true,
  });
  assert.equal(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  await p.setViewportSize({ width: 1440, height: 950 });
  await p.locator("#result-question").selectOption("department");
  assert.match(await p.locator("tbody").first().innerText(), /Error/);
  assert.equal(await p.locator("tbody tr").first().locator("td").count(), 5);
  const mixedExport = await call("export_run", { runId: mixedAccepted.id });
  assert.equal(mixedExport.run.results[0].answers.department.choice, "returns");
  assert.equal(mixedExport.questionMetrics.department.accuracy, 1);
  const singleChoice = await call("create_evaluation", {
    name: "Choice only",
    questions: [mixed.suite.questions[0]],
    cases: [
      {
        ...mixed.suite.cases[0],
        expectations: {
          department: { value: "returns", rationale: "Reviewed" },
        },
      },
    ],
  });
  responseMode = "complete";
  const singleAccepted = await call("run_evaluation", {
    evaluationId: singleChoice.id,
  });
  for (let i = 0; i < 100; i++) {
    const value = await call("get_run", { runId: singleAccepted.id });
    if (value.run.status !== "running") {
      assert.equal(value.outcome, "complete");
      assert.equal(value.metrics.accuracy, 1);
      break;
    }
    await p.waitForTimeout(50);
  }
  await call("open_evaluation", { evaluationId: mixed.id, tab: "results" });
  console.log("Choice visual evidence:", choiceVisualDir);
  // Large saved history: index pages and selected views stay trace-free; best spans all pages.
  const historyEval = await call("create_evaluation", {
    name: "History read verification",
    questions: mixed.suite.questions,
    cases: mixed.suite.cases,
  });
  const historyStore = new Store(join(dir, "test.sqlite"));
  const historyIds = [];
  let preservedBest;
  try {
    for (let i = 0; i < 35; i++) {
      const id = `history-${String(i).padStart(2, "0")}`;
      historyIds.push(id);
      const probability = i === 0 ? 0.99 : 0.8;
      const c = historyEval.suite.cases[0];
      const raw = {
        refund: { type: "noul", noul: probability },
        department: {
          type: "choice",
          choice: "returns",
          confidence: 0.7,
          probabilities: {
            returns: probability,
            shipping: (1 - probability) / 2,
            billing: (1 - probability) / 2,
          },
        },
      };
      historyStore.saveRun({
        id,
        evaluationId: historyEval.id,
        createdAt: new Date(Date.UTC(2026, 8, 17, 12, 0, i)).toISOString(),
        suite: historyEval.suite,
        datasetKey: "history-fixture",
        status: "complete",
        results: [
          {
            case: c,
            answers: decodeAnswers(historyEval.suite, c, raw),
            latencyMs: 20,
            inputTokens: 100,
            outputTokens: 5,
            cost: 0.0000042,
            error: null,
            request: { ...raw, marker: `lazy-request-${i}`.repeat(1000) },
            response: { ...raw, marker: `lazy-response-${i}`.repeat(1000) },
          },
        ],
      });
    }
    preservedBest = historyStore.snapshot(historyIds[0]);
  } finally {
    historyStore.db.close();
  }
  const historyMetadata = await call("get_evaluation", {
    evaluationId: historyEval.id,
  });
  assert.equal(historyMetadata.runs.length, 20);
  assert.ok(historyMetadata.runCursor);
  assert.equal(historyMetadata.selectedRun, null);
  assert.equal(JSON.stringify(historyMetadata).includes("lazy-request"), false);
  const firstHistory = await call("list_evaluation_runs", {
    evaluationId: historyEval.id,
  });
  const olderHistory = await call("list_evaluation_runs", {
    evaluationId: historyEval.id,
    before: firstHistory.nextCursor,
  });
  assert.equal(firstHistory.runs.length, 20);
  assert.equal(olderHistory.runs.length, 15);
  assert.equal(olderHistory.nextCursor, null);
  assert.equal(
    new Set([...firstHistory.runs, ...olderHistory.runs].map((r) => r.id)).size,
    35,
  );
  assert.equal(
    (
      await call("list_evaluation_runs", {
        evaluationId: historyEval.id,
        limit: 51,
      })
    ).isError,
    true,
  );
  const selectedPayload = await (
    await fetch(`${url}/api/evaluations/${historyEval.id}?includeRun=1`)
  ).json();
  assert.equal(selectedPayload.selectedRun.id, historyIds.at(-1));
  assert.equal("request" in selectedPayload.selectedRun.results[0], false);
  assert.equal("response" in selectedPayload.selectedRun.results[0], false);
  assert.equal(selectedPayload.bestRuns.department.id, historyIds[0]);
  assert.equal(JSON.stringify(selectedPayload).includes("lazy-request"), false);
  let traceFetches = 0;
  const traceCounter = (request) => {
    if (new URL(request.url()).pathname.includes("/traces/")) traceFetches++;
  };
  p.on("request", traceCounter);
  await call("open_evaluation", {
    evaluationId: historyEval.id,
    tab: "results",
  });
  await p.locator("#result-question").selectOption("department");
  assert.equal(
    await p.locator(".history [data-run]").count(),
    21,
    "20 summaries plus best outside page",
  );
  assert.equal(
    await p.locator(`[data-run="${historyIds[0]}"] .best`).count(),
    1,
  );
  assert.equal(traceFetches, 0);
  await p.getByRole("link", { name: "Runs", exact: true }).click();
  await p.waitForFunction(
    () => document.querySelector(".workspace")?.dataset.page === "runs",
  );
  const historyVisualDir = mkdtempSync(join(tmpdir(), "jevals-history-"));
  await p.screenshot({
    path: join(historyVisualDir, "history-desktop.png"),
    fullPage: true,
  });
  await p.setViewportSize({ width: 390, height: 844 });
  await p.screenshot({
    path: join(historyVisualDir, "history-mobile.png"),
    fullPage: true,
  });
  assert.equal(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  await p.setViewportSize({ width: 1440, height: 950 });
  await p.locator(`[data-run="${historyIds[0]}"]`).click();
  await p.waitForURL(`**/results?run=${historyIds[0]}`);
  assert.equal(await p.locator(".choice-distribution").count(), 1);
  assert.match(
    await p.locator(".results-panel tbody").last().innerText(),
    /returns/,
  );
  assert.equal(traceFetches, 0, "selecting an older run does not load traces");
  await p.locator("[data-trace]").click();
  await p.waitForSelector("#trace pre");
  assert.match(await p.locator("#trace pre").innerText(), /lazy-request-0/);
  assert.equal(traceFetches, 1);
  await p.getByRole("link", { name: "Runs", exact: true }).click();
  await p.waitForFunction(
    () => document.querySelector(".workspace")?.dataset.page === "runs",
  );
  await p.getByRole("button", { name: "Load older runs", exact: true }).click();
  await p.waitForFunction(
    () => document.querySelectorAll(".history [data-run]").length === 35,
  );
  assert.equal(await p.locator("#load-older-runs").count(), 0);
  assert.equal(
    await p
      .locator("#history-title")
      .evaluate((el) => document.activeElement === el),
    true,
  );
  assert.equal(traceFetches, 1, "loading history does not re-fetch traces");
  const historyExport = await call("export_run", { runId: historyIds[0] });
  assert.deepEqual(
    historyExport.run,
    preservedBest,
    "raw snapshot and export are preserved",
  );
  await p.getByRole("link", { name: "Results", exact: true }).click();
  await p.waitForFunction(
    () => document.querySelector(".workspace")?.dataset.page === "results",
  );
  let enteredTrace, releaseTrace;
  const traceEntered = new Promise((resolve) => (enteredTrace = resolve));
  const traceGate = new Promise((resolve) => (releaseTrace = resolve));
  const delayedTracePath = `/api/runs/${historyIds[0]}/traces/${encodeURIComponent(historyEval.suite.cases[0].id)}`;
  const traceMatcher = (uri) => uri.pathname === delayedTracePath;
  await p.route(traceMatcher, async (route) => {
    enteredTrace();
    await traceGate;
    await route.continue();
  });
  await p.locator("[data-trace]").click();
  await traceEntered;
  await p.getByRole("link", { name: "Runs", exact: true }).click();
  await p.waitForFunction(
    () => document.querySelector(".workspace")?.dataset.page === "runs",
  );
  await p.locator(`[data-run="${historyIds.at(-1)}"]`).click();
  await p.waitForURL(`**/results?run=${historyIds.at(-1)}`);
  releaseTrace();
  await p.waitForTimeout(100);
  assert.equal(
    await p.locator("#trace pre").count(),
    0,
    "late traces cannot appear in another selected run",
  );
  await p.unroute(traceMatcher);
  p.off("request", traceCounter);
  await p.reload();
  await p.waitForSelector("#result-question");
  assert.ok(p.url().endsWith(`?run=${historyIds.at(-1)}`));
  const wrongRun = await fetch(
    `${url}/api/evaluations/${historyEval.id}?includeRun=1&run=${mixedAccepted.id}`,
  );
  assert.equal(
    wrongRun.status,
    404,
    "cross-Jeval references cannot select another history",
  );
  console.log("Bounded history visual evidence:", historyVisualDir);
  const scored = await call("create_evaluation", {
    name: "Simulated all-primitives bug triage",
    model: "jev-1.13.0",
    questions: [
      {
        id: "refund",
        name: "Refund?",
        type: "noul",
        instructions: "Is a refund requested?",
        yes: "Requested",
        no: "Not requested",
        threshold: 0.5,
      },
      {
        id: "department",
        name: "Department",
        type: "choice",
        instructions: "Pick a team",
        criteria: { returns: "Returns", shipping: "Shipping" },
      },
      {
        id: "severity",
        name: "Severity",
        type: "score",
        instructions: "How severe is this bug?",
        criteria: [
          "Cosmetic, functionality unaffected",
          "Degraded, workaround exists",
          "Blocking, no workaround",
        ],
      },
    ],
    cases: [
      {
        id: "bug",
        name: "Bug",
        state: { message: "refund please, export fails but CSV works" },
        expectations: {
          refund: { value: true, rationale: "Refund requested" },
          department: { value: "returns", rationale: "Refund" },
          severity: {
            value: 1,
            tolerance: 0.4,
            rationale: "Workaround exists",
          },
        },
      },
    ],
  });
  await call("open_evaluation", { evaluationId: scored.id, tab: "definition" });
  await p.getByRole("button", { name: "Severity score", exact: true }).click();
  assert.equal(await p.locator("[data-score-level]").count(), 3);
  await p.locator('[data-score-up="2"]').click();
  await p.getByRole("button", { name: "Save changes", exact: true }).click();
  await p.waitForFunction(() =>
    document.querySelector("#notice")?.textContent.includes("Changes saved."),
  );
  const reordered = await call("get_evaluation", { evaluationId: scored.id });
  assert.equal(
    "severity" in reordered.suite.cases[0].expectations,
    false,
    "reordering clears numeric answer keys",
  );
  await call("update_evaluation_definition", {
    evaluationId: scored.id,
    revision: reordered.revision,
    changes: { questions: scored.suite.questions },
  });
  const restoredScore = await call("get_evaluation", {
    evaluationId: scored.id,
  });
  await call("upsert_evaluation_case", {
    evaluationId: scored.id,
    revision: restoredScore.revision,
    case: scored.suite.cases[0],
  });
  const labeledScore = await call("get_evaluation", {
    evaluationId: scored.id,
  });
  const agentQuestion = structuredClone(
    labeledScore.suite.questions.find((q) => q.id === "severity"),
  );
  [agentQuestion.criteria[1], agentQuestion.criteria[2]] = [
    agentQuestion.criteria[2],
    agentQuestion.criteria[1],
  ];
  await call("upsert_evaluation_question", {
    evaluationId: scored.id,
    revision: labeledScore.revision,
    question: agentQuestion,
  });
  const agentReordered = await call("get_evaluation", {
    evaluationId: scored.id,
  });
  assert.equal(
    "severity" in agentReordered.suite.cases[0].expectations,
    false,
    "WebMCP reordering clears numeric keys like browser authoring",
  );
  await call("update_evaluation_definition", {
    evaluationId: scored.id,
    revision: agentReordered.revision,
    changes: { questions: scored.suite.questions },
  });
  const agentRestored = await call("get_evaluation", {
    evaluationId: scored.id,
  });
  await call("upsert_evaluation_case", {
    evaluationId: scored.id,
    revision: agentRestored.revision,
    case: scored.suite.cases[0],
  });
  const scoreAccepted = await call("run_evaluation", {
    evaluationId: scored.id,
  });
  let scoreReport;
  for (let attempt = 0; attempt < 40; attempt++) {
    scoreReport = await call("get_run", { runId: scoreAccepted.id });
    if (scoreReport.run.status !== "running") break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(scoreReport.outcome, "complete");
  assert.ok(
    Math.abs(scoreReport.questionMetrics.severity.meanAbsoluteError - 0.3) <
      1e-9,
  );
  assert.equal(scoreReport.questionMetrics.severity.accuracy, 1);
  assert.equal(Object.keys(requests.at(-1).questions).length, 3);
  await call("open_evaluation", { evaluationId: scored.id, tab: "results" });
  await p.locator("#result-question").selectOption("severity");
  assert.match(
    await p.locator(".results-panel").innerText(),
    /Mean absolute error/,
  );
  assert.match(
    await p.locator(".results-panel").innerText(),
    /Within tolerance/,
  );
  const scoreVisualDir = mkdtempSync(join(tmpdir(), "jevals-score-"));
  await p.screenshot({
    path: join(scoreVisualDir, "score-desktop.png"),
    fullPage: true,
  });
  await p.setViewportSize({ width: 390, height: 844 });
  await p.screenshot({
    path: join(scoreVisualDir, "score-mobile.png"),
    fullPage: true,
  });
  assert.equal(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  console.log("Score visual evidence:", scoreVisualDir);
  assert.deepEqual(errors, []);
  console.log(
    "Native WebMCP + browser checks passed: 18 registered tools, create/edit cases, revision conflicts, unsaved-draft protection/navigation, run/trace/export, history deep links/reload, home search, UI creation, delayed-save/agent-read reconciliation, draft saves, desktop/mobile overflow. Simulated provider, isolated DB.",
  );
} finally {
  await browser?.close();
  child.kill();
  await new Promise((r) => child.once("exit", r));
  provider.close();
  rmSync(dir, { recursive: true, force: true });
}

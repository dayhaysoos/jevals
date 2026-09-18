import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { checkNode, options } from "../bin/jevals.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "jevals-package-"));
const install = join(dir, "install"),
  workspace = join(dir, "workspace");
mkdirSync(install);
mkdirSync(workspace);
let child,
  logs = "",
  providerCalls = 0,
  fail = false;
const provider = createServer((req, res) => {
  let body = "";
  req.on("data", (data) => (body += data));
  req.on("end", () => {
    providerCalls++;
    const request = JSON.parse(body);
    assert.deepEqual(Object.keys(request.questions).sort(), [
      "format",
      "quality",
      "sandwich",
    ]);
    res.setHeader("content-type", "application/json");
    if (fail) {
      res.writeHead(401);
      res.end(JSON.stringify({ message: "Simulated authentication failure" }));
      return;
    }
    res.end(
      JSON.stringify({
        model: "jev-1.13.0",
        answers: {
          sandwich: { type: "noul", noul: 0.9 },
          format: {
            type: "choice",
            choice: "split_roll",
            confidence: 0.9,
            probabilities: { split_roll: 0.9, other: 0.1 },
          },
          quality: {
            type: "score",
            score: 1,
            confidence: 1,
            probabilities: { 0: 0, 1: 1 },
          },
        },
        usage: { input_tokens: 40, output_tokens: 6 },
      }),
    );
  });
});
const env = { ...process.env };
for (const key of [
  "TYPESAFE_API_KEY",
  "TYPESAFE_BASE_URL",
  "JEVALS_DB",
  "PORT",
  "JEVALS_SERVE_BUILD",
  "NODE_PATH",
])
  delete env[key];
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const cliRun = (args) =>
  execFileSync(
    process.execPath,
    [join(install, "node_modules/jevals/bin/jevals.js"), ...args],
    { cwd: install, env, encoding: "utf8" },
  );
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function stop() {
  if (!child || child.exitCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  await exited;
}
async function freePort() {
  const server = createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  await new Promise((r) => server.close(r));
  return port;
}
async function start(port) {
  logs = "";
  child = spawn(
    process.execPath,
    [
      join(install, "node_modules/jevals/bin/jevals.js"),
      "--dir",
      workspace,
      "--port",
      String(port),
      "--no-open",
    ],
    { cwd: install, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stdout.on("data", (d) => (logs += d));
  child.stderr.on("data", (d) => (logs += d));
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw Error("Packed CLI exited: " + logs);
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/evaluations`)).ok) return;
    } catch {}
    await delay(50);
  }
  throw Error("Packed CLI did not start: " + logs);
}
try {
  assert.throws(() => checkNode("20.0.0"), /22.13/);
  assert.throws(() => checkNode("22.12.0"), /22.13/);
  checkNode("22.13.0");
  assert.throws(() => options(["--port", "NaN"]), /Port/);
  assert.throws(() => options(["--db"]), /value/);
  const packedOutput = execFileSync(
    npm,
    ["pack", "--json", "--pack-destination", dir],
    { cwd: root, env, encoding: "utf8" },
  );
  const [pack] = JSON.parse(packedOutput.slice(packedOutput.indexOf("[\n")));
  const paths = pack.files.map((f) => f.path);
  assert.ok(
    paths.includes("bin/jevals.js") &&
      paths.includes("lib/server.js") &&
      paths.includes("dist/index.html"),
  );
  assert.ok(
    paths.includes("skills/jevals/SKILL.md") &&
      paths.includes("examples/starter-jevals.json") &&
      paths.includes("LICENSE"),
  );
  assert.ok(paths.some((p) => p.startsWith("dist/fonts/")));
  for (const path of paths)
    assert.equal(
      /(^|\/)(\.env(?:\.|$)|\.data|node_modules|test)(\/|$)|\.(sqlite|db|log|tgz)$/.test(
        path,
      ),
      false,
      `Unexpected package path: ${path}`,
    );
  for (const file of pack.files.filter((f) =>
    /\.(js|json|html|md|yaml)$/.test(f.path),
  )) {
    const contents = readFileSync(join(root, file.path), "utf8");
    assert.equal(
      /\b(?:gh[pousr]_[A-Za-z0-9]{25,}|sk-[A-Za-z0-9]{24,}|AKIA[A-Z0-9]{16})\b/.test(
        contents,
      ),
      false,
      `Potential credential in ${file.path}`,
    );
  }
  writeFileSync(
    join(install, "package.json"),
    JSON.stringify({ private: true }),
  );
  execFileSync(
    npm,
    ["install", "--omit=dev", "--ignore-scripts", join(dir, pack.filename)],
    { cwd: install, env, stdio: "pipe" },
  );
  assert.equal(existsSync(join(install, "node_modules/tsx")), false);
  assert.equal(existsSync(join(install, "node_modules/vite")), false);
  assert.match(cliRun(["--help"]), /seed/);
  assert.match(
    execFileSync(npm, ["exec", "--offline", "--", "jevals", "--help"], {
      cwd: install,
      env,
      encoding: "utf8",
    }),
    /Usage: jevals/,
  );
  assert.match(cliRun(["seed", "--dir", workspace]), /Added 7/);
  assert.match(cliRun(["seed", "--dir", workspace]), /Added 0.*skipped 7/);
  const port = await freePort(),
    url = `http://127.0.0.1:${port}`;
  await start(port);
  assert.match(logs, /TYPESAFE_API_KEY/);
  assert.throws(() => cliRun(["seed", "--dir", workspace]), /already using/);
  const alias = join(dir, "database-alias.sqlite");
  symlinkSync(join(workspace, ".data", "jevals.sqlite"), alias);
  assert.throws(
    () => cliRun(["start", "--dir", workspace, "--db", alias, "--no-open"]),
    /already using/,
  );
  const home = await (await fetch(url + "/api/evaluations")).json();
  assert.equal(home.evaluations.length, 7);
  assert.equal(home.configured, false);
  const html = await (await fetch(url + "/")).text();
  const asset = html.match(/src="([^"]+\.js)"/)[1];
  assert.equal((await fetch(url + asset)).status, 200);
  assert.equal((await fetch(url + "/fonts/inter-400.woff2")).status, 200);
  const suite = {
    name: "Package acceptance",
    model: "jev-1.13.0",
    questions: [
      {
        id: "sandwich",
        name: "Sandwich",
        type: "noul",
        instructions: "Does food meet definition?",
        yes: "Split roll with filling",
        no: "Other",
        threshold: 0.5,
      },
      {
        id: "format",
        name: "Format",
        type: "choice",
        instructions: "Classify bread",
        criteria: { split_roll: "Split bread roll", other: "Other" },
      },
      {
        id: "quality",
        name: "Quality",
        type: "score",
        instructions: "Is description specific?",
        criteria: ["Vague", "Specific"],
      },
    ],
    cases: [
      {
        id: "hotdog",
        name: "Hot dog",
        state: "A sausage inside a split bread roll",
        expectations: {
          sandwich: { value: true, rationale: "Filled split roll" },
          format: { value: "split_roll", rationale: "Explicit format" },
          quality: { value: 1, rationale: "Specific description" },
        },
      },
    ],
  };
  const post = (path, body) =>
    fetch(url + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const createdResponse = await post("/api/evaluations", suite);
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  const missing = await post("/api/runs", { evaluationId: created.id });
  assert.equal(missing.status, 400);
  assert.match((await missing.json()).error, /key/i);
  // A second process must explain the occupied port without replacing the first server.
  await assert.rejects(
    new Promise((resolve, reject) => {
      const duplicate = spawn(
        process.execPath,
        [
          join(install, "node_modules/jevals/bin/jevals.js"),
          "--dir",
          join(dir, "occupied-port-workspace"),
          "--port",
          String(port),
          "--no-open",
        ],
        { cwd: install, env },
      );
      let output = "";
      duplicate.stdout.on("data", (d) => (output += d));
      duplicate.stderr.on("data", (d) => (output += d));
      duplicate.on("exit", (code) => {
        if (code === 1 && /already in use/.test(output))
          reject(Error("Expected occupied port"));
        else resolve(output);
      });
    }),
    /Expected occupied port/,
  );
  await stop();
  await new Promise((r) => provider.listen(0, "127.0.0.1", r));
  writeFileSync(
    join(workspace, ".env"),
    `TYPESAFE_API_KEY=simulated-package-key\nTYPESAFE_BASE_URL=http://127.0.0.1:${provider.address().port}\n`,
  );
  await start(port);
  assert.equal(
    (await (await fetch(url + "/api/evaluations")).json()).configured,
    true,
  );
  const accepted = await post("/api/runs", { evaluationId: created.id });
  assert.equal(accepted.status, 202);
  const { id: runId } = await accepted.json();
  async function wait(id) {
    for (let i = 0; i < 100; i++) {
      const r = await (await fetch(url + "/api/runs/" + id)).json();
      if (r.run.status !== "running") return r;
      await delay(30);
    }
    throw Error("Run timeout");
  }
  const result = await wait(runId);
  assert.equal(result.outcome, "complete");
  assert.equal(providerCalls, 1);
  assert.equal(result.questionMetrics.quality.meanAbsoluteError, 0);
  fail = true;
  const failed = await post("/api/runs", { evaluationId: created.id });
  const failedReport = await wait((await failed.json()).id);
  assert.equal(failedReport.outcome, "failed");
  assert.ok(failedReport.run.results[0].error);
  assert.equal(logs.includes("simulated-package-key"), false);
  await stop();
  await start(port);
  const reopened = await (await fetch(url + "/api/runs/" + runId)).json();
  assert.deepEqual(reopened, result);
  assert.equal(
    (await (await fetch(url + "/api/evaluations")).json()).evaluations.length,
    8,
  );
  assert.equal(existsSync(join(install, "node_modules/jevals/.data")), false);
  console.log(
    `Packed install acceptance passed: ${paths.length} allowlisted files, no development dependencies, workspace .env, repeatable seeds, built UI/fonts, missing key/occupied port/provider failure, mixed run, persistent snapshots.`,
  );
} finally {
  await stop();
  if (provider.listening) await new Promise((r) => provider.close(r));
  rmSync(dir, { recursive: true, force: true });
}

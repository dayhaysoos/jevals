#!/usr/bin/env node
import { mkdirSync, realpathSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";

export function checkNode(version) {
  const [major, minor] = version.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 13))
    throw Error(
      `Jevals requires Node.js 22.13 or newer. You have ${version}. Update Node and try again.`,
    );
}
export function options(args) {
  const result = { command: "start", open: true };
  if (args[0] && !args[0].startsWith("-")) result.command = args.shift();
  if (!["start", "seed"].includes(result.command))
    throw Error(`Unknown command: ${result.command}. Use jevals --help.`);
  while (args.length) {
    const arg = args.shift();
    if (arg === "--no-open") result.open = false;
    else if (["--dir", "--db", "--port"].includes(arg)) {
      const value = args.shift();
      if (!value || value.startsWith("--"))
        throw Error(`Provide a value for ${arg}.`);
      result[arg.slice(2)] = value;
    } else throw Error(`Unknown option: ${arg}. Use jevals --help.`);
  }
  if (
    result.port !== undefined &&
    (!/^\d+$/.test(result.port) ||
      Number(result.port) < 1 ||
      Number(result.port) > 65535)
  )
    throw Error("Port must be a whole number from 1 to 65535.");
  return result;
}
async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(`Usage: jevals [start|seed] [options]

  start       Start the local workbench (default)
  seed        Add seven curated examples without overwriting edits

  --dir PATH  Workspace directory (default: current directory)
  --db PATH   Database path (default: <workspace>/.data/jevals.sqlite)
  --port N    Server port (default: PORT or 4317)
  --no-open   Print the URL without opening a browser

Set TYPESAFE_API_KEY in your workspace .env to run evaluations.
User data stays in the workspace and survives package upgrades.`);
    return;
  }
  checkNode(process.versions.node);
  const config = options(process.argv.slice(2));
  const workspace = resolve(config.dir ?? process.cwd());
  mkdirSync(workspace, { recursive: true });
  process.chdir(workspace);
  const { config: dotenv } = await import("dotenv");
  dotenv({ path: resolve(workspace, ".env"), quiet: true });
  process.env.DOTENV_CONFIG_QUIET = "true";
  const database = resolve(
    config.db ?? process.env.JEVALS_DB ?? ".data/jevals.sqlite",
  );
  mkdirSync(dirname(database), { recursive: true });
  process.env.JEVALS_DB = database;
  if (config.command === "seed") {
    const { openDatabase } = await import("../lib/database.js");
    const { seedExamples } = await import("../lib/seed-examples.js");
    const connection = openDatabase(database, "seed");
    const { store } = connection;
    try {
      const result = seedExamples(store);
      console.log(
        `Added ${result.added} example Jevals; skipped ${result.skipped}. Database: ${database}`,
      );
    } finally {
      connection.close();
    }
    return;
  }
  if (config.port !== undefined) process.env.PORT = config.port;
  process.env.JEVALS_SERVE_BUILD = "1";
  console.log(`Workspace: ${workspace}\nDatabase: ${database}`);
  const { server } = await import("../lib/server.js");
  if (config.open) {
    const open = () => {
      const port = server.address()?.port;
      if (!port) return;
      const url = `http://localhost:${port}`;
      const command =
        process.platform === "darwin"
          ? "open"
          : process.platform === "win32"
            ? "rundll32"
            : "xdg-open";
      const args =
        process.platform === "win32"
          ? ["url.dll,FileProtocolHandler", url]
          : [url];
      execFile(command, args, (error) => {
        if (error) console.log(`Open ${url} in your browser.`);
      });
    };
    if (server.listening) open();
    else server.once("listening", open);
  }
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === realpathSync(process.argv[1])
) {
  main().catch((error) => {
    // Messages may originate from filesystem paths; never echo configured credentials.
    const key = process.env.TYPESAFE_API_KEY;
    const message = error instanceof Error ? error.message : "Startup failed.";
    console.error(
      `Jevals: ${key ? message.replaceAll(key, "[redacted]") : message}`,
    );
    process.exitCode = 1;
  });
}

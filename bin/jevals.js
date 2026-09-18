#!/usr/bin/env node
import { realpathSync } from "node:fs";
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
let configuredKey;
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
  const { prepareWorkspace } = await import("../lib/workspace-config.js");
  const workspace = prepareWorkspace(config);
  configuredKey = workspace.apiKey;
  if (config.command === "seed") {
    const { seedWorkspace } = await import("../lib/seed-examples.js");
    const result = seedWorkspace(workspace.database);
    console.log(
      `Added ${result.added} example Jevals; skipped ${result.skipped}. Database: ${workspace.database}`,
    );
    return;
  }
  const { launchWorkbench } = await import("../lib/launch.js");
  const workbench = await launchWorkbench({ ...workspace, built: true });
  if (config.open) {
    const url = workbench.url;
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
  }
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === realpathSync(process.argv[1])
) {
  main().catch((error) => {
    // Messages may originate from filesystem paths; never echo configured credentials.
    const key = configuredKey ?? process.env.TYPESAFE_API_KEY;
    const message = error instanceof Error ? error.message : "Startup failed.";
    console.error(
      `Jevals: ${key ? message.replaceAll(key, "[redacted]") : message}`,
    );
    process.exitCode = 1;
  });
}

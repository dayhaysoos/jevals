import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { config as dotenv } from "dotenv";

/** Resolve configuration without changing the caller's directory or environment. */
export function prepareWorkspace(
  options: { dir?: string; db?: string; port?: string } = {},
) {
  const workspace = resolve(options.dir ?? process.cwd());
  mkdirSync(workspace, { recursive: true });
  const env = { ...process.env };
  const loaded = dotenv({
    path: resolve(workspace, ".env"),
    processEnv: env,
    quiet: true,
  });
  if (loaded.error && (loaded.error as NodeJS.ErrnoException).code !== "ENOENT")
    throw loaded.error;
  return {
    workspace,
    database: resolve(
      workspace,
      options.db ?? env.JEVALS_DB ?? ".data/jevals.sqlite",
    ),
    port: Number(options.port ?? env.PORT ?? 4317),
    apiKey: env.TYPESAFE_API_KEY,
    baseURL: env.TYPESAFE_BASE_URL,
  };
}

import { startWorkbench } from "./server.js";
import { prepareWorkspace } from "./workspace-config.js";

/** Process signals belong to launch adapters, not reusable workbench construction. */
export async function launchWorkbench(
  config: ReturnType<typeof prepareWorkspace> & { built: boolean },
) {
  const workbench = await startWorkbench(config);
  console.log(
    `Workspace: ${config.workspace}\nDatabase: ${config.database}\njevals → ${workbench.url}`,
  );
  if (!config.apiKey)
    console.log(
      "Create and edit without a key. To run evaluations, set TYPESAFE_API_KEY in your workspace .env and restart.",
    );
  const signals = ["SIGINT", "SIGTERM"] as const;
  const close = async () => {
    try {
      await workbench.close();
    } finally {
      for (const signal of signals) process.removeListener(signal, stop);
    }
  };
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(0), 5000);
    deadline.unref();
    void close().then(
      () => {
        clearTimeout(deadline);
        process.exit(0);
      },
      () => process.exit(1),
    );
  };
  for (const signal of signals) process.once(signal, stop);
  return { url: workbench.url, close };
}

import { launchWorkbench } from "./launch.js";
import { prepareWorkspace } from "./workspace-config.js";
try {
  await launchWorkbench({
    ...prepareWorkspace(),
    built: process.env.JEVALS_SERVE_BUILD === "1",
  });
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Could not start Jevals.",
  );
  process.exitCode = 1;
}

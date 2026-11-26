import { logInfo } from "../../lib/common";
import { Config } from "../../lib/config";
import { getGithubRunContext } from "../../lib/github-context";
import { fetchAndAppendSummary } from "../../lib/summary";
import { resolveK8sScopedOwner } from "./scope";

export async function runK8sPostJobHook(): Promise<void> {
  const ctx = getGithubRunContext();

  const scopedOwner = resolveK8sScopedOwner(ctx.owner);
  if (scopedOwner === null) {
    logInfo("Kubernetes post-hook skipped the job summary");
    return;
  }

  const outcome = await fetchAndAppendSummary(
    {
      correlationId: ctx.runnerName,
      environment: "ARC",
      includeTimeRange: false,
      owner: scopedOwner,
    },
    Config.hooks.retry,
  );

  if (outcome.status === "written") {
    logInfo("Summary added to job output");
    return;
  }

  const code = outcome.httpStatus || "";
  logInfo(`Failed to fetch summary (HTTP ${code}) or no content available`);
}

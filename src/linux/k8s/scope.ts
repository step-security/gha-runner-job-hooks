import { logErrorAnnotation, logWarning } from "../../lib/common";
import { Config } from "../../lib/config";
import { getScopedOwner } from "../../lib/github-context";

// The owner the StepSecurity API knows this tenant by: the GitHub owner on
// GitHub.com, "<customer>::<server_name>::<owner>" on GHES and data residency.
// Returns null, after reporting the problem, when STEP_CUSTOMER or
// STEP_SERVER_NAME is missing there; callers skip their requests instead of
// querying another tenant's namespace.
export function resolveK8sScopedOwner(owner: string): string | null {
  try {
    return getScopedOwner(
      owner,
      Config.agent.customer,
      Config.agent.serverName,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logWarning(reason);
    logErrorAnnotation(
      "StepSecurity job hook configuration",
      "STEP_CUSTOMER and STEP_SERVER_NAME must be set on the runner for GitHub Enterprise Server and data residency. Policy Store was not consulted for this job.",
    );
    return null;
  }
}

// Decoded by the Harden-Runner DaemonSet, which splits on "/" and uses the
// first part as the owner for its own Policy Store fetch and status update.
export function buildPrejobPolicyPayload(params: {
  scopedOwner: string;
  repo: string;
  workflow: string;
  runId: string;
  job: string;
}): string {
  return `${params.scopedOwner}/${params.repo}/${params.workflow}/${params.runId}/${params.job}`;
}

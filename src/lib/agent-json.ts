import { logWarning } from "./common";
import { Config } from "./config";
import { readJsonFile, updateJsonFile } from "./files";

function readString(
  source: Record<string, unknown> | null,
  key: string,
): string {
  const value = source?.[key];
  return typeof value === "string" ? value : "";
}

export function detectIsPersistent(agentJsonPath: string): boolean {
  const agent = readJsonFile(agentJsonPath);
  return agent?.is_persistent === true;
}

export function detectIsGithubHosted(agentJsonPath: string): boolean {
  const agent = readJsonFile(agentJsonPath);
  return agent?.is_github_hosted === true;
}

export function readCorrelationId(agentJsonPath: string): string {
  return readString(readJsonFile(agentJsonPath), "correlation_id");
}

// ---------------------------------------------------------------------------
// Linux persistent agent — rewrite agent.json in place with this job's context,
// keeping the field set and ordering of the shell hook's `update_agent_json`.
// ---------------------------------------------------------------------------

export function updateLinuxAgentJsonForJob(
  agentJsonPath: string,
  job: {
    repo: string;
    workflow: string;
    correlationId: string;
    runId: string;
    hasPrejobPolicy: boolean;
  },
): void {
  try {
    updateJsonFile(agentJsonPath, (existing) => ({
      customer: readString(existing, "customer"),
      runner_work_directory: readString(existing, "runner_work_directory"),
      working_directory: readString(existing, "working_directory"),
      api_key: readString(existing, "api_key"),
      is_persistent: existing.is_persistent === true,
      api_url: readString(existing, "api_url") || Config.api.baseUrl,
      telemetry_url:
        readString(existing, "telemetry_url") || Config.api.telemetryUrl,
      repo: job.repo,
      workflow: job.workflow,
      correlation_id: job.correlationId,
      run_id: job.runId,
      has_prejob_policy: job.hasPrejobPolicy,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logWarning(`Updating ${agentJsonPath} failed: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Custom-VM agents (Linux & Windows GitHub-hosted) — the baked image ships
// agent.json with PLACEHOLDER_* tokens that the pre-hook fills in with the
// job context. The Windows flow also restores them in the post-hook.
// ---------------------------------------------------------------------------

type AgentPlaceholderValues = {
  correlationId: string;
  repo: string;
  runId: string;
};

export function fillAgentPlaceholders(
  agentJsonPath: string,
  values: AgentPlaceholderValues,
): void {
  updateJsonFile(agentJsonPath, (agent) => ({
    ...agent,
    correlation_id: values.correlationId,
    repo: values.repo,
    run_id: values.runId,
  }));
}

export function resetAgentPlaceholders(agentJsonPath: string): void {
  updateJsonFile(agentJsonPath, (agent) => ({
    ...agent,
    correlation_id: "PLACEHOLDER_CORRELATION_ID",
    repo: "PLACEHOLDER_REPO",
    run_id: "PLACEHOLDER_RUN_ID",
  }));
}

import { randomUUID } from "crypto";

import {
  logInfo,
  logWarning,
  requireEchoCommand,
  waitForFile,
} from "../lib/common";
import { Config } from "../lib/config";
import { readCorrelationId } from "../lib/agent-json";
import {
  AGENT_LOG_GROUP,
  printFileGroup,
  printFileRaw,
  writeJsonFile,
} from "../lib/files";
import {
  getGithubRunContext,
  GithubRunContext,
  isGHES,
} from "../lib/github-context";
import { emitLinuxMarker } from "../lib/markers";
import {
  fetchPolicyStoreConfig,
  handleBlockedRunPolicyEvaluation,
  PolicyStoreConfig,
} from "../lib/policy";
import { fetchAndAppendSummary } from "../lib/summary";
import { AgentKind, installAgent, startAgent } from "./install";
import { isCodeBuild } from "./runtime";
import { writePostEvent } from "./service";
import { logLinuxSummaryOutcome } from "./vm";

// ---------------------------------------------------------------------------
// Linux hooks for ephemeral GHES / CodeBuild VMs, where the hooks own the agent
// lifecycle (like harden-runner does). The pre-hook installs the agent, writes
// agent.json with the job context and the policy-store policy, and starts it;
// the post-hook signals job end and, outside GHES, publishes the job summary.
// CodeBuild always runs agent bravo, which only observes echo markers.
// ---------------------------------------------------------------------------

export async function runManagedPreHook(): Promise<void> {
  const ctx = getGithubRunContext();
  const kind: AgentKind = isCodeBuild() ? "bravo" : "default";

  if (!hasRequiredInputs()) {
    return;
  }

  const correlationId = randomUUID();
  logInfo(
    `Generated job correlationId for self-hosted agent: ${correlationId}`,
  );

  // Fetch the policy here so the agent starts with its endpoints pre-filled.
  logInfo("PRE-JOB HOOK: Checking for policy from policy store...");
  const result = await fetchPolicyStoreConfig({
    owner: scopedOwner(ctx.owner),
    repo: ctx.repo,
    workflow: ctx.workflow,
    runId: ctx.runId,
    correlationId,
    apiKey: Config.agent.apiKey,
  });
  handleBlockedRunPolicyEvaluation(result.runPolicyEvaluation);

  const policy = result.status === "found" ? result.config : null;
  if (policy) {
    logInfo(`Policy found: ${policy.policyName}`);
  } else {
    logInfo("No policy configured from policy store");
  }

  logInfo(`Installing ${kind} agent...`);
  if (!(await installAgent(kind))) {
    return;
  }

  writeAgentJson(ctx, correlationId, policy);

  logInfo("Starting agent...");
  startAgent(kind);

  logInfo(`Waiting for ${Config.linux.files.agentStatus}...`);
  const ready = await waitForFile(Config.linux.files.agentStatus, 30, 300);
  if (ready) {
    logInfo("Agent initialized successfully");
    printFileRaw(Config.linux.files.agentStatus);
  } else {
    logWarning("Agent initialization timed out");
    printFileGroup(Config.linux.files.agentLog, AGENT_LOG_GROUP);
  }

  printInsightsUrl(ctx);

  logInfo("PRE-JOB HOOK: completed successfully");
}

export async function runManagedPostHook(): Promise<void> {
  logInfo("Signaling job completion to agent...");
  if (isCodeBuild()) {
    // Agent bravo does not watch post_event.json; it observes the echo marker.
    emitLinuxMarker(requireEchoCommand(), "step_policy_jobend");
  } else {
    writePostEvent();
  }

  logInfo("Waiting for agent to finalize monitoring data...");
  const finalized = await waitForFile(Config.linux.files.agentDone, 10, 1000);
  if (finalized) {
    logInfo("Agent finalization complete");
  } else {
    logWarning("Timed out waiting for agent finalization");
  }

  printFileGroup(Config.linux.files.agentLog, AGENT_LOG_GROUP);
  printFileGroup(
    Config.linux.files.agentStdout,
    "[StepSecurity] HardenRunner agent stdout",
  );

  // The job summary is not published for GHES.
  if (isGHES()) {
    return;
  }

  const correlationId = readCorrelationId(Config.linux.files.agentJson);
  logInfo(`Found correlation ID from agent.json: ${correlationId}`);

  const outcome = await fetchAndAppendSummary(
    {
      correlationId,
      environment: "SelfHostedVM",
      includeTimeRange: true,
    },
    Config.hooks.retry,
  );
  logLinuxSummaryOutcome(outcome);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hasRequiredInputs(): boolean {
  const { customer, serverName, apiKey } = Config.agent;
  if (!customer || !apiKey) {
    logWarning("customer and api-key are required to install the agent");
    return false;
  }

  if (isGHES() && !serverName) {
    logWarning(
      "server-name is required for GitHub Enterprise Server (GHES)",
    );
    return false;
  }

  return true;
}

// GHES orgs are keyed as "<customer>::<server_name>::<owner>", matching
// harden-runner's getPolicyOwner and the agent's ghesOwner.
function scopedOwner(owner: string): string {
  if (!isGHES()) {
    return owner;
  }

  return `${Config.agent.customer}::${Config.agent.serverName}::${owner}`;
}

// Matches harden-runner's printInfo.
function printInsightsUrl(ctx: GithubRunContext): void {
  logInfo("View security insights and recommended policy at:");
  logInfo(
    `${Config.api.webUrl}/github/${scopedOwner(ctx.owner)}/${ctx.repo}/actions/runs/${ctx.runId}`,
  );
}

function writeAgentJson(
  ctx: GithubRunContext,
  correlationId: string,
  policy: PolicyStoreConfig | null,
): void {
  const { customer, serverName, apiKey } = Config.agent;
  writeJsonFile(Config.linux.files.agentJson, {
    customer,
    ...(isGHES() ? { server_name: serverName, is_ghes: true } : {}),
    repo: `${scopedOwner(ctx.owner)}/${ctx.repo}`,
    workflow: ctx.workflow,
    run_id: ctx.runId,
    correlation_id: correlationId,
    working_directory: ctx.workspace,
    api_url: Config.api.baseUrl,
    telemetry_url: Config.api.telemetryUrl,
    api_key: apiKey,
    is_github_hosted: false,
    is_persistent: false,
    ...(policy
      ? {
          allowed_endpoints: withGHESServerEndpoint(policy.allowedEndpoints),
          denied_endpoints: policy.deniedEndpoints,
          egress_policy: policy.egressPolicy,
        }
      : {}),
  });
}

// Keep the GHES server reachable when the policy restricts egress, matching
// harden-runner's includeGHESServerEndpoint.
function withGHESServerEndpoint(allowedEndpoints: string): string {
  const serverUrl = process.env.GITHUB_SERVER_URL || "";
  if (!isGHES() || !allowedEndpoints.trim() || !serverUrl) {
    return allowedEndpoints;
  }

  const endpoint = `${new URL(serverUrl).hostname}:*`;
  if (allowedEndpoints.split(/\s+/).includes(endpoint)) {
    return allowedEndpoints;
  }

  return `${allowedEndpoints.trim()} ${endpoint}`;
}

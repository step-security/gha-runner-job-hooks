import * as fs from "fs";
import * as os from "os";
import { randomUUID } from "crypto";

import {
  logInfo,
  logWarning,
  requireEchoCommand,
  sleep,
  waitForFile,
} from "../lib/common";
import { Config } from "../lib/config";
import { toBase64Utf8 } from "../lib/encoding";
import { fillAgentPlaceholders, readCorrelationId } from "../lib/agent-json";
import { AGENT_LOG_GROUP, printFileGroup, printFileRaw } from "../lib/files";
import { getGithubRunContext } from "../lib/github-context";
import { emitLinuxMarker } from "../lib/markers";
import { fetchWorkflowPolicyCheck } from "../lib/policy";
import { fetchAndAppendSummary, SummaryOutcome } from "../lib/summary";
import { startAgentService } from "./service";

// ---------------------------------------------------------------------------
// Linux GitHub-hosted custom-VM hooks. The agent is baked into a custom image
// with agent.json placeholders (is_github_hosted: true); the pre-hook fills in
// the job context, starts the service, and applies policy, while the post-hook
// signals completion via post_event.json and publishes the job summary.
// ---------------------------------------------------------------------------

export async function runCustomVmPreHook(): Promise<void> {
  const ctx = getGithubRunContext();

  const correlationId = randomUUID();
  logInfo(`Step Security Job Correlation ID: ${correlationId}`);

  // Fill the agent.json placeholders baked into the custom image, then start
  // the agent service on demand for this job.
  fillAgentPlaceholders(Config.linux.files.agentJson, {
    correlationId,
    repo: ctx.githubRepository,
    runId: ctx.runId,
  });

  logInfo("Starting agent service...");
  startAgentService();

  logInfo("Waiting for agent to initialize...");
  const initialized = await waitForFile(Config.linux.files.agentStatus, 30, 300);
  if (initialized) {
    logInfo("Agent initialized successfully");
    printFileRaw(Config.linux.files.agentStatus);
  } else {
    logInfo("WARNING: Agent initialization timed out");
    if (fs.existsSync(Config.linux.files.agentLog)) {
      logInfo("Agent log:");
      printFileRaw(Config.linux.files.agentLog);
    }
  }

  logInfo("PRE-JOB HOOK: Checking for policy from Policy Store...");
  const { hasPolicy } = await fetchWorkflowPolicyCheck(
    {
      owner: ctx.owner,
      repo: ctx.repo,
      workflow: ctx.workflow,
      runId: ctx.runId,
      correlationId: ctx.runnerName,
    },
    // curl --connect-timeout 5 --retry 3 --retry-delay 1
    { timeoutMs: 5000, maxAttempts: 4, retryDelayMs: 1000 },
  );

  const echoCommand = requireEchoCommand();
  logInfo(`echo command: ${echoCommand}`);

  if (hasPolicy) {
    logInfo("Policy found, applying policy...");
    const encoded = toBase64Utf8(
      `${ctx.githubRepository}/${ctx.workflow}/${ctx.runId}`,
    );
    emitLinuxMarker(echoCommand, `step_policy_prejob_${encoded}`);
    await sleep(3000);
  } else {
    logInfo("No policy configured from Policy Store");
  }

  logInfo("PRE-JOB HOOK: Completed successfully");
}

export async function runCustomVmPostHook(): Promise<void> {
  const ctx = getGithubRunContext();

  let correlationId = readCorrelationId(Config.linux.files.agentJson);
  if (!correlationId) {
    logInfo("WARNING: Could not read correlation ID from agent.json");
    correlationId = os.hostname();
  }

  logInfo("POST-JOB HOOK: Finalizing job monitoring...");

  logInfo("Signaling job completion to agent...");
  writePostEvent();
  logInfo("Post event signal sent");

  logInfo("Waiting for agent to finalize monitoring data...");
  const finalized = await waitForFile(Config.linux.files.agentDone, 10, 1000);
  if (finalized) {
    logInfo("Agent finalization complete");
  } else {
    logInfo("WARNING: Timed out waiting for agent finalization");
  }

  printFileGroup(Config.linux.files.agentLog, AGENT_LOG_GROUP);

  logInfo("Fetching security summary...");
  const outcome = await fetchAndAppendSummary(
    {
      correlationId,
      environment: "GitHubHostedCustomVM",
      includeTimeRange: false,
    },
    // curl --connect-timeout 5 --retry 3 --retry-delay 1
    { timeoutMs: 5000, maxAttempts: 4, retryDelayMs: 1000 },
  );
  logSummaryOutcome(outcome);

  logInfo("POST-JOB HOOK: Completed successfully");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writePostEvent(): void {
  try {
    fs.writeFileSync(Config.linux.files.postEvent, '{"event":"post"}\n', "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logWarning(`Writing ${Config.linux.files.postEvent} failed: ${message}`);
  }
}

function logSummaryOutcome(outcome: SummaryOutcome): void {
  if (outcome.status === "written") {
    logInfo("Security summary added to job output");
    return;
  }

  const code = outcome.httpStatus || "";
  logInfo(`Failed to fetch summary (HTTP ${code}) or no content available`);
}

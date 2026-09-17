import * as fs from "fs";
import { randomUUID } from "crypto";

import { logInfo, runCommand, waitForFile } from "../lib/common";
import { Config } from "../lib/config";
import { toBase64Utf8 } from "../lib/encoding";
import { printFileRaw, removeFileIfExists, removeStaleFiles } from "../lib/files";
import { getGithubRunContext } from "../lib/github-context";
import {
  fillAgentPlaceholders,
  readCorrelationId,
  resetAgentPlaceholders,
} from "../lib/agent-json";
import { emitWindowsMarker } from "../lib/markers";
import {
  fetchWorkflowPolicyCheck,
  handleBlockedRunPolicyEvaluation,
} from "../lib/policy";
import { fetchAndAppendSummary, SummaryOutcome } from "../lib/summary";
import { startAgentService, stopAgentService } from "./service";

const READY_TIMEOUT_SECONDS = 60;

export async function runGithubHostedPreHook(): Promise<void> {
  const ctx = getGithubRunContext();

  logInfo("PRE-JOB HOOK: Configuring agent for this job...");

  const correlationId = randomUUID();

  // Fill the agent.json placeholders baked into the custom image, then start
  // the agent service on demand for this job.
  fillAgentPlaceholders(Config.windows.files.agentJson, {
    correlationId,
    repo: ctx.githubRepository,
    runId: ctx.runId,
  });

  logInfo("Starting agent service...");
  startAgentService();

  logInfo("Waiting for agent to initialize...");
  const initialized = await waitForFile(Config.windows.files.agentStatus, 100, 300);
  if (initialized) {
    logInfo("Agent initialized successfully");
    printFileRaw(Config.windows.files.agentStatus);
  } else {
    logInfo("WARNING: Agent initialization timed out");
    if (fs.existsSync(Config.windows.files.agentLog)) {
      logInfo("Agent log:");
      printFileRaw(Config.windows.files.agentLog);
    }
  }

  logInfo("PRE-JOB HOOK: Checking for policy from Policy Store...");

  // A prior job's ready-file may not have been cleaned up if that job's
  // enforcement timed out (see below) — sweep it now since its correlation
  // ID will never be looked up again.
  removeStaleFiles(Config.windows.root, "prejob_policy_ready_", ".json");

  const { hasPolicy, runPolicyEvaluation } = await fetchWorkflowPolicyCheck(
    {
      owner: ctx.owner,
      repo: ctx.repo,
      workflow: ctx.workflow,
      runId: ctx.runId,
      correlationId,
    },
    // Invoke-RestMethod -TimeoutSec 5 (no retry)
    { timeoutMs: 5000, maxAttempts: 1, retryDelayMs: 1000 },
    { windowsErrorStyle: true },
  );

  handleBlockedRunPolicyEvaluation(runPolicyEvaluation);
  logInfo(`Step Security Job Correlation ID: ${correlationId}`);

  const encoded = toBase64Utf8(
    `${ctx.githubRepository}/${ctx.workflow}/${ctx.runId}|${correlationId}`,
  );
  emitWindowsMarker(`step_policy_prejob_${encoded}`);

  const readyFile = Config.windows.files.ready(correlationId);
  const enforced = await waitForFile(readyFile, READY_TIMEOUT_SECONDS, 1000);
  if (enforced) {
    removeFileIfExists(readyFile);
  }

  if (hasPolicy) {
    logInfo("Policy found, applying policy...");
    if (enforced) {
      logInfo("policy enforced successfully");
    } else {
      logInfo(
        `WARNING: Policy enforcement confirmation timed out after ${READY_TIMEOUT_SECONDS}s; continuing`,
      );
    }
  } else {
    logInfo("No policy configured from Policy Store");
  }

  logInfo("PRE-JOB HOOK: Completed successfully");
}

export async function runGithubHostedPostHook(): Promise<void> {
  const ctx = getGithubRunContext();

  logInfo("POST-JOB HOOK: Finalizing job monitoring...");

  let correlationId = readCorrelationId(Config.windows.files.agentJson);
  if (!correlationId) {
    logInfo("WARNING: Could not read correlation ID from agent.json");
    correlationId = process.env.COMPUTERNAME || "";
  }

  // Run `query user` so the agent can detect the end of the job.
  runCommand(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "query user; exit $LASTEXITCODE",
    ],
    { silent: true },
  );

  logInfo("Waiting for agent to finalize monitoring data...");
  const finalized = await waitForFile(Config.windows.files.agentDone, 10, 1000);
  if (finalized) {
    logInfo("Agent finalization complete");
  } else {
    logInfo("WARNING: Timed out waiting for agent finalization");
  }

  if (fs.existsSync(Config.windows.files.agentLog)) {
    logInfo("Agent log:");
    printFileRaw(Config.windows.files.agentLog);
  }

  logInfo("Fetching security summary...");
  const outcome = await fetchAndAppendSummary(
    {
      correlationId,
      environment: "WindowsGitHubHostedCustomVM",
      includeTimeRange: false,
    },
    // Invoke-WebRequest -TimeoutSec 10 (no retry)
    { timeoutMs: 10000, maxAttempts: 1, retryDelayMs: 1000 },
  );
  logWindowsSummaryOutcome(outcome);

  logInfo("Stopping agent service...");
  stopAgentService();

  // Reset agent.json placeholders so the next job starts clean from the
  // snapshot state.
  resetAgentPlaceholders(Config.windows.files.agentJson);

  removeFileIfExists(Config.windows.files.agentStatus);
  removeFileIfExists(Config.windows.files.agentDone);

  logInfo("POST-JOB HOOK: Completed successfully");
}

function logWindowsSummaryOutcome(outcome: SummaryOutcome): void {
  if (outcome.status === "written") {
    logInfo("Security summary added to job output");
    return;
  }

  if (outcome.status === "empty") {
    logInfo("No summary content available");
    return;
  }

  const detail = outcome.message || `HTTP ${outcome.httpStatus}`;
  logInfo(`Failed to fetch security summary: ${detail}`);
}

import * as fs from "fs";
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
import { getGithubRunContext } from "../lib/github-context";
import {
  readCorrelationId,
  updateLinuxAgentJsonForJob,
} from "../lib/agent-json";
import { emitLinuxMarker } from "../lib/markers";
import {
  fetchWorkflowPolicyCheck,
  handleBlockedRunPolicyEvaluation,
} from "../lib/policy";
import { AGENT_LOG_GROUP, printFileGroup } from "../lib/files";
import { fetchAndAppendSummary, SummaryOutcome } from "../lib/summary";
import {
  agentServiceIsActive,
  removeLinuxJobStateFiles,
  restartAgentService,
  stopAgentService,
} from "./service";

// ---------------------------------------------------------------------------
// Pre-job hooks
// ---------------------------------------------------------------------------

export async function runPersistentPreHook(): Promise<void> {
  const ctx = getGithubRunContext();
  const correlationId = randomUUID();
  let hasPrejobPolicy = false;
  logInfo("PRE-JOB HOOK: Checking for policy from policy store...");

  const { hasPolicy, runPolicyEvaluation } = await fetchWorkflowPolicyCheck(
    {
      owner: ctx.owner,
      repo: ctx.repo,
      workflow: ctx.workflow,
      runId: ctx.runId,
      correlationId,
    },
    Config.hooks.retry,
  );

  handleBlockedRunPolicyEvaluation(runPolicyEvaluation);
  logInfo(
    `Generated job correlationId for self-hosted agent: ${correlationId}`,
  );

  if (hasPolicy) {
    logInfo("Policy found");
    hasPrejobPolicy = true;
  } else {
    logInfo("No policy configured from policy store");
  }

  updateLinuxAgentJsonForJob(Config.linux.files.agentJson, {
    repo: ctx.githubRepository,
    workflow: ctx.workflow,
    correlationId,
    runId: ctx.runId,
    hasPrejobPolicy,
  });

  logInfo(`Starting ${Config.linux.serviceName}...`);
  removeLinuxJobStateFiles();
  restartAgentService();

  logInfo(`Waiting for ${Config.linux.files.agentStatus}...`);
  const ready = await waitForFile(Config.linux.files.agentStatus, 5, 1000);
  if (ready) {
    logInfo("agent.status is available");
  } else {
    logWarning(`${Config.linux.files.agentStatus} did not appear before timeout`);
  }

  logInfo("PRE-JOB HOOK: completed successfully");
}

export async function runEphemeralPreHook(): Promise<void> {
  const ctx = getGithubRunContext();
  const correlationId = randomUUID();

  const echoCommand = requireEchoCommand();
  logInfo(`echo command: ${echoCommand}`);
  emitLinuxMarker(echoCommand, `step_policy_correlationid_${correlationId}`);
  await sleep(1000);

  logInfo("PRE-JOB HOOK: Checking for policy from policy store...");

  const { hasPolicy, runPolicyEvaluation } = await fetchWorkflowPolicyCheck(
    {
      owner: ctx.owner,
      repo: ctx.repo,
      workflow: ctx.workflow,
      runId: ctx.runId,
      correlationId,
    },
    Config.hooks.retry,
  );

  handleBlockedRunPolicyEvaluation(runPolicyEvaluation);
  logInfo(
    `Generated job correlationId for self-hosted agent: ${correlationId}`,
  );

  if (hasPolicy) {
    logInfo("Policy found, applying policy...");
    const encoded = toBase64Utf8(
      `${ctx.githubRepository}/${ctx.workflow}/${ctx.runId}`,
    );
    emitLinuxMarker(echoCommand, `step_policy_prejob_${encoded}`);
    await sleep(3000);
  } else {
    logInfo("No policy configured from policy store");
  }

  logInfo("PRE-JOB HOOK: completed successfully");
}

// ---------------------------------------------------------------------------
// Post-job hooks
// ---------------------------------------------------------------------------

export async function runPersistentPostHook(): Promise<void> {
  logInfo(`Stopping ${Config.linux.serviceName}...`);
  stopAgentService();

  logInfo(`Waiting for ${Config.linux.serviceName} to stop...`);
  let elapsed = 0;
  while (agentServiceIsActive() && elapsed < 10) {
    await sleep(1000);
    elapsed += 1;
  }

  if (agentServiceIsActive()) {
    logWarning(`${Config.linux.serviceName} did not stop within ${elapsed}s`);
  } else {
    logInfo(`${Config.linux.serviceName} stopped`);
  }

  let correlationId = "";
  if (fs.existsSync(Config.linux.files.agentJson)) {
    const found = readCorrelationId(Config.linux.files.agentJson);
    if (found) {
      logInfo(`Found correlation ID from agent.json: ${found}`);
      correlationId = found;
    }
  } else {
    logInfo("agent.json not found");
  }

  const outcome = await fetchAndAppendSummary(
    {
      correlationId,
      environment: "SelfHostedVM",
      includeTimeRange: true,
    },
    Config.hooks.retry,
  );
  logLinuxSummaryOutcome(outcome);

  printFileGroup(Config.linux.files.agentLog, AGENT_LOG_GROUP);

  removeLinuxJobStateFiles();
}

export async function runEphemeralPostHook(): Promise<void> {
  const echoCommand = requireEchoCommand();
  logInfo(`echo command: ${echoCommand}`);
  emitLinuxMarker(echoCommand, "step_policy_jobend");

  let elapsed = 0;
  while (elapsed < 5) {
    if (fs.existsSync(Config.linux.files.agentDone)) {
      break;
    }
    await sleep(1000);
    elapsed += 1;
  }

  let correlationId = "";
  if (fs.existsSync(Config.linux.files.agentDone)) {
    const doneCorrelationId = fs
      .readFileSync(Config.linux.files.agentDone, "utf8")
      .trim();
    if (doneCorrelationId) {
      logInfo(`Found correlation ID: ${doneCorrelationId}`);
      correlationId = doneCorrelationId;
    }
  } else {
    logInfo(`done.json not found after ${elapsed}s`);
  }

  const outcome = await fetchAndAppendSummary(
    {
      correlationId,
      environment: "SelfHostedVM",
      includeTimeRange: true,
    },
    Config.hooks.retry,
  );
  logLinuxSummaryOutcome(outcome);

  printFileGroup(Config.linux.files.agentLog, AGENT_LOG_GROUP);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function logLinuxSummaryOutcome(outcome: SummaryOutcome): void {
  if (outcome.status === "written") {
    logInfo("Summary added to job output");
    return;
  }

  const code = outcome.httpStatus || "";
  logInfo(`Failed to fetch summary (HTTP ${code}) or no content available`);
}

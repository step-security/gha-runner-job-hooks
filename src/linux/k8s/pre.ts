import {
  logInfo,
  logNoticeAnnotation,
  logWarningAnnotation,
  requireEchoCommand,
  sleep,
} from "../../lib/common";
import { Config } from "../../lib/config";
import { toBase64Utf8 } from "../../lib/encoding";
import { getGithubRunContext } from "../../lib/github-context";
import { emitLinuxMarker } from "../../lib/markers";
import {
  fetchWorkflowPolicyCheck,
  fetchWorkflowPolicyStatus,
  handleBlockedRunPolicyEvaluation,
} from "../../lib/policy";
import { buildPrejobPolicyPayload, resolveK8sScopedOwner } from "./scope";

export async function runK8sPreJobHook(): Promise<void> {
  const ctx = getGithubRunContext();
  const correlationId = ctx.runnerName;

  logInfo("PRE-JOB HOOK: Checking for policy from Policy Store...");

  const scopedOwner = resolveK8sScopedOwner(ctx.owner);
  if (scopedOwner === null) {
    logInfo("PRE-JOB HOOK: Skipped, Policy Store owner could not be resolved");
    return;
  }

  const { hasPolicy, shouldSleep, runPolicyEvaluation } =
    await fetchWorkflowPolicyCheck(
    {
      owner: scopedOwner,
      repo: ctx.repo,
      workflow: ctx.workflow,
      runId: ctx.runId,
      correlationId,
    },
    Config.hooks.retry,
  );

  handleBlockedRunPolicyEvaluation(runPolicyEvaluation);

  const echoCommand = requireEchoCommand();
  logInfo(`echo command: ${echoCommand}`);

  if (hasPolicy) {
    logInfo("Policy found, applying policy...");

    const policySignal = buildPolicySignal(
      scopedOwner,
      ctx.repo,
      ctx.workflow,
      ctx.runId,
      ctx.job,
    );
    emitLinuxMarker(echoCommand, policySignal);

    if (shouldSleep) {
      await waitForPolicy(
        scopedOwner,
        ctx.repo,
        correlationId,
        policySignal,
        echoCommand,
        ctx.runId,
        ctx.job,
      );
    }
  } else {
    logInfo("No policy configured from Policy Store");
  }

  logInfo("PRE-JOB HOOK: Completed successfully");
}

// Poll the backend until a block-mode policy is applied (max 10s), re-emitting
// the policy signal on each NOT_APPLIED response.
async function waitForPolicy(
  owner: string,
  repo: string,
  correlationId: string,
  policySignal: string,
  echoCommand: string,
  runId: string,
  job: string,
): Promise<void> {
  const maxPollTimeMs = Config.hooks.k8s.pollTimeoutMs;
  const pollIntervalMs = Config.hooks.k8s.pollIntervalMs;

  logInfo("Egress policy is 'block', waiting for policy to be applied...");

  const startTime = Date.now();

  // Poll for a bounded time, checking at a configurable interval for
  // block-mode policy application before continuing the job.
  while (true) {
    const elapsedMs = Date.now() - startTime;
    const elapsedSeconds = Math.floor(elapsedMs / 1000);
    const maxPollTimeSeconds = Math.floor(maxPollTimeMs / 1000);

    if (elapsedMs >= maxPollTimeMs) {
      logInfo(
        `Timeout waiting for policy status after ${elapsedSeconds}s, continuing...`,
      );
      logWarningAnnotation(
        "StepSecurity egress policy",
        `Block-mode policy not confirmed applied after ${elapsedSeconds}s; early outbound calls may be unfiltered.`,
      );
      return;
    }

    const status = await fetchWorkflowPolicyStatus(
      { owner, repo, correlationId },
      Config.hooks.retry,
    );

    switch (status) {
      case "APPLIED":
        logInfo(
          "StepSecurity block-mode egress policy is active; continuing job execution",
        );
        // Only this branch has confirmed filtering is in effect.
        logNoticeAnnotation(
          "StepSecurity egress policy",
          `StepSecurity egress block mode is active for job '${job}'. Details: ${Config.api.webUrl}/github/${owner}/${repo}/actions/runs/${runId}`,
        );
        return;
      case "NOT_APPLIED":
        logInfo(
          `Policy not yet applied, polling... (${elapsedSeconds}s/${maxPollTimeSeconds}s)`,
        );
        emitLinuxMarker(echoCommand, policySignal);
        await sleep(pollIntervalMs);
        break;
      case "SLEEP":
      default:
        logInfo(
          `Received SLEEP status, falling back to sleep ${Config.hooks.k8s.sleepFallbackMs / 1000}`,
        );
        await sleep(Config.hooks.k8s.sleepFallbackMs);
        return;
    }
  }
}

function buildPolicySignal(
  scopedOwner: string,
  repo: string,
  workflow: string,
  runId: string,
  job: string,
): string {
  const encoded = toBase64Utf8(
    buildPrejobPolicyPayload({ scopedOwner, repo, workflow, runId, job }),
  );
  return `step_policy_prejob_${encoded}`;
}

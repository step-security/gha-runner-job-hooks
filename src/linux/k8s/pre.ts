import { logInfo, requireEchoCommand, sleep } from "../../lib/common";
import { toBase64Utf8 } from "../../lib/encoding";
import { getGithubRunContext } from "../../lib/github-context";
import { emitLinuxMarker } from "../../lib/markers";
import {
  fetchWorkflowPolicyCheck,
  fetchWorkflowPolicyStatus,
  handleBlockedRunPolicyEvaluation,
} from "../../lib/policy";

export async function runK8sPreJobHook(): Promise<void> {
  const ctx = getGithubRunContext();
  const correlationId = ctx.runnerName;

  logInfo("PRE-JOB HOOK: Checking for policy from Policy Store...");

  const { hasPolicy, shouldSleep, runPolicyEvaluation } =
    await fetchWorkflowPolicyCheck(
    {
      owner: ctx.owner,
      repo: ctx.repo,
      workflow: ctx.workflow,
      runId: ctx.runId,
      correlationId,
    },
    // curl --connect-timeout 5 --retry 3 --retry-delay 1
    { timeoutMs: 5000, maxAttempts: 4, retryDelayMs: 1000 },
  );

  handleBlockedRunPolicyEvaluation(runPolicyEvaluation);

  const echoCommand = requireEchoCommand();
  logInfo(`echo command: ${echoCommand}`);

  if (hasPolicy) {
    logInfo("Policy found, applying policy...");

    const policySignal = buildPolicySignal(
      ctx.githubRepository,
      ctx.workflow,
      ctx.runId,
      ctx.job,
    );
    emitLinuxMarker(echoCommand, policySignal);

    if (shouldSleep) {
      await waitForPolicy(
        ctx.owner,
        ctx.repo,
        correlationId,
        policySignal,
        echoCommand,
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
): Promise<void> {
  const maxPollTimeSeconds = 10;
  const pollIntervalMs = 1000;

  logInfo("Egress policy is 'block', waiting for policy to be applied...");

  const startTime = Date.now();

  // Poll for up to 10s, checking once per second for block-mode policy
  // application before continuing the job.
  while (true) {
    const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);

    if (elapsedSeconds >= maxPollTimeSeconds) {
      logInfo(
        `Timeout waiting for policy status after ${elapsedSeconds}s, continuing...`,
      );
      return;
    }

    const status = await fetchWorkflowPolicyStatus(
      { owner, repo, correlationId },
      { timeoutMs: 5000, maxAttempts: 4, retryDelayMs: 1000 }, // curl --connect-timeout 5 --retry 3 --retry-delay 1
    );

    switch (status) {
      case "APPLIED":
        logInfo("Policy applied successfully, continuing execution");
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
        logInfo("Received SLEEP status, falling back to sleep 10");
        await sleep(10_000);
        return;
    }
  }
}

function buildPolicySignal(
  githubRepository: string,
  workflow: string,
  runId: string,
  job: string,
): string {
  const encoded = toBase64Utf8(
    `${githubRepository}/${workflow}/${runId}/${job}`,
  );
  return `step_policy_prejob_${encoded}`;
}

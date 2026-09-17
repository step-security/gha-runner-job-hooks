import { randomUUID } from "crypto";

import { logInfo, waitForFile } from "../lib/common";
import { Config } from "../lib/config";
import { toBase64Utf8 } from "../lib/encoding";
import { removeFileIfExists, removeStaleFiles } from "../lib/files";
import { getGithubRunContext } from "../lib/github-context";
import { emitWindowsMarker } from "../lib/markers";
import {
  fetchWorkflowPolicyCheck,
  handleBlockedRunPolicyEvaluation,
} from "../lib/policy";

const READY_TIMEOUT_SECONDS = 60;

export async function runSelfHostedPreHook(): Promise<void> {
  const ctx = getGithubRunContext();

  logInfo("PRE-JOB HOOK: Checking for policy from Policy Store...");

  // A prior job's ready-file may not have been cleaned up if that job's
  // enforcement timed out (see below) — sweep it now since its correlation
  // ID will never be looked up again.
  removeStaleFiles(Config.windows.root, "prejob_policy_ready_", ".json");

  const correlationId = randomUUID();

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
  logInfo(
    `Generated job correlationId for self-hosted agent: ${correlationId}`,
  );

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
        `WARNING: Block mode policy enforcement timed out after ${READY_TIMEOUT_SECONDS}s; continuing`,
      );
    }
  } else {
    logInfo("No policy configured from Policy Store");
  }

  logInfo("PRE-JOB HOOK: Completed successfully");
}

export async function runSelfHostedPostHook(): Promise<void> {
  logInfo("POST-JOB HOOK: Signalling agent to clean up...");

  removeStaleFiles(Config.windows.root, "postjob_cleanup_done_", ".json");

  const nonce = randomUUID();
  const completionFile = Config.windows.files.cleanupDone(nonce);

  emitWindowsMarker(`step_cleanup_postjob_${nonce}`);

  const done = await waitForFile(completionFile, READY_TIMEOUT_SECONDS, 1000);
  if (done) {
    removeFileIfExists(completionFile);
    logInfo("POST-JOB HOOK: Cleanup completed successfully");
  } else {
    logInfo(
      `POST-JOB HOOK: Cleanup timed out after ${READY_TIMEOUT_SECONDS}s; continuing`,
    );
  }
}

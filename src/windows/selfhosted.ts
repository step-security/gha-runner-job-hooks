import * as fs from "fs";
import { randomUUID } from "crypto";

import { logInfo, waitForFile } from "../lib/common";
import { Config } from "../lib/config";
import { toBase64Utf8 } from "../lib/encoding";
import { removeFileIfExists } from "../lib/files";
import { getGithubRunContext } from "../lib/github-context";
import { emitWindowsMarker } from "../lib/markers";
import { fetchWorkflowPolicyCheck } from "../lib/policy";

const READY_TIMEOUT_SECONDS = 60;

export async function runSelfHostedPreHook(): Promise<void> {
  const ctx = getGithubRunContext();

  logInfo("PRE-JOB HOOK: Checking for policy from Policy Store...");

  const correlationId = randomUUID();
  logInfo(
    `Generated job correlationId for self-hosted agent: ${correlationId}`,
  );

  const { hasPolicy } = await fetchWorkflowPolicyCheck(
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

  removeStaleCleanupFiles();

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

// Remove any leftover `postjob_cleanup_done_*.json` files from a prior job.
function removeStaleCleanupFiles(): void {
  let entries: string[];
  try {
    entries = fs.readdirSync(Config.windows.root);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.startsWith("postjob_cleanup_done_") && entry.endsWith(".json")) {
      removeFileIfExists(`${Config.windows.root}\\${entry}`);
    }
  }
}

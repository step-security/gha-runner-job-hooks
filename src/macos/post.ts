import * as fs from "fs";

import { logInfo, logWarning, waitForFile } from "../lib/common";
import { Config } from "../lib/config";
import { readJsonFile, removeFileIfExists } from "../lib/files";
import { fetchAndAppendSummary, SummaryOutcome } from "../lib/summary";

const JOB_DONE_TIMEOUT_SECONDS = 10;

export async function runMacOSPostJobHook(): Promise<void> {
  logInfo("POST-JOB HOOK: Signalling agent to clean up...");

  fs.mkdirSync(Config.macos.files.policyDataDir, { recursive: true });
  removeFileIfExists(Config.macos.files.agentDone);
  removeFileIfExists(Config.macos.files.postJob);
  fs.writeFileSync(Config.macos.files.postJob, "post", "utf8");

  const done = await waitForFile(
    Config.macos.files.agentDone,
    JOB_DONE_TIMEOUT_SECONDS,
    1000,
  );
  if (done) {
    logInfo("Agent finalization complete");
  } else {
    logWarning(`Timed out waiting for ${Config.macos.files.agentDone}`);
  }

  const correlationId = readString(
    readJsonFile(Config.macos.files.policyConfig),
    "correlation_id",
  );
  const outcome = await fetchAndAppendSummary(
    {
      correlationId,
      environment: "SelfHostedVM",
      includeTimeRange: true,
    },
    Config.hooks.retry,
  );
  logMacOSSummaryOutcome(outcome);

  cleanupJobFiles();

  logInfo("POST-JOB HOOK: Completed successfully");
}

function cleanupJobFiles(): void {
  removeFileIfExists(Config.macos.files.agentDone);
  try {
    fs.rmSync(Config.macos.files.policyDataDir, {
      force: true,
      recursive: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logWarning(
      `Failed to remove ${Config.macos.files.policyDataDir}: ${message}`,
    );
  }
}

function logMacOSSummaryOutcome(outcome: SummaryOutcome): void {
  if (outcome.status === "written") {
    logInfo("Summary added to job output");
    return;
  }

  const code = outcome.httpStatus || "";
  logInfo(`Failed to fetch summary (HTTP ${code}) or no content available`);
}

function readString(
  source: Record<string, unknown> | null,
  key: string,
): string {
  const value = source?.[key];
  return typeof value === "string" ? value : "";
}

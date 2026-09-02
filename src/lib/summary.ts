import * as fs from "fs";

import {
  getWithRetry,
  logErrorAnnotation,
  logInfo,
  RetryOptions,
} from "./common";
import { Config } from "./config";
import { getGithubRunContext } from "./github-context";

export type SummaryOutcome =
  | { status: "written"; httpStatus: number }
  | { status: "empty"; httpStatus: number }
  | { status: "error"; httpStatus: number; message?: string };

// Fetch the job-markdown-summary for this run's correlation id and append it to
// $GITHUB_STEP_SUMMARY. Callers log their own (platform-specific) result line so
// the exact shell/PowerShell wording is preserved.
export async function fetchAndAppendSummary(
  params: {
    correlationId: string;
    environment: string;
    includeTimeRange: boolean;
  },
  retry: RetryOptions,
): Promise<SummaryOutcome> {
  const ctx = getGithubRunContext();

  const summaryUrl = new URL(
    `${Config.api.baseUrl}/github/${ctx.githubRepository}/actions/runs/${ctx.runId}/correlation/${params.correlationId}/job-markdown-summary`,
  );
  summaryUrl.searchParams.append("environment", params.environment);

  if (params.includeTimeRange) {
    summaryUrl.searchParams.append(
      "start_time",
      String(getStartTime(ctx.eventPath)),
    );
    summaryUrl.searchParams.append(
      "end_time",
      String(Math.floor(Date.now() / 1000)),
    );
  }

  logInfo(`Fetching job summary from: ${summaryUrl.toString()}`);

  try {
    const { statusCode, body } = await getWithRetry(summaryUrl, retry);

    if (String(statusCode) === "200" && body) {
      if (ctx.stepSummaryPath) {
        fs.appendFileSync(ctx.stepSummaryPath, body, "utf8");
      }
      annotateBlockedEgress(body);
      return { status: "written", httpStatus: statusCode };
    }

    if (String(statusCode) === "200") {
      return { status: "empty", httpStatus: statusCode };
    }

    return { status: "error", httpStatus: statusCode };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: "error", httpStatus: 0, message };
  }
}

export function appendSummaryMarkdown(markdown: string): void {
  if (!markdown) {
    return;
  }

  const ctx = getGithubRunContext();
  if (!ctx.stepSummaryPath) {
    return;
  }

  fs.appendFileSync(ctx.stepSummaryPath, markdown, "utf8");
}

// Status cells read "❌ Blocked" / "✅ Allowed". Matching the cell, not the word,
// keeps the "block mode" footer link and surrounding prose from triggering it.
const BLOCKED_STATUS_CELL = /\|[^|]*\bblocked\b[^|]*\|/i;

// The rendered markdown is the only signal: job-markdown-summary has no
// structured "was anything blocked" field, so this tracks dashboard copy.
function annotateBlockedEgress(markdown: string): void {
  // Per line, so a cell match cannot straddle a row boundary.
  const blocked = markdown
    .split("\n")
    .some((line) => BLOCKED_STATUS_CELL.test(line));

  if (!blocked) {
    return;
  }

  logErrorAnnotation(
    "StepSecurity blocked egress",
    "Outbound calls were blocked by the egress policy.",
  );
}

// Creation (birth) time of the event file in epoch seconds — the equivalent of
// `stat -c %W "$GITHUB_EVENT_PATH"` used by the shell post-hooks as start_time.
function getStartTime(eventPath: string): number {
  if (!eventPath) {
    return 0;
  }

  try {
    const stats = fs.statSync(eventPath);
    const birthtimeMs = Number(stats.birthtimeMs);
    if (!Number.isFinite(birthtimeMs) || birthtimeMs <= 0) {
      return 0;
    }
    return Math.floor(birthtimeMs / 1000);
  } catch {
    return 0;
  }
}

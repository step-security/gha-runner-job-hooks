import {
  getWithRetry,
  logErrorAnnotation,
  logInfo,
  logWarning,
  RetryOptions,
  terminateRunnerWorker,
} from "./common";
import { Config } from "./config";
import { appendSummaryMarkdown } from "./summary";

export type WorkflowPolicyCheckResult = {
  hasPolicy: boolean;
  shouldSleep: boolean;
  runPolicyEvaluation: RunPolicyEvaluation | null;
};

export type WorkflowPolicyStatus = "APPLIED" | "NOT_APPLIED" | "SLEEP";
export type RunPolicyConclusion = "block" | "proceed";

export type RunPolicyEvaluation = {
  conclusion: RunPolicyConclusion;
  summaryMarkdown?: string;
};

export type WorkflowPolicyCheckParams = {
  owner: string;
  repo: string;
  workflow: string;
  runId: string;
  correlationId: string;
};

// The Linux/ARC shells and the Windows hooks log policy-check failures
// differently. These options keep each variant's output faithful to its
// original script.
export type PolicyCheckLogging = {
  windowsErrorStyle?: boolean;
};

// GET .../actions/policies/workflow-check — returns whether a policy is
// configured for this workflow (and, for ARC, whether the runner should wait
// for it to apply). Unauthenticated, matching the shell hooks.
export async function fetchWorkflowPolicyCheck(
  params: WorkflowPolicyCheckParams,
  retry: RetryOptions,
  logging: PolicyCheckLogging = {},
): Promise<WorkflowPolicyCheckResult> {
  const url = new URL(
    `${Config.api.baseUrl}/github/${params.owner}/${params.repo}/actions/policies/workflow-check`,
  );
  url.searchParams.append("workflow", params.workflow);
  url.searchParams.append("run_id", params.runId);
  url.searchParams.append("correlationId", params.correlationId);
  url.searchParams.append("evaluate_run_policies", "true");

  logInfo(`Policy store request URL: ${url.toString()}`);

  try {
    const { statusCode, body } = await getWithRetry(url, retry);
    if (String(statusCode) !== "200") {
      if (logging.windowsErrorStyle) {
        logInfo(`ERROR: API call failed: HTTP ${statusCode}`);
      } else {
        logInfo(`ERROR: API call failed with status ${statusCode}`);
        logInfo(`Response: ${body}`);
      }
      return {
        hasPolicy: false,
        shouldSleep: false,
        runPolicyEvaluation: null,
      };
    }

    return parseWorkflowPolicyCheckResponse(body);
  } catch (error) {
    const message =
      error instanceof Error && error.message ? error.message : "unknown";
    if (logging.windowsErrorStyle) {
      logInfo(`ERROR: API call failed: ${message}`);
    } else {
      logInfo("ERROR: API call failed with status ");
      logInfo("Response: ");
    }
    return {
      hasPolicy: false,
      shouldSleep: false,
      runPolicyEvaluation: null,
    };
  }
}

// GET .../actions/policies/workflow-policy/status — polled by the ARC pre-hook
// while waiting for a block-mode policy to be applied.
export async function fetchWorkflowPolicyStatus(
  params: {
    owner: string;
    repo: string;
    correlationId: string;
  },
  retry: RetryOptions,
): Promise<WorkflowPolicyStatus> {
  const url = new URL(
    `${Config.api.baseUrl}/github/${params.owner}/${params.repo}/actions/policies/workflow-policy/status`,
  );
  url.searchParams.append("correlation_id", params.correlationId);
  logInfo(`Policy status request URL: ${url.toString()}`);

  try {
    const { statusCode, body } = await getWithRetry(url, retry);
    if (String(statusCode) !== "200") {
      return "SLEEP";
    }

    return parseStatusField(body);
  } catch {
    return "SLEEP";
  }
}

export function handleBlockedRunPolicyEvaluation(
  runPolicyEvaluation: RunPolicyEvaluation | null,
): void {
  if (runPolicyEvaluation?.conclusion !== "block") {
    return;
  }

  if (runPolicyEvaluation.summaryMarkdown) {
    appendSummaryMarkdown(runPolicyEvaluation.summaryMarkdown);
  }

  // Before terminateRunnerWorker(), which kills the worker reading this stdout.
  logErrorAnnotation(
    "StepSecurity workflow run policy",
    "Job cancelled: the workflow run policy concluded block.",
  );

  logWarning(
    "Workflow is being cancelled because workflow run policy concluded with block",
  );

  terminateRunnerWorker();
  process.exit(1);
}

type WorkflowPolicyCheckResponse = {
  has_policy?: unknown;
  should_sleep?: unknown;
  run_policy_evaluation?: unknown;
};

function parseWorkflowPolicyCheckResponse(
  body: string,
): WorkflowPolicyCheckResult {
  try {
    const response = JSON.parse(body) as WorkflowPolicyCheckResponse;
    return {
      hasPolicy: response.has_policy === true,
      shouldSleep: response.should_sleep === true,
      runPolicyEvaluation: parseRunPolicyEvaluation(
        response.run_policy_evaluation,
      ),
    };
  } catch {
    return {
      hasPolicy: false,
      shouldSleep: false,
      runPolicyEvaluation: null,
    };
  }
}

function parseStatusField(body: string): WorkflowPolicyStatus {
  try {
    const response = JSON.parse(body) as { status?: unknown };
    if (response.status === "APPLIED" || response.status === "NOT_APPLIED") {
      return response.status;
    }
  } catch {
    // fall through to SLEEP
  }

  return "SLEEP";
}

function parseRunPolicyEvaluation(value: unknown): RunPolicyEvaluation | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const response = value as Record<string, unknown>;
  if (response.conclusion !== "block" && response.conclusion !== "proceed") {
    return null;
  }

  return {
    conclusion: response.conclusion,
    summaryMarkdown:
      typeof response.summary_markdown === "string" &&
      response.summary_markdown.length > 0
        ? response.summary_markdown
        : undefined,
  };
}

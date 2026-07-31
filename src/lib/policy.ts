import { getWithRetry, logInfo, RetryOptions } from "./common";
import { Config } from "./config";

export type WorkflowPolicyCheckResult = {
  hasPolicy: boolean;
  shouldSleep: boolean;
};

export type WorkflowPolicyStatus = "APPLIED" | "NOT_APPLIED" | "SLEEP";

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

function parseBooleanField(body: string, fieldName: string): boolean {
  try {
    const response = JSON.parse(body) as Record<string, unknown>;
    return response[fieldName] === true;
  } catch {
    return false;
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
      return { hasPolicy: false, shouldSleep: false };
    }

    return {
      hasPolicy: parseBooleanField(body, "has_policy"),
      shouldSleep: parseBooleanField(body, "should_sleep"),
    };
  } catch (error) {
    const message =
      error instanceof Error && error.message ? error.message : "unknown";
    if (logging.windowsErrorStyle) {
      logInfo(`ERROR: API call failed: ${message}`);
    } else {
      logInfo("ERROR: API call failed with status ");
      logInfo("Response: ");
    }
    return { hasPolicy: false, shouldSleep: false };
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

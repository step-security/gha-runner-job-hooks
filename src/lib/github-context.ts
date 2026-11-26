export type GithubRunContext = {
  githubRepository: string;
  owner: string;
  repo: string;
  workflow: string;
  runId: string;
  job: string;
  runnerName: string;
  stepSummaryPath: string;
  eventPath: string;
  workspace: string;
};

// Turn "octo/repo/.github/workflows/build.yml@refs/heads/main" into "build.yml",
// matching the sed expression used by the shell hooks.
function parseWorkflowName(workflowRef: string): string {
  return workflowRef.replace(/.*\/([^@]*)@.*/, "$1");
}

export function getGithubRunContext(): GithubRunContext {
  const githubRepository = process.env.GITHUB_REPOSITORY || "";

  return {
    githubRepository,
    owner: githubRepository.split("/")[0] || "",
    repo: githubRepository.split("/")[1] || "",
    workflow: parseWorkflowName(process.env.GITHUB_WORKFLOW_REF || ""),
    runId: process.env.GITHUB_RUN_ID || "",
    job: process.env.GITHUB_JOB || "",
    runnerName: process.env.RUNNER_NAME || "",
    stepSummaryPath: process.env.GITHUB_STEP_SUMMARY || "",
    eventPath: process.env.GITHUB_EVENT_PATH || "",
    workspace: process.env.GITHUB_WORKSPACE || "",
  };
}

// GHES and data residency orgs are keyed as "<customer>::<server_name>::<owner>",
// matching harden-runner's getPolicyOwner and the agent's ghesOwner. On
// GitHub.com the GitHub owner is returned unchanged. Throws when customer or
// server name is missing on GHES: the bare owner would resolve to another
// tenant's namespace.
export function getScopedOwner(
  owner: string,
  customer: string,
  serverName: string,
): string {
  if (!isGHES()) {
    return owner;
  }

  if (!customer.trim()) {
    throw new Error("STEP_CUSTOMER is required for GitHub Enterprise Server");
  }
  if (!serverName.trim()) {
    throw new Error("STEP_SERVER_NAME is required for GitHub Enterprise Server");
  }

  return `${customer.trim()}::${serverName.trim()}::${owner}`;
}

export function isGHES(
  serverUrl = process.env.GITHUB_SERVER_URL || "https://github.com",
): boolean {
  return serverUrl !== "https://github.com";
}

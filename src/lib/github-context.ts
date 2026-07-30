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
  };
}

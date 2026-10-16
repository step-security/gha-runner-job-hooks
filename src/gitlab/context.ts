export type GitlabRunContext = {
  pipelineId: string;
  jobId: string;
  projectPath: string;
  configPath: string;
  runnerTags: string;
  runnerDescription: string;
  projectDir: string;
};

export function getGitlabRunContext(): GitlabRunContext {
  return {
    pipelineId: process.env.CI_PIPELINE_ID || "",
    jobId: process.env.CI_JOB_ID || "",
    projectPath: process.env.CI_PROJECT_PATH || "",
    configPath: process.env.CI_CONFIG_PATH || "",
    runnerTags: trimRunnerTags(process.env.CI_RUNNER_TAGS || ""),
    runnerDescription: process.env.CI_RUNNER_DESCRIPTION || "",
    projectDir: process.env.CI_PROJECT_DIR || "",
  };
}

// CI_RUNNER_TAGS is rendered bracketed (e.g. ["windows-test"]).
function trimRunnerTags(raw: string): string {
  return raw.replace(/^\[/, "").replace(/\]$/, "");
}

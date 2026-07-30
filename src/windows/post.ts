import { runGithubHostedPostHook } from "./github-hosted";
import { detectWindowsHookMode } from "./runtime";
import { runSelfHostedPostHook } from "./selfhosted";

export async function runWindowsPostJobHook(): Promise<void> {
  if (detectWindowsHookMode() === "github-hosted") {
    await runGithubHostedPostHook();
    return;
  }

  await runSelfHostedPostHook();
}

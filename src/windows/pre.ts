import { runGithubHostedPreHook } from "./github-hosted";
import { detectWindowsHookMode } from "./runtime";
import { runSelfHostedPreHook } from "./selfhosted";

export async function runWindowsPreJobHook(): Promise<void> {
  if (detectWindowsHookMode() === "github-hosted") {
    await runGithubHostedPreHook();
    return;
  }

  await runSelfHostedPreHook();
}

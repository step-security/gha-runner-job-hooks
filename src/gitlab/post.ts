import { exitCleanlyOnUnhandledErrors } from "./guard";
import { runGitlabWindowsPostJobHook } from "./windows/post";
import { logWarning } from "../lib/common";

export async function runGitlabPostJobHook(): Promise<void> {
  exitCleanlyOnUnhandledErrors();
  if (process.platform === "win32") {
    await runGitlabWindowsPostJobHook();
    return;
  }

  logWarning(`Unsupported platform for gitlab provider: ${process.platform}`);
}

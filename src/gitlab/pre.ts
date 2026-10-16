import { parseGitlabHookArgs } from "./args";
import { exitCleanlyOnUnhandledErrors } from "./guard";
import { runGitlabWindowsPreJobHook } from "./windows/pre";
import { logWarning } from "../lib/common";

export async function runGitlabPreJobHook(argv: string[]): Promise<void> {
  exitCleanlyOnUnhandledErrors();
  const args = parseGitlabHookArgs(argv);

  if (process.platform === "win32") {
    await runGitlabWindowsPreJobHook(args);
    return;
  }

  logWarning(`Unsupported platform for gitlab provider: ${process.platform}`);
}

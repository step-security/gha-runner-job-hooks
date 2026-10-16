import { missingRequiredSettings, resolveHookSettings, writeAgentConfig } from "../agent-config";
import { fetchReleaseAsset } from "../agent-release";
import type { HookArgs } from "../args";
import { AgentFiles, WindowsAgentServiceConfig } from "../config";
import { getGitlabRunContext } from "../context";
import { logError, logInfo, logWarning } from "../../lib/common";
import { clearPreviousJobFiles, ensureAgentRoot, installAgent, waitForAgentReady } from "./agent";
import { ensureAndStartService, stopServiceIfRunning } from "./service";

// Failures log and return; the job still runs, without the agent.
export async function runGitlabWindowsPreJobHook(args: HookArgs = {}): Promise<void> {
  logInfo("Hook phase=pre platform=windows provider=gitlab");

  const settings = resolveHookSettings(args);
  const missing = missingRequiredSettings(settings);
  if (missing.length > 0) {
    logError(`Missing required hook settings: ${missing.join(", ")}`);
    return;
  }

  const asset = await fetchReleaseAsset(settings.apiUrl, settings.version);
  if (!asset) {
    return;
  }

  ensureAgentRoot();

  // A running service locks the binary and agent.json.
  if (!(await stopServiceIfRunning())) {
    logWarning(
      `GitlabAgent service=stop-failed name=${WindowsAgentServiceConfig.name} action=left-running`,
    );
    return;
  }

  clearPreviousJobFiles();

  if (!(await installAgent(asset))) {
    return;
  }

  writeAgentConfig(getGitlabRunContext(), AgentFiles.agentJson, settings);

  if (await ensureAndStartService()) {
    await waitForAgentReady();
  } else {
    logWarning(
      `GitlabAgent service=unavailable name=${WindowsAgentServiceConfig.name} action=job-unprotected`,
    );
  }

  logInfo("Hook phase=pre platform=windows provider=gitlab status=completed");
}

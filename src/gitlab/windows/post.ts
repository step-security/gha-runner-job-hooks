import * as fs from "fs";

import { AgentRuntimeConfig } from "../config";
import { logInfo, logWarning } from "../../lib/common";
import { printAgentLogs, removeAgent, waitForDoneFile } from "./agent";
import { deleteService, queryWindowsServiceState, stopService } from "./service";

export async function runGitlabWindowsPostJobHook(): Promise<void> {
  logInfo("Hook phase=post platform=windows provider=gitlab");

  if (!fs.existsSync(AgentRuntimeConfig.windowsRoot)) {
    logInfo(
      `Hook phase=post platform=windows provider=gitlab status=skipped reason=missing-agent-root path=${AgentRuntimeConfig.windowsRoot}`,
    );
    return;
  }

  if (queryWindowsServiceState() === "RUNNING") {
    if (await stopService()) {
      await waitForDoneFile();
    }
  } else {
    logWarning("Hook phase=post platform=windows provider=gitlab status=agent-not-running");
  }

  printAgentLogs();
  deleteService();
  removeAgent();

  logInfo("Hook phase=post platform=windows provider=gitlab status=completed");
}

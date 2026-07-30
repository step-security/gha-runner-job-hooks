import { logCommandFailure, logInfo, runCommand } from "../lib/common";
import { Config } from "../lib/config";
import { removeFileIfExists } from "../lib/files";

export function restartAgentService(): void {
  const result = runCommand("sudo", [
    "systemctl",
    "restart",
    Config.linux.serviceName,
  ]);
  logCommandFailure(`Restarting ${Config.linux.serviceName}`, result);
}

// `systemctl daemon-reload && systemctl start agent` — start the service on
// demand for this job (used by the custom-VM flow).
export function startAgentService(): void {
  logCommandFailure(
    "Reloading systemd",
    runCommand("sudo", ["systemctl", "daemon-reload"]),
  );
  logCommandFailure(
    `Starting ${Config.linux.serviceName}`,
    runCommand("sudo", ["systemctl", "start", Config.linux.serviceName]),
  );
}

export function stopAgentService(): void {
  const result = runCommand("sudo", [
    "systemctl",
    "stop",
    Config.linux.serviceName,
  ]);
  logCommandFailure(`Stopping ${Config.linux.serviceName}`, result);
}

export function agentServiceIsActive(): boolean {
  const result = runCommand(
    "sudo",
    ["systemctl", "is-active", "--quiet", Config.linux.serviceName],
    { silent: true },
  );
  return result.status === 0;
}

// Clear per-job state files (agent.status, done.json, agent.log).
export function removeLinuxJobStateFiles(): void {
  if (removeFileIfExists(Config.linux.files.agentStatus)) {
    logInfo(`Deleted state file: ${Config.linux.files.agentStatus}`);
  }

  if (removeFileIfExists(Config.linux.files.agentDone)) {
    logInfo(`Deleted state file: ${Config.linux.files.agentDone}`);
  }

  if (removeFileIfExists(Config.linux.files.agentLog)) {
    logInfo(`Deleted state file: ${Config.linux.files.agentLog}`);
  }
}

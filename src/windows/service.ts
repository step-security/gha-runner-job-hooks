import { runCommand } from "../lib/common";
import { Config } from "../lib/config";

// `sc.exe start|stop` with output suppressed, matching the shell's `| Out-Null`.
export function startAgentService(): void {
  runCommand("sc.exe", ["start", Config.windows.serviceName], {
    silent: true,
  });
}

export function stopAgentService(): void {
  runCommand("sc.exe", ["stop", Config.windows.serviceName], {
    silent: true,
  });
}

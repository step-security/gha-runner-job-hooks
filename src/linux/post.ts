import { logInfo } from "../lib/common";
import { Config } from "../lib/config";
import { detectIsPersistent } from "../lib/agent-json";
import { runCustomVmPostHook } from "./custom-vm";
import { runK8sPostJobHook } from "./k8s/post";
import { detectLinuxRuntimeMode } from "./runtime";
import { runEphemeralPostHook, runPersistentPostHook } from "./vm";

export async function runLinuxPostJobHook(): Promise<void> {
  const mode = detectLinuxRuntimeMode();

  if (mode === "k8s") {
    await runK8sPostJobHook();
    return;
  }

  // The custom-VM flow runs only when explicitly selected via
  // STEP_HOOK_MODE=custom-vm.
  if (mode === "custom-vm") {
    logInfo("Running custom-vm post-hook");
    await runCustomVmPostHook();
    return;
  }

  if (detectIsPersistent(Config.linux.files.agentJson)) {
    logInfo("Running persistent post-hook");
    await runPersistentPostHook();
    return;
  }

  logInfo("Running ephemeral post-hook");
  await runEphemeralPostHook();
}

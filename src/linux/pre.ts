import { logInfo } from "../lib/common";
import { Config } from "../lib/config";
import { detectIsPersistent } from "../lib/agent-json";
import { runCustomVmPreHook } from "./custom-vm";
import { runK8sPreJobHook } from "./k8s/pre";
import { detectLinuxRuntimeMode } from "./runtime";
import { runEphemeralPreHook, runPersistentPreHook } from "./vm";

export async function runLinuxPreJobHook(): Promise<void> {
  const mode = detectLinuxRuntimeMode();

  if (mode === "k8s") {
    await runK8sPreJobHook();
    return;
  }

  // The custom-VM flow runs only when explicitly selected via
  // STEP_HOOK_MODE=custom-vm.
  if (mode === "custom-vm") {
    logInfo("Running custom-vm pre-hook");
    await runCustomVmPreHook();
    return;
  }

  if (detectIsPersistent(Config.linux.files.agentJson)) {
    logInfo("Running persistent pre-hook");
    await runPersistentPreHook();
    return;
  }

  logInfo("Running ephemeral pre-hook");
  await runEphemeralPreHook();
}

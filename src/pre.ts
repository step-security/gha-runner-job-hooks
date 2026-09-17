#!/usr/bin/env node

import { handleFatalError, logWarning } from "./lib/common";
import { runLinuxPreJobHook } from "./linux/pre";
import { runMacOSPreJobHook } from "./macos/pre";
import { runWindowsPreJobHook } from "./windows/pre";
import { HookVersion } from "./version";

async function main(): Promise<void> {
  console.log("[StepSecurity] pre job-hook"); // marker log
  console.log(`[StepSecurity] JobHook version=${HookVersion}`);

  if (process.platform === "linux") {
    await runLinuxPreJobHook();
    return;
  }

  if (process.platform === "win32") {
    await runWindowsPreJobHook();
    return;
  }

  if (process.platform === "darwin") {
    await runMacOSPreJobHook();
    return;
  }

  logWarning(`Unsupported platform: ${process.platform}`);
}

main().catch((error: unknown) => {
  handleFatalError(error);
});

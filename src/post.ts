#!/usr/bin/env node

import { handleFatalError, logWarning } from "./lib/common";
import { runLinuxPostJobHook } from "./linux/post";
import { runMacOSPostJobHook } from "./macos/post";
import { runWindowsPostJobHook } from "./windows/post";
import { HookVersion } from "./version";

async function main(): Promise<void> {
  console.log("[StepSecurity] post job-hook"); // marker log
  console.log(`[StepSecurity] JobHook version=${HookVersion}`);

  if (process.platform === "linux") {
    await runLinuxPostJobHook();
    return;
  }

  if (process.platform === "win32") {
    await runWindowsPostJobHook();
    return;
  }

  if (process.platform === "darwin") {
    await runMacOSPostJobHook();
    return;
  }

  logWarning(`Unsupported platform: ${process.platform}`);
}

main().catch((error: unknown) => {
  handleFatalError(error);
});

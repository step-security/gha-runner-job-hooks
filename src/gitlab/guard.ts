import { handleFatalError } from "../lib/common";

// A non-zero exit from a job hook fails the GitLab job, so errors raised
// outside the awaited hook chain must also end in a clean exit.
export function exitCleanlyOnUnhandledErrors(): void {
  process.on("uncaughtException", handleFatalError);
  process.on("unhandledRejection", handleFatalError);
}

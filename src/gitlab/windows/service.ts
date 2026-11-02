import * as path from "path";

import { AgentFiles, WindowsAgentServiceConfig } from "../config";
import {
  logCommandFailure,
  logInfo,
  logWarning,
  runCommand,
  waitForCondition,
} from "../../lib/common";

export type WindowsServiceState =
  | "RUNNING"
  | "STOPPED"
  | "START_PENDING"
  | "STOP_PENDING"
  | "PAUSED"
  | "UNKNOWN";

// Win32 error codes returned by sc.exe as its exit code.
const ERROR_ACCESS_DENIED = 5;
const ERROR_SERVICE_ALREADY_RUNNING = 1056;
const ERROR_SERVICE_DOES_NOT_EXIST = 1060;
const ERROR_SERVICE_NOT_ACTIVE = 1062;

// Resolve sc.exe absolutely; PATH is not guaranteed on a runner.
const ScExe = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "sc.exe");

export function windowsServiceExists(): boolean {
  const result = runSc(["query", WindowsAgentServiceConfig.name]);
  if (!result || result.status === null) {
    return false;
  }
  if (result.status === ERROR_SERVICE_DOES_NOT_EXIST) {
    return false;
  }
  if (result.status !== 0) {
    logWarning(
      `GitlabAgent service=query-failed name=${WindowsAgentServiceConfig.name} exit=${result.status}`,
    );
    return false;
  }
  return true;
}

export function queryWindowsServiceState(): WindowsServiceState | null {
  const result = runSc(["query", WindowsAgentServiceConfig.name]);
  if (!result || result.status !== 0) {
    return null;
  }

  // sc.exe prints e.g. "        STATE              : 4  RUNNING"
  const match = /^\s*STATE\s+:\s+\d+\s+(\S+)/m.exec(String(result.stdout || ""));
  if (!match) {
    return null;
  }

  const state = match[1].toUpperCase();
  switch (state) {
    case "RUNNING":
    case "STOPPED":
    case "START_PENDING":
    case "STOP_PENDING":
    case "PAUSED":
      return state as WindowsServiceState;
    default:
      return "UNKNOWN";
  }
}

// Returns true once no running service holds the binary or agent.json.
export async function stopServiceIfRunning(): Promise<boolean> {
  if (!windowsServiceExists()) {
    return true;
  }

  const state = queryWindowsServiceState();
  if (state === "STOPPED") {
    return true;
  }

  return await stopService();
}

// Returns false when the service could not be registered or started.
export async function ensureAndStartService(): Promise<boolean> {
  const ensured = windowsServiceExists() ? reconcileService() : createService();
  if (!ensured) {
    return false;
  }

  return await startService();
}

export async function stopService(): Promise<boolean> {
  logInfo(`GitlabAgent service=stop name=${WindowsAgentServiceConfig.name}`);
  const result = runSc(["stop", WindowsAgentServiceConfig.name]);

  if (result && result.status !== null) {
    if (result.status === ERROR_SERVICE_NOT_ACTIVE || result.status === ERROR_SERVICE_DOES_NOT_EXIST) {
      logInfo(`GitlabAgent service=not-running name=${WindowsAgentServiceConfig.name}`);
      return true;
    }
    if (result.status !== 0) {
      logCommandFailure(`GitlabAgent service=stop name=${WindowsAgentServiceConfig.name}`, result);
      return false;
    }
  } else {
    logCommandFailure(`GitlabAgent service=stop name=${WindowsAgentServiceConfig.name}`, result);
    return false;
  }

  const { matched } = await waitForCondition(() => {
    const state = queryWindowsServiceState();
    return state === "STOPPED" || state === null;
  }, 30, 1000);

  if (!matched) {
    logWarning(`GitlabAgent service=stop-timeout name=${WindowsAgentServiceConfig.name}`);
    return false;
  }

  logInfo(`GitlabAgent service=stopped name=${WindowsAgentServiceConfig.name}`);
  return true;
}

export function deleteService(): boolean {
  logInfo(`GitlabAgent service=delete name=${WindowsAgentServiceConfig.name}`);
  const result = runSc(["delete", WindowsAgentServiceConfig.name]);

  if (!result || (result.status !== 0 && result.status !== ERROR_SERVICE_DOES_NOT_EXIST)) {
    logCommandFailure(`GitlabAgent service=delete name=${WindowsAgentServiceConfig.name}`, result);
    return false;
  }

  return true;
}

// The service starts in System32, so the config path is passed explicitly.
function serviceBinPath(): string {
  return `"${AgentFiles.agentBinary}" -config "${AgentFiles.agentJson}"`;
}

function runSc(args: readonly string[]): ReturnType<typeof runCommand> {
  return runCommand(ScExe, args, { captureOutput: true });
}

function createService(): boolean {
  logInfo(`GitlabAgent service=create name=${WindowsAgentServiceConfig.name}`);

  const result = runSc([
    "create",
    WindowsAgentServiceConfig.name,
    "binPath=",
    serviceBinPath(),
    "DisplayName=",
    WindowsAgentServiceConfig.displayName,
    "start=",
    "demand",
  ]);

  if (!result || result.status !== 0) {
    logCommandFailure(`GitlabAgent service=create name=${WindowsAgentServiceConfig.name}`, result);
    if (result && result.status === ERROR_ACCESS_DENIED) {
      logWarning("GitlabAgent service=create-denied reason=not-elevated");
    }
    return false;
  }

  logCommandFailure(
    `GitlabAgent service=describe name=${WindowsAgentServiceConfig.name}`,
    runSc(["description", WindowsAgentServiceConfig.name, WindowsAgentServiceConfig.description]),
  );

  return true;
}

// Points an existing service at the current binary and args.
function reconcileService(): boolean {
  const result = runSc([
    "config",
    WindowsAgentServiceConfig.name,
    "binPath=",
    serviceBinPath(),
    "start=",
    "demand",
  ]);

  if (!result || result.status !== 0) {
    logCommandFailure(`GitlabAgent service=reconfigure name=${WindowsAgentServiceConfig.name}`, result);
    return false;
  }

  return true;
}

async function startService(): Promise<boolean> {
  logInfo(`GitlabAgent service=start name=${WindowsAgentServiceConfig.name}`);
  const result = runSc(["start", WindowsAgentServiceConfig.name]);

  if (!result || (result.status !== 0 && result.status !== ERROR_SERVICE_ALREADY_RUNNING)) {
    logCommandFailure(`GitlabAgent service=start name=${WindowsAgentServiceConfig.name}`, result);
    if (result && result.status === ERROR_ACCESS_DENIED) {
      logWarning("GitlabAgent service=start-denied reason=not-elevated");
    }
    return false;
  }

  // sc.exe start returns once the request is accepted.
  const { matched } = await waitForCondition(
    () => queryWindowsServiceState() === "RUNNING",
    30,
    1000,
  );

  if (!matched) {
    logWarning(`GitlabAgent service=start-timeout name=${WindowsAgentServiceConfig.name}`);
    // Don't leave a half-started agent behind.
    await stopService();
    return false;
  }

  logInfo(`GitlabAgent service=running name=${WindowsAgentServiceConfig.name}`);
  return true;
}

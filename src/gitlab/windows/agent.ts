import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { ensureVerifiedTarball, isAgentAsset, type ReleaseAsset } from "../agent-release";
import { AgentFiles, AgentRuntimeConfig } from "../config";
import { printFileIfExists } from "../files";
import { removeFileIfExists } from "../../lib/files";
import { logError, logInfo, logWarning, runCommand, waitForCondition } from "../../lib/common";

const AGENT_BINARY_NAME = "agent-gitlab-windows.exe";

// Windows' built-in tar; a GNU tar earlier on PATH (e.g. Git for Windows)
// would read "C:\..." as a remote host.
const TarExe = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");

export function ensureAgentRoot(): void {
  if (!fs.existsSync(AgentRuntimeConfig.windowsRoot)) {
    fs.mkdirSync(AgentRuntimeConfig.windowsRoot, { recursive: true });
  }
}

// Installs the agent binary from a verified release tarball. Returns false
// (after logging) on failure.
export async function installAgent(asset: ReleaseAsset): Promise<boolean> {
  removeStaleTarballs(asset.asset_name);

  const tarballPath = path.join(AgentRuntimeConfig.windowsRoot, asset.asset_name);
  if (!(await ensureVerifiedTarball(asset, tarballPath))) {
    return false;
  }

  const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), "step-gitlab-agent-"));
  try {
    const extract = runCommand(TarExe, ["-xzf", tarballPath, "-C", extractDir]);
    if (!extract || extract.status !== 0) {
      logError(`Extracting ${tarballPath} failed`);
      return false;
    }

    const extractedBinary = path.join(extractDir, AGENT_BINARY_NAME);
    if (!fs.existsSync(extractedBinary)) {
      logError(`${AGENT_BINARY_NAME} not found in ${asset.asset_name}`);
      return false;
    }

    fs.copyFileSync(extractedBinary, AgentFiles.agentBinary);
  } finally {
    fs.rmSync(extractDir, { recursive: true, force: true });
  }

  logInfo(`GitlabAgent status=installed asset=${asset.asset_name} binary=${AgentFiles.agentBinary}`);
  return true;
}

export async function waitForAgentReady(): Promise<void> {
  const startedAt = Date.now();
  const { matched } = await waitForCondition(
    () => fs.existsSync(AgentFiles.agentStatus),
    60,
    300,
  );
  const elapsedMs = Date.now() - startedAt;

  if (!matched) {
    logWarning(`GitlabAgent process=init status=timeout waited_ms=${elapsedMs}`);
    printFileIfExists(AgentFiles.agentLog, { groupTitle: "[StepSecurity] GitLab agent logs" });
    return;
  }

  logInfo(`GitlabAgent process=init status=ready waited_ms=${elapsedMs}`);
}

export async function waitForDoneFile(): Promise<void> {
  const { matched } = await waitForCondition(() => fs.existsSync(AgentFiles.agentDone), 3, 1000);
  if (!matched) {
    logWarning("GitlabAgent shutdown=incomplete reason=no-done-file");
    return;
  }
  logInfo("GitlabAgent shutdown=completed");
}

export function printAgentLogs(): void {
  printFileIfExists(AgentFiles.agentLog, { groupTitle: "[StepSecurity] GitLab agent logs" });
}

// Removes files left by a previous job whose post-hook didn't run.
export function clearPreviousJobFiles(): void {
  for (const filePath of [
    AgentFiles.agentStatus,
    AgentFiles.agentDone,
    AgentFiles.agentLog,
    AgentFiles.daemonLog,
  ]) {
    removeOrWarn(filePath);
  }
}

// Removes the agent binary and per-job files; keeps the release tarball.
export function removeAgent(): void {
  for (const filePath of [
    AgentFiles.agentJson,
    AgentFiles.agentStatus,
    AgentFiles.agentDone,
    AgentFiles.agentLog,
    AgentFiles.daemonLog,
    AgentFiles.agentBinary,
  ]) {
    removeOrWarn(filePath);
  }

  if (!fs.existsSync(AgentFiles.agentBinary)) {
    logInfo(`GitlabAgent status=removed binary=${AgentFiles.agentBinary}`);
  }
}

// Tarballs of other agent versions left from earlier jobs.
function removeStaleTarballs(keepAssetName: string): void {
  for (const entry of fs.readdirSync(AgentRuntimeConfig.windowsRoot)) {
    if (entry !== keepAssetName && isAgentAsset(entry)) {
      if (removeFileIfExists(path.join(AgentRuntimeConfig.windowsRoot, entry))) {
        logInfo(`GitlabAgent tarball=removed-stale name=${entry}`);
      }
    }
  }
}

// Best-effort delete; warns when the file is still there (e.g. locked).
function removeOrWarn(filePath: string): void {
  removeFileIfExists(filePath);
  if (fs.existsSync(filePath)) {
    logWarning(`GitlabAgent status=remove-failed path=${filePath}`);
  }
}

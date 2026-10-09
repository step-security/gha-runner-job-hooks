import * as childProcess from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  getWithRetry,
  httpDownload,
  logCommandFailure,
  logInfo,
  logWarning,
  runCommand,
} from "../lib/common";
import { Config } from "../lib/config";
import { startAgentService } from "./service";

// "default" is the systemd-managed agent; "bravo" runs where systemd is not
// available (CodeBuild) and is started as a detached process instead.
export type AgentKind = "default" | "bravo";

type ReleaseAsset = {
  asset_name: string;
  checksum: string;
  primary_download_url: string;
  fallback_download_url: string;
};

const AGENT_SERVICE_PATH = "/etc/systemd/system/agent.service";
const DOWNLOAD_TIMEOUT_MS = 30000;

// Take the agent tar baked into the agent root, or download and verify the
// latest release from the StepSecurity API, then place the agent binary under
// the agent root. Returns false (after logging) when any step fails.
export async function installAgent(kind: AgentKind): Promise<boolean> {
  // TESTING: remove with installTestBravo below.
  // if (kind === "bravo") {
  //   return installTestBravo();
  // }

  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), "step-agent-"));
  const tarball = Config.agent.baked
    ? findBakedTarball(kind)
    : await downloadAgent(kind, downloadDir);
  if (!tarball) {
    return false;
  }

  const extract = runCommand("tar", ["-xzf", tarball, "-C", downloadDir]);
  if (extract.status !== 0) {
    logCommandFailure("Extracting agent", extract);
    return false;
  }

  fs.mkdirSync(Config.linux.root, { recursive: true });
  fs.copyFileSync(
    path.join(downloadDir, "agent"),
    Config.linux.files.agentBinary,
  );
  fs.chmodSync(Config.linux.files.agentBinary, 0o755);

  // The default agent's release ships its systemd unit alongside the binary.
  if (kind === "default") {
    fs.copyFileSync(
      path.join(downloadDir, "agent.service"),
      AGENT_SERVICE_PATH,
    );
  }
  return true;
}

export function startAgent(kind: AgentKind): void {
  if (kind === "bravo") {
    spawnAgentDetached();
    return;
  }

  startAgentService();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Download the latest release tar into downloadDir and verify its checksum.
// Returns the tar path, or null (after logging) when any step fails.
async function downloadAgent(
  kind: AgentKind,
  downloadDir: string,
): Promise<string | null> {
  const asset = await fetchLatestReleaseAsset(kind);
  if (!asset) {
    return null;
  }

  const tarball = path.join(downloadDir, "agent.tar.gz");
  if (
    !(await downloadFile(asset.primary_download_url, tarball)) &&
    !(await downloadFile(asset.fallback_download_url, tarball))
  ) {
    return null;
  }

  if (`sha256:${sha256File(tarball)}` !== asset.checksum) {
    logWarning("Agent checksum verification failed");
    return null;
  }
  logInfo("Checksum verification passed");
  return tarball;
}

// Find the release tar baked into the agent root under its original name,
// e.g. /home/agent/harden-runner_1.9.3_linux_amd64.tar.gz.
function findBakedTarball(kind: AgentKind): string | null {
  const fileName = fs.existsSync(Config.linux.root)
    ? fs.readdirSync(Config.linux.root).find((f) => isAgentTarball(f, kind))
    : undefined;
  if (!fileName) {
    logWarning(`No baked agent tar found in ${Config.linux.root}`);
    return null;
  }

  logInfo(`Using baked agent tar ${fileName}`);
  return path.join(Config.linux.root, fileName);
}

// GET .../harden-runner-agent/github/linux/single/releases/latest and pick the
// asset for this agent kind and architecture.
async function fetchLatestReleaseAsset(
  kind: AgentKind,
): Promise<ReleaseAsset | null> {
  const url = `${Config.api.baseUrl}/harden-runner-agent/github/linux/single/releases/latest`;

  logInfo(`Fetching latest agent release from ${url}`);
  try {
    const { statusCode, body } = await getWithRetry(url, Config.hooks.retry);
    if (statusCode !== 200) {
      logWarning(`Fetching latest agent release failed: HTTP ${statusCode}`);
      return null;
    }

    const assets = (JSON.parse(body) as { assets?: ReleaseAsset[] }).assets;
    const asset = assets?.find((candidate) =>
      isAgentTarball(candidate.asset_name, kind),
    );
    if (!asset) {
      logWarning(`No ${kind} agent asset in the latest agent release`);
      return null;
    }

    return asset;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logWarning(`Fetching latest agent release failed: ${message}`);
    return null;
  }
}

// Release tar name for this agent kind and architecture, e.g.
// "harden-runner-bravo_1.9.3_linux_amd64.tar.gz".
function isAgentTarball(fileName: string, kind: AgentKind): boolean {
  const name = kind === "bravo" ? "harden-runner-bravo" : "harden-runner";
  const variant = process.arch === "x64" ? "amd64" : "arm64";
  return (
    fileName.startsWith(`${name}_`) &&
    fileName.endsWith(`_linux_${variant}.tar.gz`)
  );
}

async function downloadFile(url: string, filePath: string): Promise<boolean> {
  logInfo(`Downloading agent from ${url}`);
  try {
    await httpDownload(url, filePath, DOWNLOAD_TIMEOUT_MS);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logWarning(`Downloading agent failed: ${message}`);
    return false;
  }
}

function sha256File(filePath: string): string {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

// Same as harden-runner's bravo start: detached, outliving the hook process,
// with stdout/stderr captured in agent.stdout.
function spawnAgentDetached(): void {
  const output = fs.openSync(Config.linux.files.agentStdout, "a");
  const child = childProcess.spawn(Config.linux.files.agentBinary, [], {
    cwd: Config.linux.root,
    detached: true,
    stdio: ["ignore", output, output],
  });
  child.unref();
}

// TESTING: installs an int bravo build (raw binary, no checksum) instead of the
// latest release. Remove this function and its call in installAgent after
// testing.
async function installTestBravo(): Promise<boolean> {
  const binary = process.arch === "x64" ? "agent-bravo" : "agent-bravo-arm";
  const url = `https://step-security-agent.s3.us-west-2.amazonaws.com/refs/heads/self-hosted/h0x0er/int/${binary}`;

  fs.mkdirSync(Config.linux.root, { recursive: true });
  if (!(await downloadFile(url, Config.linux.files.agentBinary))) {
    return false;
  }

  fs.chmodSync(Config.linux.files.agentBinary, 0o755);
  return true;
}

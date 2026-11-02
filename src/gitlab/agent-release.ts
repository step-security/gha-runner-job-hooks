import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

import { Config } from "../lib/config";
import { getWithRetry, httpDownload, logError, logInfo, logWarning } from "../lib/common";

export type ReleaseAsset = {
  asset_name: string;
  checksum: string;
  primary_download_url: string;
  fallback_download_url: string;
};

// e.g. "agent-gitlab-windows_v0.0.1_windows_amd64.tar.gz"
const AGENT_ASSET_PREFIX = "agent-gitlab-windows_";
const AGENT_ASSET_SUFFIX = "_windows_amd64.tar.gz";
const DOWNLOAD_TIMEOUT_MS = 30000;

// Returns the Windows amd64 release asset, or null (after logging) on failure.
export async function fetchReleaseAsset(
  apiBaseUrl: string,
  version: string,
): Promise<ReleaseAsset | null> {
  const url = `${apiBaseUrl}/harden-runner-agent/gitlab/windows/single/releases/${encodeURIComponent(version)}`;

  logInfo(`Fetching agent release ${version} from ${url}`);
  try {
    const { statusCode, body } = await getWithRetry(url, Config.hooks.retry);
    if (statusCode !== 200) {
      logError(`Fetching agent release ${version} failed: HTTP ${statusCode} ${body.trim()}`);
      return null;
    }

    const assets = (JSON.parse(body) as { assets?: ReleaseAsset[] }).assets;
    const asset = assets?.find((candidate) => isAgentAsset(candidate.asset_name));
    if (!asset) {
      logError(`No Windows amd64 agent asset in agent release ${version}`);
      return null;
    }

    return asset;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError(`Fetching agent release ${version} failed: ${message}`);
    return null;
  }
}

// Reuses a matching tarball at tarballPath, otherwise downloads it.
export async function ensureVerifiedTarball(
  asset: ReleaseAsset,
  tarballPath: string,
): Promise<boolean> {
  if (fs.existsSync(tarballPath)) {
    if (checksumMatches(tarballPath, asset.checksum)) {
      logInfo(`GitlabAgent tarball=reused path=${tarballPath} checksum=verified`);
      return true;
    }

    logWarning(
      `GitlabAgent tarball=checksum-mismatch path=${tarballPath} action=replaced-with-download`,
    );
    fs.rmSync(tarballPath, { force: true });
  }

  for (const url of [asset.primary_download_url, asset.fallback_download_url]) {
    if (!url || !(await downloadFile(url, tarballPath))) {
      continue;
    }

    if (checksumMatches(tarballPath, asset.checksum)) {
      logInfo(`GitlabAgent tarball=downloaded path=${tarballPath} checksum=verified`);
      return true;
    }

    logWarning(`GitlabAgent tarball=checksum-mismatch url=${url}`);
    fs.rmSync(tarballPath, { force: true });
  }

  logError(`Downloading a verified ${asset.asset_name} failed`);
  return false;
}

// asset_name becomes a local file name, so only accept the expected form.
export function isAgentAsset(fileName: string): boolean {
  return (
    path.basename(fileName) === fileName &&
    fileName.startsWith(AGENT_ASSET_PREFIX) &&
    fileName.endsWith(AGENT_ASSET_SUFFIX)
  );
}

// The API reports checksums as "sha256:<hex>".
function checksumMatches(filePath: string, expected: string): boolean {
  const digest = crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
  return `sha256:${digest}` === expected.trim().toLowerCase();
}

async function downloadFile(url: string, filePath: string): Promise<boolean> {
  logInfo(`Downloading agent from ${url}`);
  try {
    await httpDownload(url, filePath, DOWNLOAD_TIMEOUT_MS);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logWarning(`Downloading agent from ${url} failed: ${message}`);
    fs.rmSync(filePath, { force: true });
    return false;
  }
}

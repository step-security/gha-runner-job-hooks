import * as fs from "fs";

import { Config } from "../lib/config";

export type LinuxRuntimeMode = "k8s" | "vm" | "custom-vm";

const SERVICE_ACCOUNT_TOKEN_PATH =
  "/var/run/secrets/kubernetes.io/serviceaccount/token";

function isSecondaryPod(): boolean {
  const workDir = "/__w";
  const hasKubeEnv = process.env.KUBERNETES_PORT !== undefined;
  return fs.existsSync(workDir) && hasKubeEnv;
}

function isARCRunner(): boolean {
  const runnerUserAgent = process.env.GITHUB_ACTIONS_RUNNER_EXTRA_USER_AGENT;
  if (runnerUserAgent?.includes("actions-runner-controller/")) {
    return true;
  }

  return isSecondaryPod();
}

function isRunningInKubernetes(): boolean {
  if (
    Boolean(process.env.KUBERNETES_SERVICE_HOST) ||
    fs.existsSync(SERVICE_ACCOUNT_TOKEN_PATH)
  ) {
    return true;
  }

  return isARCRunner();
}

function parseExplicitLinuxHookMode(): LinuxRuntimeMode | "" {
  if (
    Config.hookMode === "k8s" ||
    Config.hookMode === "vm" ||
    Config.hookMode === "custom-vm"
  ) {
    return Config.hookMode;
  }

  return "";
}

export function detectLinuxRuntimeMode(): LinuxRuntimeMode {
  const explicitMode = parseExplicitLinuxHookMode();
  if (explicitMode) {
    return explicitMode;
  }

  return isRunningInKubernetes() ? "k8s" : "vm";
}

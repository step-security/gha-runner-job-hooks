import { Config } from "../lib/config";
import { detectIsGithubHosted } from "../lib/agent-json";

export type WindowsHookMode = "selfhosted" | "github-hosted";

// Map the shared STEP_HOOK_MODE vocabulary onto the Windows flows:
//   "vm"         -> self-hosted VM
//   "custom-vm"  -> GitHub-hosted custom VM image
// "k8s" (Linux-only) and any unset value fall through to auto-detection.
function parseExplicitWindowsHookMode(): WindowsHookMode | "" {
  if (Config.hookMode === "vm") {
    return "selfhosted";
  }
  if (Config.hookMode === "custom-vm") {
    return "github-hosted";
  }

  return "";
}

// GitHub-hosted custom images ship agent.json with `is_github_hosted: true`;
// self-hosted VMs use config.json and have no such marker. An explicit
// STEP_HOOK_MODE override always wins.
export function detectWindowsHookMode(): WindowsHookMode {
  const explicitMode = parseExplicitWindowsHookMode();
  if (explicitMode) {
    return explicitMode;
  }

  return detectIsGithubHosted(Config.windows.files.agentJson)
    ? "github-hosted"
    : "selfhosted";
}

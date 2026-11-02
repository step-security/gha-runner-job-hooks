import type { HookArgs } from "./args";
import { ApiKeyConfig } from "./config";
import { logInfo } from "../lib/common";

// Precedence: --api-key arg > STEP_GITLAB_API_KEY env var.
export function resolveApiKey(args: HookArgs = {}): string {
  if (args.apiKey) {
    logInfo("ApiKey source=argument");
    return args.apiKey;
  }

  const envApiKey = ApiKeyConfig.envApiKey;
  if (envApiKey) {
    logInfo("ApiKey source=environment");
    return envApiKey;
  }

  return "";
}

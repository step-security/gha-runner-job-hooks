import { getFlag } from "../lib/provider";

export type HookArgs = {
  customer?: string;
  apiKey?: string;
  version?: string;
  api?: string;
  telemetryUrl?: string;
  serverName?: string;
};

const FLAG_NAMES: Record<keyof HookArgs, string> = {
  customer: "customer",
  apiKey: "api-key",
  version: "version",
  api: "api",
  telemetryUrl: "telemetry-url",
  serverName: "server-name",
};

export function parseGitlabHookArgs(argv: string[]): HookArgs {
  const args: HookArgs = {};
  for (const [key, name] of Object.entries(FLAG_NAMES) as [keyof HookArgs, string][]) {
    const value = getFlag(argv, name);
    if (value !== undefined) {
      args[key] = value;
    }
  }
  return args;
}

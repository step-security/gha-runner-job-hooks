import type { HookArgs } from "./args";
import { resolveApiKey } from "./api-key";
import { AgentConfigDefaults, AgentReleaseConfig, Urls } from "./config";
import type { GitlabRunContext } from "./context";
import { writeJsonFile } from "../lib/files";

// Field names match the agent's agent.json keys.
export type SharedAgentConfig = {
  customer: string;
  server_name: string;
  api_url: string;
  telemetry_url: string;
  api_key: string;
  egress_policy: string;
  disable_telemetry: boolean;
  is_debug: boolean;
  job_id: string;
  pipeline_id: string;
  repo: string;
  pipeline_file_name: string;
  runner_labels: string;
  runner_name: string;
  project_dir: string;
  build_shell_pid: string;
};

// Caller-supplied settings, resolved once per hook run.
export type HookSettings = {
  customer: string;
  serverName: string;
  apiUrl: string;
  telemetryUrl: string;
  apiKey: string;
  version: string;
};

// Precedence: CLI arg > environment variable > default.
export function resolveHookSettings(args: HookArgs = {}): HookSettings {
  return {
    customer: args.customer || AgentConfigDefaults.customer,
    serverName: args.serverName || AgentConfigDefaults.serverName,
    apiUrl: args.api || Urls.stepSecurityApi,
    telemetryUrl: args.telemetryUrl || Urls.telemetryUrl,
    apiKey: resolveApiKey(args),
    version: args.version || AgentReleaseConfig.version,
  };
}

// Names of the required settings that are empty, as their CLI flags.
export function missingRequiredSettings(settings: HookSettings): string[] {
  const required: [string, string][] = [
    ["--customer", settings.customer],
    ["--api-key", settings.apiKey],
    ["--version", settings.version],
    ["--server-name", settings.serverName],
  ];
  return required.filter(([, value]) => !value).map(([flag]) => flag);
}

export function writeAgentConfig(
  ctx: GitlabRunContext,
  agentJsonPath: string,
  settings: HookSettings,
): SharedAgentConfig {
  const config: SharedAgentConfig = {
    customer: settings.customer,
    server_name: settings.serverName,
    api_url: settings.apiUrl,
    telemetry_url: settings.telemetryUrl,
    api_key: settings.apiKey,
    egress_policy: AgentConfigDefaults.egressPolicy,
    disable_telemetry: AgentConfigDefaults.disableTelemetry,
    is_debug: AgentConfigDefaults.isDebug,
    job_id: ctx.jobId,
    pipeline_id: ctx.pipelineId,
    repo: ctx.projectPath,
    pipeline_file_name: ctx.configPath,
    runner_labels: ctx.runnerTags,
    runner_name: ctx.runnerDescription,
    project_dir: ctx.projectDir,
    // pre.js is launched directly by the job's build shell.
    build_shell_pid: String(process.ppid),
  };

  writeJsonFile(agentJsonPath, config as unknown as Record<string, unknown>);
  return config;
}

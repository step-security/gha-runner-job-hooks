import { Config } from "../lib/config";

export const AgentRuntimeConfig = {
  windowsRoot: process.env.STEP_GITLAB_AGENT_ROOT_WINDOWS || "C:\\agent",
} as const;

export const AgentReleaseConfig = {
  // Agent version tag (e.g. "v0.0.1"), overridden by --version.
  version: process.env.STEP_GITLAB_AGENT_VERSION_WINDOWS || "",
} as const;

export const WindowsAgentServiceConfig = {
  // Must match the agent's defaultServiceName.
  name: "StepSecurityGitLabAgent",
  displayName: "StepSecurity GitLab Agent",
  description: "StepSecurity GitLab CI Runner Security Agent",
} as const;

export const ApiKeyConfig = {
  envApiKey: process.env.STEP_GITLAB_API_KEY || "",
} as const;

export const AgentFiles = {
  agentJson: `${AgentRuntimeConfig.windowsRoot}\\agent.json`,
  agentStatus: `${AgentRuntimeConfig.windowsRoot}\\agent.status`,
  agentDone: `${AgentRuntimeConfig.windowsRoot}\\done.json`,
  agentBinary: `${AgentRuntimeConfig.windowsRoot}\\agent-gitlab-windows.exe`,
  agentLog: `${AgentRuntimeConfig.windowsRoot}\\agent.log`,
  daemonLog: `${AgentRuntimeConfig.windowsRoot}\\daemon.log`,
} as const;

export const Urls = {
  stepSecurityApi: Config.api.baseUrl,
  telemetryUrl: Config.api.telemetryUrl,
} as const;

export const AgentConfigDefaults = {
  customer: process.env.STEP_GITLAB_CUSTOMER || "",
  serverName: process.env.STEP_GITLAB_SERVER_NAME || "",
  disableTelemetry: false,
  egressPolicy: "audit",
  isDebug: process.env.STEP_GITLAB_IS_DEBUG === "true",
} as const;

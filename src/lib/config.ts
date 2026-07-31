const linuxRoot = process.env.STEP_AGENT_ROOT || "/home/agent";
const windowsRoot = process.env.STEP_AGENT_ROOT_WINDOWS || "C:\\agent";

const DEFAULT_API_URL = "https://agent.api.stepsecurity.io/v1";
const DEFAULT_TELEMETRY_URL = "https://prod.app-api.stepsecurity.io/v1";

export const Config = {
  // Optional explicit hook-variant override, applied within the detected
  // platform. "k8s" is Linux-only and ignored on Windows.
  //   STEP_HOOK_MODE = "vm" | "k8s" | "custom-vm"
  hookMode: process.env.STEP_HOOK_MODE || "vm",

  api: {
    // StepSecurity endpoints. The shell hooks baked these in as {{API_URL}};
    // here they are env-driven so a single published bundle works across
    // environments.
    baseUrl: process.env.STEP_API || DEFAULT_API_URL,
    telemetryUrl: process.env.STEP_TELEMETRY_URL || DEFAULT_TELEMETRY_URL,
  },

  linux: {
    root: linuxRoot,
    serviceName: "agent.service",

    files: {
      agentJson: `${linuxRoot}/agent.json`,
      agentStatus: `${linuxRoot}/agent.status`,
      agentDone: `${linuxRoot}/done.json`,
      agentLog: `${linuxRoot}/agent.log`,
      postEvent: `${linuxRoot}/post_event.json`,
    },
  },

  windows: {
    root: windowsRoot,
    serviceName: "StepSecurityAgent",

    files: {
      agentJson: `${windowsRoot}\\agent.json`,
      agentStatus: `${windowsRoot}\\agent.status`,
      agentDone: `${windowsRoot}\\done.json`,
      agentLog: `${windowsRoot}\\agent.log`,
      ready(correlationId: string): string {
        return `${windowsRoot}\\prejob_policy_ready_${correlationId}.json`;
      },
      cleanupDone(nonce: string): string {
        return `${windowsRoot}\\postjob_cleanup_done_${nonce}.json`;
      },
    },
  },
} as const;

const linuxRoot = process.env.STEP_AGENT_ROOT || "/home/agent";
const windowsRoot = process.env.STEP_AGENT_ROOT_WINDOWS || "C:\\agent";
const macosRoot = process.env.STEP_AGENT_ROOT_MACOS || "/opt/step-security";

const DEFAULT_API_URL = "https://agent.api.stepsecurity.io/v1";
const DEFAULT_TELEMETRY_URL = "https://prod.app-api.stepsecurity.io/v1";
const DEFAULT_CONNECT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_ATTEMPTS = 4;
const DEFAULT_RETRY_DELAY_MS = 1000;
const DEFAULT_K8S_POLL_TIMEOUT_MS = 10000;
const DEFAULT_K8S_POLL_INTERVAL_MS = 1000;
const DEFAULT_K8S_SLEEP_FALLBACK_MS = 10000;

type ParsedBoolean = {
  value: boolean;
  valid: boolean;
};

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

  hooks: {
    retry: {
      timeoutMs: readPositiveIntegerEnv(
        "STEP_HOOK_CONNECT_TIMEOUT_MS",
        DEFAULT_CONNECT_TIMEOUT_MS,
      ),
      maxAttempts: readPositiveIntegerEnv(
        "STEP_HOOK_MAX_ATTEMPTS",
        DEFAULT_MAX_ATTEMPTS,
      ),
      retryDelayMs: readNonNegativeIntegerEnv(
        "STEP_HOOK_RETRY_DELAY_MS",
        DEFAULT_RETRY_DELAY_MS,
      ),
      retryOnConnectionRefused: readBooleanEnv(
        "STEP_HOOK_RETRY_ON_CONNREFUSED",
        true,
      ),
    },
    k8s: {
      pollTimeoutMs: readNonNegativeIntegerEnv(
        "STEP_HOOK_K8S_POLL_TIMEOUT_MS",
        DEFAULT_K8S_POLL_TIMEOUT_MS,
      ),
      pollIntervalMs: readPositiveIntegerEnv(
        "STEP_HOOK_K8S_POLL_INTERVAL_MS",
        DEFAULT_K8S_POLL_INTERVAL_MS,
      ),
      sleepFallbackMs: readNonNegativeIntegerEnv(
        "STEP_HOOK_K8S_SLEEP_FALLBACK_MS",
        DEFAULT_K8S_SLEEP_FALLBACK_MS,
      ),
    },
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

  macos: {
    root: macosRoot,

    files: {
      agentJson: `${macosRoot}/agent.json`,
      agentDone: `${macosRoot}/done.json`,
      policyDataDir: `${macosRoot}/policy-data`,
      policyConfig: `${macosRoot}/policy-data/policy-config.json`,
      policyConfigCreated: `${macosRoot}/policy-data/policy-config-created.mark`,
      policyApplied: `${macosRoot}/policy-data/policy-applied.mark`,
      postJob: `${macosRoot}/policy-data/post_job.mark`,
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

function readPositiveIntegerEnv(name: string, fallback: number): number {
  return readIntegerEnv(name, fallback, (value) => value > 0);
}

function readNonNegativeIntegerEnv(name: string, fallback: number): number {
  return readIntegerEnv(name, fallback, (value) => value >= 0);
}

function readIntegerEnv(
  name: string,
  fallback: number,
  validate: (value: number) => boolean,
): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || !validate(parsed)) {
    return fallback;
  }

  return parsed;
}

function readBooleanEnv(name: string, fallback: boolean): boolean {
  const parsed = parseBooleanEnv(process.env[name]);
  return parsed.valid ? parsed.value : fallback;
}

function parseBooleanEnv(raw: string | undefined): ParsedBoolean {
  if (!raw) {
    return { value: false, valid: false };
  }

  switch (raw.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return { value: true, valid: true };
    case "0":
    case "false":
    case "no":
    case "off":
      return { value: false, valid: true };
    default:
      return { value: false, valid: false };
  }
}

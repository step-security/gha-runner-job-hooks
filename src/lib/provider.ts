import { logWarning } from "./common";

export type Provider = "github" | "gitlab";

// --provider wins; otherwise detect a GitLab CI environment.
export function detectProvider(argv: string[]): Provider {
  const explicit = getFlag(argv, "provider");
  if (explicit === "gitlab" || explicit === "github") {
    return explicit;
  }
  if (explicit !== undefined) {
    logWarning(`Unknown --provider value "${explicit}", detecting from environment`);
  }

  return process.env.GITLAB_CI === "true" ? "gitlab" : "github";
}

// Accepts "--flag value" and "--flag=value"; never throws.
export function getFlag(argv: string[], name: string): string | undefined {
  const flag = `--${name}`;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const eqIndex = token.indexOf("=");
    const tokenFlag = eqIndex === -1 ? token : token.slice(0, eqIndex);
    if (tokenFlag !== flag) {
      continue;
    }

    if (eqIndex !== -1) {
      return token.slice(eqIndex + 1);
    }

    return argv[i + 1];
  }

  return undefined;
}

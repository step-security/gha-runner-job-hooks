# StepSecurity GitHub Actions Runner Job Hooks

This repository publishes the StepSecurity job-hook bundles used by GitHub
Actions self-hosted runners: `pre.js` for `ACTIONS_RUNNER_HOOK_JOB_STARTED` and
`post.js` for `ACTIONS_RUNNER_HOOK_JOB_COMPLETED`.

These hooks are meant to be invoked from small wrapper scripts on the runner.
The wrappers set environment-specific configuration, fetch or locate the hook
bundle, and execute it with `node`.

The hooks assume the Harden-Runner agent is already installed on the runner.
They generate a per-job correlation ID, enforce policies from the Policy
Store, drive the agent around each job, and publish job summaries. They do not
install the agent binary.

## Configuration

All configuration is environment-driven so a single published bundle works
across environments. In practice, set these in the wrapper script that invokes
`pre.js` / `post.js`, or in the runner service environment if you want them to
apply to every job on that runner.

| Variable                  | Default                                | Description                                                             |
| ------------------------- | -------------------------------------- | ----------------------------------------------------------------------- |
| `STEP_API`                | `https://agent.api.stepsecurity.io/v1` | StepSecurity API base URL. `STEPSECURITY_API` is accepted as an alias.  |
| `STEP_TELEMETRY_URL`      | `https://prod.app-api.stepsecurity.io/v1` | StepSecurity telemetry endpoint written into `agent.json` (Linux persistent) when not already set. |
| `STEP_AGENT_ROOT`         | `/home/agent`                          | Linux agent directory (agent.json, agent.status, done.json, agent.log). |
| `STEP_AGENT_ROOT_WINDOWS` | `C:\agent`                             | Windows agent directory.                                                |
| `STEP_HOOK_MODE`          | _(auto)_                               | Force the hook variant: `vm`, `k8s` (Linux only), or `custom-vm`.       |

Notes:

- `STEP_API` and `STEP_TELEMETRY_URL` are the main per-environment overrides.
  The checked-in `local/pre.sh` is the reference wrapper pattern.
- `STEP_AGENT_ROOT` is Linux-only and `STEP_AGENT_ROOT_WINDOWS` is
  Windows-only. Set only the one that matches the runner OS.
- `STEP_HOOK_MODE` is usually set in the wrapper so the runner topology is
  explicit and easy to audit.

## Runner setup

Point the GitHub Actions runner hook variables at small wrapper scripts (not at
`pre.js` / `post.js` directly):

| Variable                            | Value                                |
| ----------------------------------- | ------------------------------------ |
| `ACTIONS_RUNNER_HOOK_JOB_STARTED`   | Path to the pre-job wrapper script.  |
| `ACTIONS_RUNNER_HOOK_JOB_COMPLETED` | Path to the post-job wrapper script. |

The wrapper script is responsible for three things:

- setting the StepSecurity environment variables for that runner or environment
- locating or downloading the hook bundle
- invoking `node` for the correct phase without letting hook failures fail the job

Use `local/pre.sh` as the Linux wrapper pattern and install it once under a
stable path, then expose it through symlinks for both hook phases. The wrapper
should inspect its own basename: if the invoked name is `pre.sh`, run `pre.js`;
otherwise run `post.js`.

Example layout:

```sh
sudo install -m 0755 ./local/pre.sh /opt/step-security/wrapper.sh
sudo ln -sf /opt/step-security/wrapper.sh /opt/step-security/pre.sh
sudo ln -sf /opt/step-security/wrapper.sh /opt/step-security/post.sh

export ACTIONS_RUNNER_HOOK_JOB_STARTED=/opt/step-security/pre.sh
export ACTIONS_RUNNER_HOOK_JOB_COMPLETED=/opt/step-security/post.sh
```

In that model the wrapper:

- sets `STEP_API`, `STEP_TELEMETRY_URL`, and `STEP_HOOK_MODE`
- caches `pre.js` and `post.js` under a local directory such as `/tmp/gha-hooks`
- runs `pre.js` when invoked as `pre.sh`
- runs `post.js` when invoked as `post.sh`
- preserves exported env vars when invoking `node`

Minimal Linux wrapper shape:

```sh

export STEP_HOOK_MODE="vm"

HOOKS_DIR="/tmp/gha-hooks"
PRE_JS="${HOOKS_DIR}/pre.js"
POST_JS="${HOOKS_DIR}/post.js"
BASE_URL="https://github.com/h0x0er/playground/releases/download/v0.0.7"

mkdir -p "${HOOKS_DIR}"

if [ ! -f "${PRE_JS}" ]; then
  curl -fsSL "${BASE_URL}/pre.js" -o "${PRE_JS}"
fi

if [ ! -f "${POST_JS}" ]; then
  curl -fsSL "${BASE_URL}/post.js" -o "${POST_JS}"
fi

if [ "$(basename "$0")" = "pre.sh" ]; then
  sudo -E node "${PRE_JS}" || true
else
  sudo -E node "${POST_JS}" || true
fi
```

Wrapper requirements and expectations:

- `node` must be available on `PATH`
- `curl` must be available on `PATH` if the wrapper downloads release assets
- `sudo -E` is used in the reference wrapper so the StepSecurity env vars are
  preserved for the `node` process
- the wrapper should either tolerate hook failures with `|| true` or exit `0`
  explicitly so workflow jobs do not fail because of hook execution
- if you cache `pre.js` / `post.js` locally, keep both files in sync with the
  same release tag

On Windows, use a PowerShell wrapper with the same responsibilities: set env
vars, fetch the release assets, run `pre.js` / `post.js` with `node`, and avoid
propagating hook failures to the workflow job.
